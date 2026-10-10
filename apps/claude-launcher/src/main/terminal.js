import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { whichWin } from './which'

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

// Windows Terminal pasa el entorno de quien lo invoca a la pestaña nueva,
// así los secretos no aparecen en la línea de comandos.
export function openClaude(dir, title, extraEnv = {}, { args = '', newWindow = false } = {}) {
  if (!existsSync(dir)) throw new Error(`No existe el directorio: ${dir}`)
  if (!CLAUDE_ARGS.test(args)) throw new Error('Los argumentos de Claude tienen caracteres no permitidos.')
  const env = { ...baseEnv(), ...extraEnv }
  const claudeArgs = args.split(/\s+/).filter(Boolean)
  // Nueva pestaña en la última ventana (crea una si no hay) o ventana nueva.
  const wtArgs = ['-w', newWindow ? 'new' : '0', 'nt', '-d', dir, '--title', title, 'claude', ...claudeArgs]
  const child = spawn('wt.exe', wtArgs, { env, detached: true, stdio: 'ignore' })
  child.on('error', () => {
    // Fallback sin Windows Terminal.
    spawn('cmd.exe', ['/c', `start "" cmd /k claude ${claudeArgs.join(' ')}`.trim()], {
      cwd: dir,
      env,
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
