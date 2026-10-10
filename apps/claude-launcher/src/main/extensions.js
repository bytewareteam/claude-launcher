// Gestor de extensiones: las descubre, guarda qué permisos aceptó el usuario y arranca
// cada una en su propio utilityProcess (ver extension-host.js).
import { app, utilityProcess } from 'electron'
import { join, resolve, sep } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { baseEnv } from './terminal'

export const API_VERSION = 1
const CALL_TIMEOUT = 10 * 60_000
const LOG_LINES = 200

// Permisos que puede pedir un manifest y qué métodos del host desbloquean.
const METHOD_PERMISSION = {
  'projects.list': 'projects',
  'projects.addRepo': 'projects',
  'ui.pickFolder': 'dialogs'
}

export const builtinDir = () =>
  app.isPackaged ? join(process.resourcesPath, 'extensions') : join(app.getAppPath(), 'extensions')
export const userDir = () => join(app.getPath('userData'), 'extensions')

let store
let hostApi
const extensions = new Map()

// hostApi: implementaciones de los métodos que una extensión puede pedir al principal
// (reciben la extensión como primer argumento).
export function initExtensions(options) {
  store = options.store
  hostApi = options.hostApi
  mkdirSync(userDir(), { recursive: true })
  scan()
}

function readManifest(dir, builtin) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const cl = pkg.claudeLauncher
  if (!cl) throw new Error('package.json sin el campo «claudeLauncher».')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pkg.name || ''))
    throw new Error('«name» debe ser minúsculas, números y guiones.')
  if (cl.apiVersion !== API_VERSION)
    throw new Error(`apiVersion ${cl.apiVersion} no soportada (esta app usa ${API_VERSION}).`)
  const entry = resolve(dir, pkg.main || 'index.js')
  if (!entry.startsWith(resolve(dir) + sep)) throw new Error('«main» apunta fuera de la extensión.')
  const perms = cl.permissions || {}
  return {
    id: pkg.name,
    displayName: pkg.displayName || pkg.name,
    version: pkg.version || '0.0.0',
    description: pkg.description || '',
    entry,
    dir,
    builtin,
    permissions: {
      exec: Array.isArray(perms.exec) ? perms.exec.map(String) : [],
      projects: !!perms.projects,
      dialogs: !!perms.dialogs
    },
    views: (cl.views || []).map((v) => ({ id: String(v.id), title: String(v.title || v.id), icon: v.icon }))
  }
}

// Descubre extensiones de la app y del usuario. Para recoger cambios en desarrollo, detiene
// los procesos en marcha: se vuelven a arrancar en la siguiente petición.
export function scan() {
  for (const ext of extensions.values()) stop(ext)
  extensions.clear()
  for (const [root, builtin] of [
    [builtinDir(), true],
    [userDir(), false]
  ]) {
    if (!existsSync(root)) continue
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const dir = join(root, d.name)
      let ext
      try {
        ext = { ...readManifest(dir, builtin), log: [] }
      } catch (err) {
        const id = `${builtin ? 'app' : 'user'}:${d.name}`
        ext = { id, displayName: d.name, dir, builtin, invalid: err.message, views: [], log: [] }
        ext.permissions = { exec: [] }
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

// Las de la app vienen activas; las del usuario necesitan aceptar sus permisos, y vuelven
// a pedirlo si una actualización cambia los permisos.
function isEnabled(ext) {
  if (ext.invalid) return false
  const s = states()[ext.id] || {}
  return ext.builtin ? s.enabled !== false : !!s.enabled && s.grant === grantKey(ext)
}

export function setEnabled(id, enabled) {
  const ext = get(id)
  store.set('extensions', { ...states(), [id]: { enabled, grant: enabled ? grantKey(ext) : null } })
  if (!enabled) stop(ext)
}

export function list() {
  return [...extensions.values()].map((ext) => ({
    id: ext.id,
    displayName: ext.displayName,
    version: ext.version,
    description: ext.description,
    builtin: ext.builtin,
    dir: ext.dir,
    invalid: ext.invalid || null,
    permissions: ext.permissions,
    views: ext.views,
    enabled: isEnabled(ext),
    running: !!ext.proc,
    error: ext.error || null
  }))
}

export const logOf = (id) => get(id).log.join('')

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
