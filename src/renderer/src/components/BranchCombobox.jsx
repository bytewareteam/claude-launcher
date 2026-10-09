import { useState } from 'react'
import { Check, ChevronsUpDown, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { errMsg } from '@/lib/api'
import { useRemoteBranches } from '@/lib/queries'
import { cn } from '@/lib/utils'

// Desplegable con autocompletado de las ramas remotas de un repo.
export function BranchCombobox({ repoPath, value, onChange }) {
  const [open, setOpen] = useState(false)
  const { data: branches = [], isPending, error } = useRemoteBranches(repoPath, open)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          title="Rama principal con la que se comparan los worktrees"
          className="max-w-64 justify-between font-mono text-xs"
        >
          <GitBranch />
          <span className="truncate">{value}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder="Buscar rama remota…" />
          <CommandList>
            <CommandEmpty>
              {isPending ? 'Cargando ramas…' : error ? errMsg(error) : 'No hay ramas con ese nombre.'}
            </CommandEmpty>
            <CommandGroup>
              {branches.map((b) => (
                <CommandItem
                  key={b}
                  value={b}
                  className="font-mono text-xs"
                  onSelect={() => {
                    onChange(b)
                    setOpen(false)
                  }}
                >
                  <Check className={cn(b === value ? 'opacity-100' : 'opacity-0')} />
                  {b}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
