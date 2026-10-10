import { spawn } from 'child_process'
import { existsSync } from 'fs'

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

// Windows Terminal pasa el entorno de quien lo invoca a la pestaña nueva,
// así los secretos no aparecen en la línea de comandos.
export function openClaude(dir, title, extraEnv = {}) {
  if (!existsSync(dir)) throw new Error(`No existe el directorio: ${dir}`)
  const env = { ...baseEnv(), ...extraEnv }
  // Nueva pestaña en la última ventana (crea una si no hay).
  const wtArgs = ['-w', '0', 'nt', '-d', dir, '--title', title, 'claude']
  const child = spawn('wt.exe', wtArgs, { env, detached: true, stdio: 'ignore' })
  child.on('error', () => {
    // Fallback sin Windows Terminal.
    spawn('cmd.exe', ['/c', 'start "" cmd /k claude'], {
      cwd: dir,
      env,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true
    }).unref()
  })
  child.unref()
}
