// Gestor de extensiones: las instala, guarda qué permisos aceptó el usuario y arranca
// cada una en su propio utilityProcess (ver extension-host.js).
import { app, utilityProcess } from 'electron'
import { randomUUID } from 'crypto'
import { join, resolve, sep } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'fs'
import { baseEnv } from './terminal'
import * as packages from './extension-packages'

export const API_VERSION = 1
const CALL_TIMEOUT = 10 * 60_000
const LOG_LINES = 200

// Permisos que puede pedir un manifest y qué métodos del host desbloquean.
const METHOD_PERMISSION = {
  'projects.list': 'projects',
  'projects.addRepo': 'projects',
  'ui.pickFolder': 'dialogs'
}

// La app no trae extensiones: se instalan del catálogo o de un .zip en userDir. En desarrollo
// también se cargan las de extensions/ del repo, para probarlas sin empaquetar.
const devDir = () => (app.isPackaged ? null : resolve(app.getAppPath(), '..', '..', 'extensions'))
export const userDir = () => join(app.getPath('userData'), 'extensions')
const stagingDir = () => join(app.getPath('userData'), 'extensions-staging')

let store
let hostApi
const extensions = new Map()

// hostApi: implementaciones de los métodos que una extensión puede pedir al principal
// (reciben la extensión como primer argumento).
export function initExtensions(options) {
  store = options.store
  hostApi = options.hostApi
  mkdirSync(userDir(), { recursive: true })
  rmSync(stagingDir(), { recursive: true, force: true })
  scan()
}

function normalizePermissions(perms = {}) {
  return {
    exec: Array.isArray(perms.exec) ? perms.exec.map(String) : [],
    projects: !!perms.projects,
    dialogs: !!perms.dialogs
  }
}

function readManifest(dir, source) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const cl = pkg.claudeLauncher
  if (!cl) throw new Error('package.json sin el campo «claudeLauncher».')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pkg.name || ''))
    throw new Error('«name» debe ser minúsculas, números y guiones.')
  if (cl.apiVersion !== API_VERSION)
    throw new Error(`apiVersion ${cl.apiVersion} no soportada (esta app usa ${API_VERSION}).`)
  const entry = resolve(dir, pkg.main || 'index.js')
  if (!entry.startsWith(resolve(dir) + sep)) throw new Error('«main» apunta fuera de la extensión.')
  return {
    id: pkg.name,
    displayName: pkg.displayName || pkg.name,
    version: pkg.version || '0.0.0',
    description: pkg.description || '',
    entry,
    dir,
    source,
    permissions: normalizePermissions(cl.permissions),
    views: (cl.views || []).map((v) => ({
      id: String(v.id),
      title: String(v.title || v.id),
      icon: v.icon
    }))
  }
}

// Descubre las extensiones instaladas (y las del repo en desarrollo). Para recoger cambios,
// detiene los procesos en marcha: se vuelven a arrancar en la siguiente petición.
export function scan() {
  for (const ext of extensions.values()) stop(ext)
  extensions.clear()
  for (const [root, source] of [
    [devDir(), 'dev'],
    [userDir(), 'user']
  ]) {
    if (!root || !existsSync(root)) continue
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory() || !existsSync(join(root, d.name, 'package.json'))) continue
      const dir = join(root, d.name)
      let ext
      try {
        ext = { ...readManifest(dir, source), log: [] }
      } catch (err) {
        const id = `${source}:${d.name}`
        ext = { id, displayName: d.name, dir, source, invalid: err.message, views: [], log: [] }
        ext.permissions = normalizePermissions()
      }
      if (extensions.has(ext.id))
        ext = { ...ext, id: `user:${ext.id}`, invalid: 'Ya hay otra extensión con ese nombre.' }
      extensions.set(ext.id, ext)
    }
  }
}

// --- Estado y consentimiento ------------------------------------------------------

const states = () => store.get('extensions', {})
const grantKey = (ext) => JSON.stringify(ext.permissions)

// Solo corre si el usuario aceptó exactamente los permisos que pide ahora: si una
// actualización los cambia, vuelve a pedir consentimiento.
const isGranted = (ext) => !ext.invalid && states()[ext.id]?.grant === grantKey(ext)
const isEnabled = (ext) => isGranted(ext) && !!states()[ext.id]?.enabled

