import { useState } from 'react'
import { House, Lock, LockOpen, Plus, Search, Settings, ShieldPlus } from 'lucide-react'
import { SearchInput } from '@/components/SearchInput'
import { searchShortcut } from '@/components/CommandPalette'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { useAskVault } from '@/components/VaultProvider'
import { api } from '@/lib/api'
import { useAction, useVaultStatus } from '@/lib/queries'
import { extIcon } from '@/lib/extIcons'
import { cn } from '@/lib/utils'
import logo from '@claude-launcher/design-tokens/logo.svg'

const navItem = (active) =>
  cn(
    'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-sidebar-accent',
    active && 'bg-sidebar-accent shadow-[inset_3px_0_0_var(--primary)]'
  )

export function Sidebar({ projects, extViews, selectedId, onSelect, onSearch, newProjectOpen, onNewProjectOpenChange }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  // Coincide por nombre del proyecto o de cualquiera de sus repos.
  const visible = projects.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.repos.some((r) => r.name.toLowerCase().includes(q))
  )

  return (
    <aside className="flex min-h-0 flex-col border-r bg-sidebar">
      <header className="flex items-center gap-2 px-4 pt-5 pb-3 font-bold tracking-wide text-primary">
        <img src={logo} alt="" className="size-7" /> Claude Launcher
      </header>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <NewProjectDialog open={newProjectOpen} onOpenChange={onNewProjectOpenChange} onCreated={onSelect} />
        <Button variant="outline" className="w-full justify-start text-muted-foreground" onClick={onSearch}>
          <Search /> Buscar en todo
          <kbd className="ml-auto rounded border bg-muted px-1.5 font-mono text-[10px]">{searchShortcut}</kbd>
        </Button>
        <SearchInput value={query} onChange={setQuery} placeholder="Buscar proyecto o repo…" />
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        <button onClick={() => onSelect(null)} className={navItem(selectedId === null)}>
          <span className="flex items-center gap-2">
            <House className="size-4" /> Inicio
          </span>
        </button>
        <ul className="mt-1 space-y-0.5 border-t pt-1">
          {visible.map((p) => (
            <li key={p.id}>
              <button onClick={() => onSelect(p.id)} className={navItem(p.id === selectedId)}>
                <span className="truncate">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.repos.length}</span>
              </button>
            </li>
          ))}
          {q && !visible.length && <li className="px-3 py-2 text-sm text-muted-foreground">Sin resultados.</li>}
        </ul>
        {extViews.length > 0 && (
          <ul className="mt-1 space-y-0.5 border-t pt-1">
            {extViews.map(({ key, view }) => {
              const Icon = extIcon(view.icon)
              return (
                <li key={key}>
                  <button onClick={() => onSelect(key)} className={navItem(key === selectedId)}>
                    <span className="flex items-center gap-2 truncate">
                      <Icon className="size-4" /> {view.title}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </nav>
      <footer className="flex flex-col gap-1 border-t p-3">
        <VaultButton />
        <button onClick={() => onSelect('settings')} className={navItem(selectedId === 'settings')}>
          <span className="flex items-center gap-2 text-muted-foreground">
            <Settings className="size-4" /> Configuración
          </span>
        </button>
      </footer>
    </aside>
  )
}

function NewProjectDialog({ open, onOpenChange: setOpen, onCreated }) {
  const [name, setName] = useState('')
  const addProject = useAction(api.addProject, {
    onSuccess: (id) => {
      setOpen(false)
      setName('')
      onCreated(id)
    }
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          <Plus /> Nuevo proyecto
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) addProject.mutate(name.trim())
          }}
        >
          <DialogHeader>
            <DialogTitle>Nuevo proyecto</DialogTitle>
            <DialogDescription>Después podrás añadirle sus repositorios.</DialogDescription>
          </DialogHeader>
          <Input autoFocus placeholder="Nombre del proyecto" value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || addProject.isPending}>
              Crear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function VaultButton() {
  const { data: vault } = useVaultStatus()
  const askVault = useAskVault()
  const lock = useAction(api.vault.lock)
  if (!vault) return null

  if (vault.unlocked)
    return (
      <Button variant="outline" className="w-full justify-start border-primary/60 text-primary" onClick={() => lock.mutate()}>
        <LockOpen /> Bloquear bóveda
      </Button>
    )
  return (
    <Button variant="outline" className="w-full justify-start" title={vault.path} onClick={() => askVault()}>
      {vault.exists ? <Lock /> : <ShieldPlus />}
      {vault.exists ? 'Desbloquear bóveda' : 'Crear bóveda de secretos'}
    </Button>
  )
}
