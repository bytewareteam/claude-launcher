import { useState } from 'react'

// Recuerda qué secciones plegables están abiertas mientras la app sigue abierta.
const opened = new Map()

export function useRememberedOpen(id, defaultOpen = false) {
  const [open, setOpen] = useState(opened.get(id) ?? defaultOpen)
  const update = (value) => {
    opened.set(id, value)
    setOpen(value)
  }
  return [open, update]
}