function setState(id, patch) {
  const all = states()
  if (patch === null) delete all[id]
  else all[id] = { ...all[id], ...patch }
  store.set('extensions', all)
}

// Activar implica aceptar los permisos actuales; desactivar conserva el consentimiento.
export function setEnabled(id, enabled) {
  const ext = get(id)
  setState(id, enabled ? { enabled, grant: grantKey(ext) } : { enabled })
  if (!enabled) stop(ext)
}

export function list() {
  return [...extensions.values()].map((ext) => ({
    id: ext.id,
    displayName: ext.displayName,
    version: ext.version,
    description: ext.description,
    source: ext.source,
    dir: ext.dir,
    invalid: ext.invalid || null,
    permissions: ext.permissions,
    views: ext.views,
    enabled: isEnabled(ext),
    granted: isGranted(ext),
    running: !!ext.proc,
    error: ext.error || null
  }))
}

export const logOf = (id) => get(id).log.join('')

// --- Instalación ------------------------------------------------------------------

// Catálogo con el estado local de cada entrada.
export async function catalog(force) {
  const entries = await packages.fetchCatalog(force)
  return entries.map((e) => {
    const installed = extensions.get(e.name)
    return {
      ...e,
      permissions: normalizePermissions(e.permissions),
      compatible: e.apiVersion === API_VERSION,
      installedVersion: installed?.version ?? null,
      update: !!installed && packages.compareVersions(e.version, installed.version) > 0
    }
  })
}

// Paquetes extraídos que esperan a que el usuario acepte sus permisos.
const staged = new Map()

