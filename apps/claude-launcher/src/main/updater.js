// Actualizaciones de la app: consulta la última release de GitHub y, en el .exe portable,
// descarga el nuevo, comprueba su sha256 y lo pone en lugar del actual al cerrar la app.
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { app, net } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { compareVersions } from './extension-packages'
import { CMD_UNSAFE, NO_CWD_EXE, SYSTEM_PATH, resolveBin } from './which'

const REPO = 'bytewareteam/claude-launcher'
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`
const MAX_EXE = 500 * 1024 * 1024

// electron-builder define esta variable al arrancar el portable: es la ruta del .exe del usuario.
const portableExe = () => process.env.PORTABLE_EXECUTABLE_FILE || null

let latest // última release consultada: la que se instala

// { current, latest, available, notes, url, canInstall }
export async function check() {
  const res = await net.fetch(LATEST_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store'
  })
  if (!res.ok) throw new Error(`No se pudo consultar la última versión (${res.status}).`)
  const data = await res.json()
  const version = String(data.tag_name ?? '').replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('La última release no tiene una versión válida.')
  // Sin el sha256 que publica GitHub no hay forma de verificar el .exe: solo se ofrece el enlace.
  const asset = (data.assets ?? []).find(
    (a) =>
      /^[\w.-]+-portable\.exe$/.test(a.name) &&
      /^sha256:[0-9a-f]{64}$/.test(a.digest ?? '') &&
      String(a.browser_download_url).startsWith(DOWNLOAD_PREFIX)
  )
  latest = { version, asset }
  const current = app.getVersion()
  return {
    current,
    latest: version,
    available: compareVersions(version, current) > 0,
    notes: String(data.body ?? '').slice(0, 20_000),
    url: /^https:\/\/github\.com\//.test(data.html_url)
      ? data.html_url
      : `https://github.com/${REPO}/releases/latest`,
    canInstall: !!(asset && portableExe())
  }
}

async function download(asset, onProgress) {
  const res = await net.fetch(asset.browser_download_url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`No se pudo descargar la actualización (${res.status}).`)
  const total = Number(res.headers.get('content-length')) || asset.size || 0
  const hash = createHash('sha256')
  const chunks = []
  let received = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.length
    if (received > MAX_EXE) throw new Error('La actualización es demasiado grande.')
    hash.update(value)
    chunks.push(value)
    onProgress({ received, total })
  }
  if (`sha256:${hash.digest('hex')}` !== asset.digest)
    throw new Error('La actualización descargada no coincide con la publicada (sha256).')
  return Buffer.concat(chunks)
}

// El portable está bloqueado mientras corre: un .cmd espera a que se cierre, lo sustituye y lo
// vuelve a abrir. Las rutas van por entorno para que cmd.exe no interprete nada de ellas.
const SWAP_SCRIPT = [
  '@echo off',
  'set n=0',
  ':retry',
  'copy /Y "%CL_UPDATE_SRC%" "%CL_UPDATE_DEST%" >nul 2>&1 && goto done',
  'set /a n+=1',
  'if %n% geq 120 goto start',
  '"%SystemRoot%\System32\PING.EXE" -n 2 127.0.0.1 >nul',
  'goto retry',
  ':done',
  'del "%CL_UPDATE_SRC%"',
  ':start',
  'start "" "%CL_UPDATE_DEST%"',
  'del "%~f0"',
  ''
].join('\r\n')

// Descarga la última versión y cierra la app para instalarla. Devuelve la versión instalada.
export async function install(onProgress) {
  const dest = portableExe()
  if (!dest) throw new Error('Solo el .exe portable se puede actualizar desde la app.')
  if (!latest?.asset)
    throw new Error('No hay una actualización verificable: descárgala desde GitHub.')
  if (compareVersions(latest.version, app.getVersion()) <= 0)
    throw new Error('Ya tienes la última versión.')
  const cmd = resolveBin('cmd')
  const dir = join(app.getPath('temp'), 'claude-launcher-update')
  const script = join(dir, 'update.cmd')
  if (!cmd || CMD_UNSAFE.test(script))
    throw new Error('No se puede preparar la actualización: descárgala desde GitHub.')

  const exe = await download(latest.asset, onProgress)
  mkdirSync(dir, { recursive: true })
  const src = join(dir, latest.asset.name)
  writeFileSync(src, exe)
  writeFileSync(script, SWAP_SCRIPT)
  spawn(cmd, ['/d', '/c', script], {
    cwd: dir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    // La nueva versión hereda este entorno: el PATH original, sin las rutas de la Configuración.
    env: {
      ...process.env,
      PATH: SYSTEM_PATH,
      ...NO_CWD_EXE,
      CL_UPDATE_SRC: src,
      CL_UPDATE_DEST: dest
    }
  }).unref()
  setTimeout(() => app.quit(), 300)
  return latest.version
}
