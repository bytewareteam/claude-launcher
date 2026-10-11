// Utilidades para lanzar programas en Windows sin depender de un shell.
import { lstatSync } from 'fs'
import { delimiter, dirname, extname, isAbsolute, join } from 'path'

// ¿Archivo o enlace? Los alias de ejecución de Windows (wt.exe en WindowsApps) son enlaces que
// existsSync/statSync no pueden seguir, pero se ejecutan sin problema.
function isFileLike(file) {
  try {
    const s = lstatSync(file)
    return s.isFile() || s.isSymbolicLink()
  } catch {
    return false
  }
}

// Busca `cmd` en PATH (y en `extraDirs`) como cmd.exe, con PATHEXT, para saber si es un
// script .cmd/.bat, que execFile/spawn no pueden lanzar sin shell (p. ej. `az` o `code`).
export function whichWin(cmd, extraDirs = [], path = process.env.PATH) {
  const exts = extname(cmd) ? [''] : (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
  // Solo rutas absolutas: una relativa («.») buscaría en la carpeta actual.
  const dirs = [...(path || '').split(delimiter), ...extraDirs].filter((d) => d && isAbsolute(d))
  for (const dir of dirs)
    for (const ext of exts) if (isFileLike(join(dir, cmd + ext))) return join(dir, cmd + ext)
  return null
}

// Caracteres que cmd.exe interpreta incluso entre comillas: no se pueden pasar con seguridad.
export const CMD_UNSAFE = /["%!^&|<>\r\n]/

export const isScript = (file) => /\.(cmd|bat)$/i.test(file)

// cmd.exe busca los ejecutables en la carpeta actual antes que en PATH: un `npm.cmd` o `claude.cmd`
// en la raíz de un repo se ejecutaría en lugar del real. Con esta variable no lo hace, y la heredan
// los .cmd que lance (npm.cmd llama a `node`).
export const NO_CWD_EXE = { NoDefaultCurrentDirectoryInExePath: '1' }

// --- Programas que lanza la app ----------------------------------------------------------
// Cada uno se busca en el PATH del sistema salvo que la Configuración fije su ruta.
// `exe`: se lanza sin shell (o es la propia shell), así que no puede ser un .cmd/.bat.

const SYSTEM_PATH = process.env.PATH || ''

export const BINARIES = {
  claude: { file: 'claude' },
  cmd: { file: 'cmd.exe', exe: true },
  pwsh: { file: 'pwsh.exe', exe: true },
  wt: { file: 'wt.exe', exe: true },
  git: { file: 'git.exe', exe: true },
  node: { file: 'node.exe', exe: true },
  npm: { file: 'npm' },
  pnpm: { file: 'pnpm' },
  yarn: { file: 'yarn' },
  bun: { file: 'bun' },
  uv: { file: 'uv' },
  poetry: { file: 'poetry' },
  dotnet: { file: 'dotnet.exe', exe: true }
}

let overrides = {}

// Ruta que se usaría sin configuración propia.
function systemBinary(name) {
  if (name === 'cmd')
    return process.env.COMSPEC || join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'cmd.exe')
  const extra =
    name === 'pwsh' ? [join(process.env.PROGRAMFILES || '', 'PowerShell', '7')] : []
  return whichWin(BINARIES[name].file, extra, SYSTEM_PATH)
}

export const systemBinaries = () =>
  Object.fromEntries(Object.keys(BINARIES).map((n) => [n, systemBinary(n)]))

// Ruta absoluta del programa: la configurada o la del sistema; null si no está.
export function resolveBin(name) {
  if (overrides[name]) return overrides[name]
  // Con configuración propia de otro programa, el PATH ya lleva su carpeta delante.
  return name === 'cmd' || name === 'pwsh' ? systemBinary(name) : whichWin(BINARIES[name].file)
}

// Valida una ruta configurada. Absoluta (unidad o UNC), existente y sin caracteres que rompan una
// línea de cmd.exe; las que se lanzan sin shell, .exe.
export function checkBinary(name, file) {
  const spec = BINARIES[name]
  if (!spec) throw new Error(`Programa desconocido: ${name}`)
  if (typeof file !== 'string') throw new Error(`Ruta no válida para ${name}.`)
  const f = file.trim()
  if (!f) return ''
  const absolute = /^([a-z]:\\|\\\\)/i.test(f) && isAbsolute(f)
  if (f.length > 1024 || !absolute || CMD_UNSAFE.test(f) || f.includes(';'))
    throw new Error(`«${f}» no es una ruta absoluta válida.`)
  if (!isFileLike(f)) throw new Error(`No existe el archivo «${f}».`)
  const ext = extname(f).toLowerCase()
  if (spec.exe ? ext !== '.exe' : !['.exe', '.cmd', '.bat'].includes(ext))
    throw new Error(`«${f}» debe ser un ${spec.exe ? '.exe' : '.exe, .cmd o .bat'}.`)
  return f
}

// Aplica las rutas configuradas. Sus carpetas van delante del PATH del sistema para que lo que se
// lance (npm.cmd → node, la sesión de Claude, las extensiones) use también esas versiones.
export function setBinaries(map = {}) {
  overrides = Object.fromEntries(Object.entries(map).filter(([n, f]) => BINARIES[n] && f))
  const dirs = [...new Set(Object.values(overrides).map((f) => dirname(f)))]
  process.env.PATH = [...dirs, SYSTEM_PATH].filter(Boolean).join(delimiter)
}
