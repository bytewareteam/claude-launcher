import { useState } from 'react'
import { Coffee, House, KeyRound, PanelLeftClose, Plus, Search, Settings } from 'lucide-react'
import { isMac, searchShortcut } from '@/components/CommandPalette'
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
import { api } from '@/lib/api'
import { useAction } from '@/lib/queries'
import { extIcon } from '@/lib/extIcons'
import { GithubIcon } from '@/lib/brandIcons'
import { cn } from '@/lib/utils'
import logo from '@claude-launcher/design-tokens/logo.svg'
import { version } from '../../../../package.json'

export const sidebarShortcut = isMac ? '⌘ ×2' : 'Ctrl ×2'

const navItem = (active) =>
  cn(
    'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-sidebar-accent',
    active && 'bg-sidebar-accent shadow-[inset_3px_0_0_var(--primary)]'
  )

export function Sidebar({
  projects,
  extViews,
  selectedId,
  onSelect,
  onSearch,
  onClose,
  newProjectOpen,
  onNewProjectOpenChange
}) {
  return (
    <aside className="flex h-full w-[260px] flex-col border-r bg-sidebar">
      <header className="flex items-center gap-2 py-3 pr-2 pl-4 font-bold tracking-wide text-primary">
        <img src={logo} alt="" className="size-7" /> Claude Launcher
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto text-muted-foreground"
          title={`Ocultar menú (${sidebarShortcut})`}
          onClick={onClose}
        >
          <PanelLeftClose />
        </Button>
      </header>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <NewProjectDialog open={newProjectOpen} onOpenChange={onNewProjectOpenChange} onCreated={onSelect} />
        <Button variant="outline" className="w-full justify-start text-muted-foreground" onClick={onSearch}>
          <Search /> Buscar en todo
          <kbd className="ml-auto rounded border bg-muted px-1.5 font-mono text-[10px]">{searchShortcut}</kbd>
        </Button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        <button onClick={() => onSelect(null)} className={navItem(selectedId === null)}>
          <span className="flex items-center gap-2">
            <House className="size-4" /> Inicio
          </span>
        </button>
        <ul className="mt-1 space-y-0.5 border-t pt-1">
          {projects.map((p) => (
            <li key={p.id}>
              <button onClick={() => onSelect(p.id)} className={navItem(p.id === selectedId)}>
                <span className="truncate">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.repos.length}</span>
              </button>
            </li>
          ))}
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
        <button onClick={() => onSelect('vault')} className={navItem(selectedId === 'vault')}>
          <span className="flex items-center gap-2 text-muted-foreground">
            <KeyRound className="size-4" /> Bóveda
          </span>
        </button>
        <button onClick={() => onSelect('settings')} className={navItem(selectedId === 'settings')}>
          <span className="flex items-center gap-2 text-muted-foreground">
            <Settings className="size-4" /> Configuración
          </span>
        </button>
        <div className="flex items-center gap-1 px-3 pt-1 text-xs text-muted-foreground">
          <span className="mr-auto">v{version}</span>
          {/* Los enlaces con target _blank los abre el navegador (setWindowOpenHandler). */}
          <Button variant="ghost" size="icon-xs" asChild title="Código en GitHub">
            <a href="https://github.com/bytewareteam/claude-launcher" target="_blank" rel="noreferrer">
              <GithubIcon />
            </a>
          </Button>
          <Button variant="ghost" size="icon-xs" asChild title="Invítame a un café">
            <a href="https://buymeacoffee.com/wmonoga" target="_blank" rel="noreferrer">
              <Coffee />
            </a>
          </Button>
        </div>
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

