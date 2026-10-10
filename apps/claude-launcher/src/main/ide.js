// Abre carpetas en el IDE del usuario a través de su lanzador de línea de comandos.
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { CMD_UNSAFE, isScript, whichWin } from './which'

// Orden de preferencia cuando el usuario aún no ha elegido.
const IDES = [
  { id: 'code', name: 'VS Code' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'windsurf', name: 'Windsurf' },
  { id: 'zed', name: 'Zed' },
  { id: 'idea', name: 'IntelliJ IDEA' },
  { id: 'webstorm', name: 'WebStorm' },
  { id: 'pycharm', name: 'PyCharm' },
  { id: 'rider', name: 'Rider' },
  { id: 'goland', name: 'GoLand' },
  { id: 'phpstorm', name: 'PhpStorm' },
  { id: 'clion', name: 'CLion' },
  { id: 'rubymine', name: 'RubyMine' }
]

// Donde los instaladores dejan el lanzador aunque no lo añadan al PATH.
function extraDirs() {
  const local = process.env.LOCALAPPDATA
  if (!local) return []
  return [
    join(local, 'JetBrains', 'Toolbox', 'scripts'),
    join(local, 'Programs', 'Microsoft VS Code', 'bin'),
    join(local, 'Programs', 'cursor', 'resources', 'app', 'bin'),
    join(local, 'Programs', 'Windsurf', 'bin')
  ]
}

export function detect() {
  const dirs = extraDirs()
  return IDES.map((ide) => ({ ...ide, file: whichWin(ide.id, dirs) })).filter((ide) => ide.file)
}

export function open(dir, preferred) {
  const found = detect()
  const ide = found.find((i) => i.id === preferred) || found[0]
  if (!ide)
    throw new Error('No se ha encontrado ningún IDE (VS Code, Cursor, JetBrains…) en el PATH.')
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
