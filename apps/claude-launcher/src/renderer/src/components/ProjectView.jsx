import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, FolderOpen, FolderPlus, KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EnvPanel } from '@/components/EnvSection'
import { ExtensionView } from '@/components/ExtensionView'
import { RepoCard } from '@/components/RepoCard'
import { SearchInput } from '@/components/SearchInput'
import { api } from '@/lib/api'
import { extIcon } from '@/lib/extIcons'
import { useAction, useExtensions, useVars } from '@/lib/queries'
import { useRememberedOpen } from '@/lib/useRememberedOpen'

export function ProjectView({ project, onRemoved }) {
  const qc = useQueryClient()
  const removeProject = useAction(() => api.removeProject(project.id), { onSuccess: onRemoved })
  const { data: extensions = [] } = useExtensions()
  // Pestañas que añaden las extensiones activas (p. ej. el board de Azure DevOps).
  const enabled = extensions.filter((e) => e.enabled)
  const extTabs = enabled.flatMap((e) =>
    (e.projectTabs ?? []).map((v) => ({ key: `${e.id}/${v.id}`, extension: e, view: v }))
  )
  // Extensiones de repositorios remotos (GitHub, Azure DevOps…) desde las que clonar.
  const repoSources = enabled.flatMap((e) =>
    (e.repoSources ?? []).map((v) => ({ key: `${e.id}/${v.id}`, extension: e, view: v }))
  )
  const [savedTab, setTab] = useRememberedOpen(`project-tab:${project.id}`, 'repos')
  const tab = extTabs.some((t) => t.key === savedTab) ? savedTab : 'repos'

  const repos = <Repos project={project} />

  return (
    <section>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <ProjectTitle project={project} />
        <div className="flex gap-2">
          {tab === 'repos' && (
            <>
              <AddRepoButton project={project} sources={repoSources} />
              <ProjectVarsButton project={project} />
              <Button
                variant="outline"
                size="icon"
                title="Recargar worktrees"
                onClick={() => qc.invalidateQueries({ queryKey: ['worktrees'] })}
              >
                <RefreshCw />
              </Button>
            </>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="text-destructive">
                <Trash2 /> Eliminar proyecto
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar «{project.name}»?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se quita de la lista con sus repos. No se borran archivos ni los secretos de la
                  bóveda.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => removeProject.mutate()}>
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      {extTabs.length ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="repos">Repositorios</TabsTrigger>
            {extTabs.map((t) => {
              const Icon = extIcon(t.view.icon)
              return (
                <TabsTrigger key={t.key} value={t.key}>
                  <Icon /> {t.view.title}
                </TabsTrigger>
              )
            })}
          </TabsList>
          <TabsContent value="repos" className="mt-3">
            {repos}
          </TabsContent>
          {extTabs.map((t) => (
            <TabsContent key={t.key} value={t.key} className="mt-3">
              <ExtensionView extension={t.extension} view={t.view} projectId={project.id} />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        repos
      )}
    </section>
  )
}

function Repos({ project }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const repos = project.repos.filter(
    (r) => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
  )

  return (
    <>
      {project.repos.length > 1 && (
        <div className="mb-3 max-w-sm">
          <SearchInput value={query} onChange={setQuery} placeholder="Buscar repositorio…" />
        </div>
      )}

      {!project.repos.length && (
        <p className="text-muted-foreground">Este proyecto no tiene repositorios todavía.</p>
      )}
      {project.repos.length > 0 && !repos.length && (
        <p className="text-muted-foreground">Ningún repositorio coincide con «{query}».</p>
      )}
      {/* Dos columnas cuando el área de contenido es ancha (container query, no el viewport). */}
      <div className="@container">
        <div className="grid items-start gap-3 @5xl:grid-cols-2">
          {repos.map((r) => (
            <RepoCard key={r.id} project={project} repo={r} />
          ))}
        </div>
      </div>
    </>
  )
}

// Sin extensiones de repositorios abre el selector de carpetas; con ellas, un menú para elegir
// entre una carpeta local o clonar desde el remoto.
function AddRepoButton({ project, sources }) {
  const [source, setSource] = useState(null)
  const addLocal = useAction(async () => {
    const path = await api.pickRepo()
    if (path) await api.addRepo(project.id, path)
  })

  if (!sources.length)
    return (
      <Button onClick={() => addLocal.mutate()}>
        <FolderPlus /> Añadir repositorio
      </Button>
    )

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <FolderPlus /> Añadir repositorio <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => addLocal.mutate()}>
            <FolderOpen /> Desde una carpeta…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {sources.map((s) => {
            const Icon = extIcon(s.view.icon)
            return (
              <DropdownMenuItem key={s.key} onSelect={() => setSource(s)}>
                <Icon /> Clonar desde {s.view.title}…
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!source} onOpenChange={(open) => !open && setSource(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Clonar desde {source?.view.title}</DialogTitle>
            <DialogDescription>
              El repositorio clonado se añade a «{project.name}».
            </DialogDescription>
          </DialogHeader>
          {source && (
            <div className="-mx-1 min-h-0 overflow-y-auto px-1">
              <ExtensionView
                extension={source.extension}
                view={source.view}
                projectId={project.id}
                onResult={(res) => res?.close && setSource(null)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function ProjectVarsButton({ project }) {
  const scope = { projectId: project.id }
  const { data: vars } = useVars(scope)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" title="Variables del proyecto (todas sus sesiones)">
          <KeyRound /> Variables
          {vars?.length > 0 && <Badge variant="secondary">{vars.length}</Badge>}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Variables de «{project.name}»</DialogTitle>
          <DialogDescription>
            Se inyectan en todas las sesiones de Claude del proyecto, en cualquiera de sus repos.
          </DialogDescription>
        </DialogHeader>
        <EnvPanel scope={scope} />
      </DialogContent>
    </Dialog>
  )
}

// Doble clic para renombrar.
function ProjectTitle({ project }) {
  const [editing, setEditing] = useState(false)
  const rename = useAction((name) => api.renameProject(project.id, name))

  if (!editing)
    return (
      <h1
        className="cursor-text text-2xl font-semibold"
        title="Doble clic para renombrar"
        onDoubleClick={() => setEditing(true)}
      >
        {project.name}
      </h1>
    )

  const finish = (value) => {
    setEditing(false)
    const name = value?.trim()
    if (name && name !== project.name) rename.mutate(name)
  }
  return (
    <Input
      autoFocus
      defaultValue={project.name}
      className="h-10 max-w-sm text-xl font-semibold"
      onFocus={(e) => e.target.select()}
      onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
    />
  )
}
