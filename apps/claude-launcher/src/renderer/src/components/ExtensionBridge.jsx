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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

// Atiende lo que las extensiones piden a la interfaz: avisos, refrescos, selecciones y textos.
export function ExtensionBridge() {
  const qc = useQueryClient()
  // Cola de selecciones pendientes; se muestran de una en una.
  const [picks, setPicks] = useState([])
  const pick = picks[0]
  const [inputs, setInputs] = useState([])

  useEffect(() => {
    const offs = [
      api.extensions.onChanged((extId, viewId) =>
        qc.invalidateQueries({ queryKey: ['ext-view', extId, ...(viewId ? [viewId] : [])] })
      ),
      api.extensions.onToast(({ from, message, kind }) =>
        (kind === 'error' ? toast.error : toast)(message, { description: from })
      ),
      api.extensions.onQuickPick((req) => setPicks((list) => [...list, req])),
      api.extensions.onInput((req) => setInputs((list) => [...list, req]))
    ]
    return () => offs.forEach((off) => off())
  }, [qc])

  const answer = (value) => {
    api.extensions.reply(pick.id, value)
    setPicks((list) => list.slice(1))
  }

  const reply = (value) => {
    api.extensions.reply(inputs[0].id, value)
    setInputs((list) => list.slice(1))
  }

  return (
    <>
      {/* `key`: cada petición empieza con su propio valor inicial. */}
      {inputs[0] && <InputDialog key={inputs[0].id} req={inputs[0]} onAnswer={reply} />}
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
    </>
  )
}

function InputDialog({ req, onAnswer }) {
  const [value, setValue] = useState(req.value)
  return (
    <Dialog open onOpenChange={(open) => !open && onAnswer(null)}>
      <DialogContent>
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            onAnswer(value)
          }}
        >
          <DialogHeader>
            <DialogTitle>{req.title || req.from}</DialogTitle>
            <DialogDescription>{req.description || (req.title ? req.from : '')}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            type={req.password ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            placeholder={req.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onAnswer(null)}>
              Cancelar
            </Button>
            <Button type="submit">Aceptar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
