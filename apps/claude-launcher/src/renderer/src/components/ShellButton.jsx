import { SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useAction } from '@/lib/queries'

// PowerShell 7 en `dir`, sin variables de la bóveda (para eso está «Claude»).
export function ShellButton({ dir, title }) {
  const open = useAction(() => api.openShell(dir, title))

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      title="Abrir terminal (PowerShell 7)"
      onClick={() => open.mutate()}
    >
      <SquareTerminal />
    </Button>
  )
}
