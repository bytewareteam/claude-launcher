import { useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useClaudeOptions } from '@/lib/queries'
import { cn } from '@/lib/utils'

const MAX_SUGGESTIONS = 50

// Palabra que se está escribiendo (hasta el cursor) y la anterior, para saber si toca
// sugerir una opción (`--mo…`) o un valor de la opción previa (`--model so…`).
function tokenAt(value, caret) {
  const before = value.slice(0, caret)
  const words = before.split(/\s+/)
  return { token: words.at(-1), previous: words.at(-2), start: caret - words.at(-1).length }
}

function suggestionsFor(options, value, caret) {
  const { token, previous } = tokenAt(value, caret)
  if (token.startsWith('-')) {
    const used = new Set(value.split(/\s+/).filter((w) => w !== token))
    const free = options.filter((o) => !o.flags.some((f) => used.has(f)))
    const starts = free.filter((o) => o.flags.some((f) => f.startsWith(token)))
    const contains = free.filter(
      (o) => !starts.includes(o) && o.flags.some((f) => f.includes(token.replace(/^-+/, '')))
    )
    return [...starts, ...contains].map((o) => ({
      insert: o.flags.find((f) => f.startsWith('--')) ?? o.flags[0],
      label: o.flags.join(', '),
      arg: o.arg,
      description: o.description
    }))
  }
  const option = previous && options.find((o) => o.flags.includes(previous))
  if (!option?.values.length) return []
  return option.values
    .filter((v) => v.startsWith(token) && v !== token)
    .map((v) => ({ insert: v, label: v, description: option.flags.at(-1) }))
}

export function ClaudeArgsInput({ value, onChange, ...props }) {
  const { data: options = [] } = useClaudeOptions()
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)

  const suggestions = suggestionsFor(options, value, caret).slice(0, MAX_SUGGESTIONS)
  const open = focused && !dismissed && suggestions.length > 0
  const current = Math.min(active, suggestions.length - 1)

  const syncCaret = () => setCaret(inputRef.current?.selectionStart ?? value.length)

  const accept = (s) => {
    const { start } = tokenAt(value, caret)
    const rest = value.slice(caret).replace(/^\S*/, '')
    const insert = s.insert + (rest.startsWith(' ') ? '' : ' ')
    const next = value.slice(0, start) + insert + rest
    const pos = start + insert.length
    onChange(next)
    setCaret(pos)
    setActive(0)
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos))
  }

  const move = (delta) => {
    const i = (current + delta + suggestions.length) % suggestions.length
    setActive(i)
    listRef.current?.children[i]?.scrollIntoView({ block: 'nearest' })
  }

  const onKeyDown = (e) => {
    if (!open) return
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'Enter' || e.key === 'Tab') accept(suggestions[current])
    else if (e.key === 'Escape') setDismissed(true)
    else return
    // Con la lista abierta, Enter elige la sugerencia en vez de enviar el formulario.
    e.preventDefault()
  }

  return (
    <div className="relative">
      <Input
        {...props}
        ref={inputRef}
        value={value}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart ?? e.target.value.length)
          setDismissed(false)
          setActive(0)
        }}
        onSelect={syncCaret}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true)
          syncCaret()
        }}
        onBlur={() => setFocused(false)}
      />
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.label}
              role="option"
              aria-selected={i === current}
              // mousedown en vez de click: así el input no pierde el foco antes de elegir.
              onMouseDown={(e) => {
                e.preventDefault()
                accept(s)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'cursor-pointer rounded-sm px-2 py-1.5',
                i === current && 'bg-accent text-accent-foreground'
              )}
            >
              <div className="font-mono text-sm">
                {s.label}
                {s.arg && <span className="ml-1.5 text-muted-foreground">{s.arg}</span>}
              </div>
              {s.description && (
                <div className="line-clamp-2 text-xs text-muted-foreground">{s.description}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
