// Abre carpetas en el IDE del usuario. Busca primero el ejecutable en las carpetas de
// instalación habituales y, si no, su lanzador de línea de comandos en el PATH.
import { spawn } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { CMD_UNSAFE, isScript, whichWin } from './which'

const env = (name) => process.env[name] || ''
const localPrograms = () => join(env('LOCALAPPDATA'), 'Programs')

// IDEs de JetBrains: `dir` es el prefijo de su carpeta de instalación («WebStorm 2025.2»,
// «IntelliJ IDEA Community Edition 2025.1»…) y `exe`, el ejecutable dentro de bin/.
const jetbrains = (id, name, dir, exe = `${id}64.exe`) => ({ id, name, jetbrains: { dir, exe } })

// Orden de preferencia cuando el usuario aún no ha elegido.
const IDES = [
  {
    id: 'code',
    name: 'VS Code',
    dirs: () => [
      join(localPrograms(), 'Microsoft VS Code', 'bin'),
      join(env('PROGRAMFILES'), 'Microsoft VS Code', 'bin')
    ]
  },
  jetbrains('webstorm', 'WebStorm', 'WebStorm'),
  jetbrains('idea', 'IntelliJ IDEA', 'IntelliJ IDEA'),
  {
    id: 'cursor',
    name: 'Cursor',
    dirs: () => [join(localPrograms(), 'cursor', 'resources', 'app', 'bin')]
  },
  { id: 'windsurf', name: 'Windsurf', dirs: () => [join(localPrograms(), 'Windsurf', 'bin')] },
  { id: 'zed', name: 'Zed', dirs: () => [join(localPrograms(), 'Zed', 'bin')] },
  {
    id: 'code-insiders',
    name: 'VS Code Insiders',
    dirs: () => [join(localPrograms(), 'Microsoft VS Code Insiders', 'bin')]
  },
  {
    id: 'codium',
    name: 'VSCodium',
    dirs: () => [
      join(localPrograms(), 'VSCodium', 'bin'),
      join(env('PROGRAMFILES'), 'VSCodium', 'bin')
    ]
  },
  jetbrains('pycharm', 'PyCharm', 'PyCharm'),
  jetbrains('rider', 'Rider', 'JetBrains Rider'),
  jetbrains('goland', 'GoLand', 'GoLand'),
  jetbrains('phpstorm', 'PhpStorm', 'PhpStorm'),
  jetbrains('clion', 'CLion', 'CLion'),
  jetbrains('rubymine', 'RubyMine', 'RubyMine'),
  jetbrains('rustrover', 'RustRover', 'RustRover'),
  jetbrains('datagrip', 'DataGrip', 'DataGrip'),
  {
    id: 'studio',
    name: 'Android Studio',
    exes: () => [join(env('PROGRAMFILES'), 'Android', 'Android Studio', 'bin', 'studio64.exe')]
  },
  {
    id: 'subl',
    name: 'Sublime Text',
    dirs: () => [
      join(env('PROGRAMFILES'), 'Sublime Text'),
      join(env('PROGRAMFILES'), 'Sublime Text 3')
    ]
  },
  { id: 'devenv', name: 'Visual Studio', exes: visualStudioExes }
]

const subdirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

// Instalador clásico (Program Files\JetBrains\<IDE> <versión>) y Toolbox (…\Programs\<IDE>).
// Con varias versiones, la más reciente (orden alfabético inverso del nombre de carpeta).
function jetbrainsExes({ dir, exe }) {
  const roots = [join(env('PROGRAMFILES'), 'JetBrains'), localPrograms()]
  return roots.flatMap((root) =>
    subdirs(root)
      .filter((d) => d === dir || d.startsWith(`${dir} `))
      .sort()
      .reverse()
      .map((d) => join(root, d, 'bin', exe))
  )
}

function visualStudioExes() {
  const root = join(env('PROGRAMFILES'), 'Microsoft Visual Studio')
  return subdirs(root)
    .sort()
    .reverse()
    .flatMap((year) =>
      subdirs(join(root, year)).map((ed) => join(root, year, ed, 'Common7', 'IDE', 'devenv.exe'))
    )
}

function locate(ide) {
  const exes = ide.jetbrains ? jetbrainsExes(ide.jetbrains) : (ide.exes?.() ?? [])
  const exe = exes.find((f) => existsSync(f))
  if (exe) return exe
  // Lanzador en el PATH (o en las carpetas de Toolbox / del instalador).
  return whichWin(ide.id, [
    ...(ide.dirs?.() ?? []),
    join(env('LOCALAPPDATA'), 'JetBrains', 'Toolbox', 'scripts')
  ])
}

// Todos los IDEs soportados, con su ruta si están instalados.
export const detect = () => IDES.map((ide) => ({ id: ide.id, name: ide.name, file: locate(ide) }))

export function open(dir, preferred) {
  const found = detect().filter((i) => i.file)
  const ide = found.find((i) => i.id === preferred) || found[0]
  if (!ide) throw new Error('No se ha encontrado ningún IDE. Elige uno en Configuración.')
  if (!existsSync(dir)) throw new Error(`La carpeta ya no existe: ${dir}`)
  const options = { detached: true, stdio: 'ignore', windowsHide: true }
  let child
  if (isScript(ide.file)) {
    if (CMD_UNSAFE.test(dir))
      throw new Error(
        `No se puede abrir ${dir} con ${ide.name}: la ruta tiene caracteres no admitidos.`
      )
    // La línea se monta aquí (no con args + shell, obsoleto en Node): la ruta ya está validada.
    child = spawn(`"${ide.file}" "${dir}"`, [], { ...options, shell: true })
  } else {
    child = spawn(ide.file, [dir], options)
  }
  child.on('error', () => {})
  child.unref()
  return ide.name
}
