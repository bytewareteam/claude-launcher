import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderPlus, RefreshCw, Trash2 } from 'lucide-react'
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
import { EnvSection } from '@/components/EnvSection'
import { RepoCard } from '@/components/RepoCard'
import { SearchInput } from '@/components/SearchInput'
import { api } from '@/lib/api'
import { useAction } from '@/lib/queries'

export function ProjectView({ project, onRemoved }) {
  const qc = useQueryClient()
  const addRepo = useAction(async () => {
    const path = await api.pickRepo()
    if (path) await api.addRepo(project.id, path)
  })
  const removeProject = useAction(() => api.removeProject(project.id), { onSuccess: onRemoved })
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const repos = project.repos.filter(
    (r) => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
  )

  return (
    <section>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <ProjectTitle project={project} />
        <div className="flex gap-2">
          <Button onClick={() => addRepo.mutate()}>
            <FolderPlus /> Añadir repositorio
          </Button>
          <Button
            variant="outline"
            title="Recargar worktrees"
            onClick={() => qc.invalidateQueries({ queryKey: ['worktrees'] })}
          >
            <RefreshCw /> Recargar
          </Button>
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
                  Se quita de la lista con sus repos. No se borran archivos ni los secretos de la bóveda.
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

      <div className="mb-4 rounded-xl border bg-card px-4 py-2.5">
        <EnvSection
          id={project.id}
          scope={{ projectId: project.id }}
          label="Variables del proyecto (todas sus sesiones)"
        />
      </div>

      {project.repos.length > 1 && (
        <div className="mb-3 max-w-sm">
          <SearchInput value={query} onChange={setQuery} placeholder="Buscar repositorio…" />
        </div>
      )}

      <div className="flex flex-col gap-3.5">
        {!project.repos.length && (
          <p className="text-muted-foreground">Este proyecto no tiene repositorios todavía.</p>
        )}
        {project.repos.length > 0 && !repos.length && (
          <p className="text-muted-foreground">Ningún repositorio coincide con «{query}».</p>
        )}
        {repos.map((r) => (
          <RepoCard key={r.id} project={project} repo={r} />
        ))}
      </div>
    </section>
  )
}

// Doble clic para renombrar.
function ProjectTitle({ project }) {
  const [editing, setEditing] = useState(false)
  const rename = useAction((name) => api.renameProject(project.id, name))

  if (!editing)
    return (
      <h1 className="cursor-text text-2xl font-semibold" title="Doble clic para renombrar" onDoubleClick={() => setEditing(true)}>
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
