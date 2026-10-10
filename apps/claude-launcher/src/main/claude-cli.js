import { exec } from 'child_process'
import { baseEnv } from './terminal'

// Opciones de `claude` para el autocompletado de Configuración. Se leen de `claude --help`
// para seguir siempre a la versión instalada en lugar de mantener una lista a mano.
let cache = null

export function claudeOptions() {
  cache ??= new Promise((resolve) => {
    // Comando fijo, sin datos del usuario: la shell solo resuelve claude.exe/claude.cmd.
    exec('claude --help', { env: baseEnv(), timeout: 15_000, windowsHide: true }, (err, stdout) => {
      // Sin claude instalado no se cachea el fallo: se reintenta la próxima vez.
      if (err) cache = null
      resolve(err ? [] : parseHelp(stdout))
    })
  })
  return cache
}

const IGNORED = new Set(['--help', '--version'])

export function parseHelp(text) {
  const section = text.split(/^Options:\s*$/m)[1]?.split(/^\S.*:\s*$/m)[0] ?? ''
  const raw = []
  for (const line of section.split(/\r?\n/)) {
    const m = line.match(/^ {2}(-\S.*?)(?:\s{2,}(.*))?$/)
    if (m) raw.push({ head: m[1], desc: m[2] ?? '' })
    else if (raw.length && line.trim()) raw.at(-1).desc += ' ' + line.trim()
  }

  return raw
    .map(({ head, desc }) => {
      const arg = head.match(/[<[].*[>\]]/)?.[0] ?? null
      const flags = head.replace(arg ?? '', '').match(/--?[\w-]+/g) ?? []
      return { flags, arg, description: desc.trim(), values: valuesOf(arg, desc) }
    })
    .filter((o) => o.flags.length && !o.flags.some((f) => IGNORED.has(f)))
}

// Valores sugeridos para el argumento: `(choices: "a", "b")`, listas como `(low, medium)`
// y, para el modelo, los alias citados en la descripción ('opus', 'sonnet'…).
function valuesOf(arg, desc) {
  if (!arg) return []
  const choices = desc.match(/\(choices: ([^)]*)\)/)?.[1].split('default:')[0]
  if (choices) return [...new Set([...choices.matchAll(/"([^"]+)"/g)].map((m) => m[1]))]
  const list = desc.match(/\(([a-z]+(?:, [a-z]+)+)\)/)?.[1]
  if (list) return list.split(', ')
  if (arg === '<model>') return [...new Set([...desc.matchAll(/'([a-z]+)'/g)].map((m) => m[1]))]
  return []
}
