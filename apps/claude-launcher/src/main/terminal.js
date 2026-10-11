import { spawn } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { NO_CWD_EXE, comspec, whichWin } from './which'

// Únicas variables del sistema que hereda la terminal: las que Windows, git,
// node y la propia shell necesitan para funcionar, más la configuración de red.
// Todo lo demás (credenciales sueltas, tokens de otros proyectos...) se queda
// fuera; el agente solo ve las variables del proyecto/repo de la bóveda.
const SYSTEM_VARS = new RegExp(
  '^(' +
    [
      'PATH', 'PATHEXT', 'COMSPEC', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'OS',
      'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
      'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ALLUSERSPROFILE', 'PUBLIC',
      'PROGRAMFILES', 'PROGRAMFILES\\(X86\\)', 'PROGRAMW6432',
      'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES\\(X86\\)', 'COMMONPROGRAMW6432',
      'USERNAME', 'USERDOMAIN', 'USERDOMAIN_ROAMINGPROFILE', 'COMPUTERNAME',
      'PROCESSOR_\\w+', 'NUMBER_OF_PROCESSORS', 'PSMODULEPATH', 'DRIVERDATA',
      'LANG', 'LC_\\w+', 'TZ',
      'HTTPS?_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS'
    ].join('|') +
    ')$',
  'i'
)

// Entorno base (terminal y extensiones): solo lo imprescindible del sistema.
export function baseEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => SYSTEM_VARS.test(k)))
}

// Argumentos extra de `claude` que admite la configuración. Solo caracteres sin significado
// para cmd.exe: el fallback los pasa tal cual en una línea de comandos.
export const CLAUDE_ARGS = /^[\w\s\-=.:/,@]*$/

// Argumentos que añade la propia app (p. ej. el prompt inicial): admiten espacios, pero nada que
// Windows Terminal (`;`) o cmd.exe interpreten.
const EXTRA_ARG = /^[^"%!^&|<>;\r\n]*$/

// ¿Existe la conversación `id` de Claude Code en `dir` (sin `id`: alguna)? Claude las guarda en
// `~/.claude/projects/<ruta con todo lo no alfanumérico cambiado por ->/<id>.jsonl` y solo tras el
// primer mensaje. Reanudar una que no existe sale con error y la pestaña se cierra.
export function hasClaudeSession(dir, id) {
  const root = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const folder = join(root, 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'))
  try {
    return readdirSync(folder).some((f) => (id ? f === `${id}.jsonl` : f.endsWith('.jsonl')))
  } catch {
    return false
  }
}

// Windows Terminal pasa el entorno de quien lo invoca a la pestaña nueva,
// así los secretos no aparecen en la línea de comandos.
export function openClaude(
  dir,
  title,
  extraEnv = {},
  { args = '', newWindow = false } = {},
  extraArgs = []
) {
  if (!existsSync(dir)) throw new Error(`No existe el directorio: ${dir}`)
  if (!CLAUDE_ARGS.test(args)) throw new Error('Los argumentos de Claude tienen caracteres no permitidos.')
  if (!extraArgs.every((a) => EXTRA_ARG.test(a))) throw new Error('Argumento de Claude no admitido.')
  const env = { ...baseEnv(), ...extraEnv }
  const claudeArgs = [...args.split(/\s+/).filter(Boolean), ...extraArgs]
  // Nueva pestaña en la última ventana (crea una si no hay) o ventana nueva.
  const wtArgs = ['-w', newWindow ? 'new' : '0', 'nt', '-d', dir, '--title', title, 'claude', ...claudeArgs]
  const child = spawn('wt.exe', wtArgs, { env, detached: true, stdio: 'ignore' })
  child.on('error', () => {
    // Fallback sin Windows Terminal. `dir` es el repo: cmd.exe por ruta absoluta y sin buscar
    // `claude` en la carpeta actual, que recibiría los secretos de la bóveda.
    const line = claudeArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
    const cmd = comspec()
    spawn(cmd, ['/c', `start "" "${cmd}" /k claude ${line}`.trim()], {
      cwd: dir,
      env: { ...env, ...NO_CWD_EXE },
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true
    }).unref()
  })
  child.unref()
}

// Terminal normal (PowerShell 7) en `dir`: entorno completo del usuario y ningún secreto.
export function openShell(dir, title) {
  if (!existsSync(dir)) throw new Error(`No existe el directorio: ${dir}`)
  const pwsh = whichWin('pwsh.exe', [join(process.env.PROGRAMFILES || '', 'PowerShell', '7')])
  if (!pwsh)
    throw new Error(
      'No se encuentra PowerShell 7 (pwsh). Instálalo con `winget install Microsoft.PowerShell`.'
    )
  const child = spawn('wt.exe', ['-w', '0', 'nt', '-d', dir, '--title', title, pwsh], {
    detached: true,
    stdio: 'ignore'
  })
  child.on('error', () => {
    // Fallback sin Windows Terminal: consola propia de pwsh.
    spawn(pwsh, ['-NoExit'], { cwd: dir, detached: true, stdio: 'ignore' }).unref()
  })
  child.unref()
}
