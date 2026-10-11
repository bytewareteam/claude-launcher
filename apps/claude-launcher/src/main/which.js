// Utilidades para lanzar programas en Windows sin depender de un shell.
import { existsSync } from 'fs'
import { delimiter, extname, join } from 'path'

// Busca `cmd` en PATH (y en `extraDirs`) como cmd.exe, con PATHEXT, para saber si es un
// script .cmd/.bat, que execFile/spawn no pueden lanzar sin shell (p. ej. `az` o `code`).
export function whichWin(cmd, extraDirs = []) {
  const exts = extname(cmd) ? [''] : (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
  const dirs = [...(process.env.PATH || '').split(delimiter), ...extraDirs].filter(Boolean)
  for (const dir of dirs)
    for (const ext of exts) if (existsSync(join(dir, cmd + ext))) return join(dir, cmd + ext)
  return null
}

// Caracteres que cmd.exe interpreta incluso entre comillas: no se pueden pasar con seguridad.
export const CMD_UNSAFE = /["%!^&|<>\r\n]/

export const isScript = (file) => /\.(cmd|bat)$/i.test(file)

// cmd.exe busca los ejecutables en la carpeta actual antes que en PATH: un `npm.cmd` o `claude.cmd`
// en la raíz de un repo se ejecutaría en lugar del real. Con esta variable no lo hace, y la heredan
// los .cmd que lance (npm.cmd llama a `node`).
export const NO_CWD_EXE = { NoDefaultCurrentDirectoryInExePath: '1' }

// cmd.exe por ruta absoluta: spawn con `cwd` también buscaría `cmd.exe` primero en esa carpeta.
export const comspec = () =>
  process.env.COMSPEC || join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'cmd.exe')
