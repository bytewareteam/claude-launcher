// Copia de secretos al portapapeles sin que queden en el historial (Win+V) ni en la nube de Windows.
import { clipboard } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'

// Formatos que el historial y la sincronización de Windows respetan: si están junto al texto, no lo
// guardan. Deben ir en la misma escritura que el texto, y Electron solo escribe un formato
// personalizado por llamada (cada escritura vacía el portapapeles), así que lo hace .NET.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()))
$data = New-Object System.Windows.Forms.DataObject
$data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $text)
foreach ($f in 'ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard') {
  $data.SetData($f, (New-Object System.IO.MemoryStream (,[byte[]](0, 0, 0, 0))))
}
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 100)
`

// Windows PowerShell siempre está en System32: no se busca en PATH ni en la carpeta de un repo.
const powershell = () =>
  join(
    process.env.SYSTEMROOT || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )

function writeExcluded(text) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    const child = spawn(
      powershell(),
      ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }
    )
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `código ${code}`))
    )
    // El secreto va por stdin (en base64 para no depender de la página de códigos), nunca en
    // la línea de comandos.
    child.stdin.end(Buffer.from(text, 'utf8').toString('base64'))
  })
}

// Escribe `text` excluido del historial; si no se puede, lo copia igualmente (se sigue limpiando
// pasado el plazo).
export async function writeSecret(text) {
  if (process.platform === 'win32') {
    try {
      await writeExcluded(text)
      if (clipboard.readText() === text) return
    } catch (err) {
      console.warn('No se pudo excluir el secreto del historial del portapapeles:', err.message)
    }
  }
  clipboard.writeText(text)
}
