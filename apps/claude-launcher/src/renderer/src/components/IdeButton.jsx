import { Check, Code } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { useAction, useIdes } from '@/lib/queries'

// Abre `dir` en el IDE elegido; pasar `id` lo deja como predeterminado.
function useOpenIde(dir) {
  return useAction((id) => api.ide.open(dir, id), {
    onSuccess: (name) => toast.success(`Abriendo en ${name}`)
  })
}

function currentIde(data) {
  return data?.ides.find((i) => i.id === data.selected) || data?.ides[0]
}

export function IdeButton({ dir, size = 'icon-sm' }) {
  const { data } = useIdes()
  const open = useOpenIde(dir)
  const ide = currentIde(data)

  return (
    <Button
      size={size}
      variant="ghost"
      disabled={!ide}
      title={ide ? `Abrir en ${ide.name}` : 'No se ha encontrado ningún IDE'}
      onClick={() => open.mutate()}
    >
      <Code />
    </Button>
  )
}

// Submenú «Abrir con…» (y su separador) para los menús de acciones: elige otro IDE y lo recuerda.
export function IdeSubmenu({ dir }) {
  const { data } = useIdes()
  const open = useOpenIde(dir)
  const ide = currentIde(data)
  if (!data?.ides.length) return null

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Code /> Abrir con…
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {data.ides.map((i) => (
            <DropdownMenuItem key={i.id} onSelect={() => open.mutate(i.id)}>
              <Check className={i.id === ide?.id ? '' : 'invisible'} /> {i.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
    </>
  )
}
