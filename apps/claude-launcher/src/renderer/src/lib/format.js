const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60]
]

// "hace 3 horas", "ayer", ...
export function timeAgo(iso) {
  if (!iso) return null
  const secs = (new Date(iso).getTime() - Date.now()) / 1000
  for (const [unit, size] of UNITS) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit)
  }
  return 'ahora mismo'
}

// plural(1, 'archivo', 'archivos') -> '1 archivo'
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
