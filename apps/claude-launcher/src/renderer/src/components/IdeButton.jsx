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
import { ideIcon } from '@/lib/brandIcons'
import { useAction, useIdes } from '@/lib/queries'
import { cn } from '@/lib/utils'

// Abre `dir` en el IDE predeterminado o, con `id`, en ese otro.
function useOpenIde(dir) {
  return useAction((id) => api.ide.open(dir, id), {
    onSuccess: (name) => toast.success(`Abriendo en ${name}`)
  })
}

// Solo los instalados; el predeterminado es el elegido en Configuración o el primero que haya.
export function useInstalledIdes() {
  const { data } = useIdes()
  const ides = data?.ides.filter((i) => i.path) ?? []
  return { ides, current: ides.find((i) => i.id === data?.selected) || ides[0] }
}

export function IdeButton({ dir, size = 'icon-sm' }) {
  const { current: ide } = useInstalledIdes()
  const open = useOpenIde(dir)
  const Icon = ideIcon(ide?.id)

  return (
    <Button
      size={size}
      variant="ghost"
      disabled={!ide}
      title={ide ? `Abrir en ${ide.name}` : 'No se ha encontrado ningún IDE'}
      onClick={() => open.mutate()}
    >
      <Icon />
    </Button>
  )
}

// Submenú «Abrir con…» (y su separador) para los menús de acciones: abre en otro IDE una vez.
export function IdeSubmenu({ dir }) {
  const { ides, current: ide } = useInstalledIdes()
  const open = useOpenIde(dir)
  if (!ides.length) return null

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Code /> Abrir con…
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {ides.map((i) => {
            const Icon = ideIcon(i.id)
            return (
              <DropdownMenuItem key={i.id} onSelect={() => open.mutate(i.id)}>
                <Icon /> {i.name}
                <Check className={cn('ml-auto', i.id !== ide?.id && 'invisible')} />
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
    </>
  )
}