function stage(zip) {
  const token = randomUUID()
  const dir = join(stagingDir(), token)
  try {
    packages.extract(zip, dir)
    const manifest = readManifest(dir, 'user')
    staged.set(token, manifest)
    return { token, manifest }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

function discard(token) {
  staged.delete(token)
  rmSync(join(stagingDir(), token), { recursive: true, force: true })
}

// Mueve el paquete a userDir (sustituyendo la versión anterior) y lo activa con los
// permisos que el usuario acaba de aceptar.
function commit(token) {
  const manifest = staged.get(token)
  if (!manifest) throw new Error('La instalación ha caducado. Vuelve a intentarlo.')
  const current = extensions.get(manifest.id)
  if (current && current.source !== 'user') {
    discard(token)
    throw new Error(`Ya hay una extensión de desarrollo llamada «${manifest.id}».`)
  }
  staged.delete(token)
  if (current) stop(current)
  const dest = join(userDir(), manifest.id)
  rmSync(dest, { recursive: true, force: true, maxRetries: 5 })
  renameSync(manifest.dir, dest)
  setState(manifest.id, { enabled: true, grant: grantKey(manifest) })
  scan()
  return { id: manifest.id, displayName: manifest.displayName, version: manifest.version }
}

// El renderer ya ha mostrado los permisos del catálogo; si el paquete pide otros, no se instala.
export async function installFromCatalog(name) {
  const entry = (await catalog(true)).find((e) => e.name === name)
  if (!entry) throw new Error(`«${name}» no está en el catálogo.`)
  if (!entry.compatible) throw new Error(`«${entry.displayName}» necesita otra versión de la app.`)
  const { token, manifest } = stage(await packages.download(entry))
  if (
    manifest.id !== entry.name ||
    manifest.version !== entry.version ||
    grantKey(manifest) !== grantKey(entry)
  ) {
    discard(token)
    throw new Error(`El paquete de «${entry.displayName}» no coincide con el catálogo.`)
  }
  return commit(token)
}

// Instalar desde un .zip va en dos pasos: el usuario ve los permisos antes de confirmar.
export function stageZip(path) {
  const { token, manifest } = stage(packages.readZip(path))
  return {
    token,
    id: manifest.id,
    displayName: manifest.displayName,
    version: manifest.version,
    description: manifest.description,
    permissions: manifest.permissions,
    installedVersion: extensions.get(manifest.id)?.version ?? null
  }
}

export const installStaged = (token) => commit(token)
export const discardStaged = (token) => discard(token)

export function uninstall(id) {
  const ext = get(id)
  if (ext.source !== 'user')
    throw new Error('Solo se pueden desinstalar las extensiones instaladas.')
  stop(ext)
  rmSync(ext.dir, { recursive: true, force: true, maxRetries: 5 })
  setState(id, null)
  const data = store.get('extensionData', {})
  delete data[id]
  store.set('extensionData', data)
  scan()
}

function get(id) {
  const ext = extensions.get(id)
  if (!ext) throw new Error('Extensión no encontrada')
  return ext
}

// --- Proceso de cada extensión ----------------------------------------------------

function appendLog(ext, text) {
  ext.log.push(text)
  if (ext.log.length > LOG_LINES) ext.log.splice(0, ext.log.length - LOG_LINES)
}

function start(ext) {
  if (ext.ready) return ext.ready
  ext.error = null
  ext.calls = new Map()
  ext.nextId = 0
  const proc = utilityProcess.fork(join(__dirname, 'extension-host.js'), [], {
    // Mismo entorno mínimo que la terminal: nada de tokens sueltos del sistema.
    env: baseEnv(),
    cwd: ext.dir,
    stdio: 'pipe',
    serviceName: `Extensión ${ext.id}`
  })
  ext.proc = proc
  proc.stdout.on('data', (d) => appendLog(ext, String(d)))
  proc.stderr.on('data', (d) => appendLog(ext, String(d)))
  proc.on('message', (msg) => onMessage(ext, msg))
  proc.on('exit', (code) => {
    if (ext.proc !== proc) return
    if (code) ext.error = `El proceso terminó con código ${code}. Revisa el registro.`
    for (const c of ext.calls.values()) c.reject(new Error(ext.error || 'La extensión se detuvo.'))
    ext.proc = ext.ready = null
  })
  ext.ready = call(ext, 'activate', {
    id: ext.id,
    version: ext.version,
    entry: ext.entry,
    permissions: ext.permissions
  }).catch((err) => {
    ext.error = `No se pudo activar: ${err.message}`
    stop(ext)
    throw err
  })
  return ext.ready
}

function stop(ext) {
  const proc = ext.proc
  ext.proc = ext.ready = null
  for (const c of ext.calls?.values() ?? []) c.reject(new Error('La extensión se detuvo.'))
  proc?.kill()
}

function call(ext, method, ...params) {
  const id = ++ext.nextId
  ext.proc.postMessage({ type: 'call', id, method, params })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ext.calls.delete(id)
      reject(new Error(`La extensión «${ext.displayName}» no respondió a tiempo.`))
    }, CALL_TIMEOUT)
    const done = (fn) => (v) => {
      clearTimeout(timer)
      ext.calls.delete(id)
      fn(v)
    }
    ext.calls.set(id, { resolve: done(resolve), reject: done(reject) })
  })
}

async function onMessage(ext, msg) {
  if (msg.type === 'result') {
    const c = ext.calls.get(msg.id)
    if (msg.error) c?.reject(new Error(msg.error))
    else c?.resolve(msg.result)
    return
  }
  if (msg.type !== 'host') return
  const reply = (body) => ext.proc?.postMessage({ type: 'hostResult', id: msg.id, ...body })
  try {
    const perm = METHOD_PERMISSION[msg.method]
    if (perm && !ext.permissions[perm])
      throw new Error(`La extensión no tiene el permiso «${perm}».`)
    const fn = hostApi[msg.method]
    if (!fn) throw new Error(`Método desconocido: ${msg.method}`)
    reply({ result: (await fn(ext, ...msg.params)) ?? null })
  } catch (err) {
    reply({ error: String(err?.message || err) })
  }
}

async function callEnabled(id, method, ...params) {
  const ext = get(id)
  if (!isEnabled(ext)) throw new Error(`La extensión «${ext.displayName}» está desactivada.`)
  await start(ext)
  return call(ext, method, ...params)
}

export const render = (id, viewId) => callEnabled(id, 'render', viewId)
export const action = (id, viewId, actionId, args) =>
  callEnabled(id, 'action', viewId, actionId, args)

export function stopAll() {
  for (const ext of extensions.values()) stop(ext)
}
