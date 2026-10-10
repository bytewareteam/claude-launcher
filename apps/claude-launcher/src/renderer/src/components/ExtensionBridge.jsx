import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@/components/ui/command'
import { api } from '@/lib/api'

// Atiende lo que las extensiones piden a la interfaz: avisos, refrescos y selecciones.
export function ExtensionBridge() {
  const qc = useQueryClient()
  // Cola de selecciones pendientes; se muestran de una en una.
  const [picks, setPicks] = useState([])
  const pick = picks[0]

  useEffect(() => {
    const offs = [
      api.extensions.onChanged((extId, viewId) =>
        qc.invalidateQueries({ queryKey: ['ext-view', extId, ...(viewId ? [viewId] : [])] })
      ),
      api.extensions.onToast(({ from, message, kind }) =>
        (kind === 'error' ? toast.error : toast)(message, { description: from })
      ),
      api.extensions.onQuickPick((req) => setPicks((list) => [...list, req]))
    ]
    return () => offs.forEach((off) => off())
  }, [qc])

  const answer = (value) => {
    api.extensions.reply(pick.id, value)
    setPicks((list) => list.slice(1))
  }

  return (
    <CommandDialog
      open={!!pick}
      onOpenChange={(open) => !open && answer(null)}
      title={pick?.from ?? ''}
      description={pick?.placeholder ?? ''}
    >
      <CommandInput placeholder={pick?.placeholder || 'Elige una opción…'} />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        {pick?.items.map((it) => (
          <CommandItem key={it.id} value={`${it.id} ${it.label}`} onSelect={() => answer(it.id)}>
            <span className="truncate">{it.label}</span>
            {it.description && (
              <CommandShortcut className="tracking-normal">{it.description}</CommandShortcut>
            )}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
