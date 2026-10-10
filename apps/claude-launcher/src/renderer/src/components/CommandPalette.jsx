import { useEffect, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { FolderGit2, FolderKanban, GitBranch, History, House, Plus } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@/components/ui/command'
import { wtLabel } from '@/components/WorktreeSection'
import { api } from '@/lib/api'
import { ClaudeIcon } from '@/lib/brandIcons'
import { useDashboard } from '@/lib/queries'
import { useLaunch } from '@/lib/useLaunch'
import { timeAgo } from '@/lib/format'

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const searchShortcut = isMac ? '⌘K' : 'Ctrl+K'

// Paleta global (Ctrl+K / ⌘K): busca proyectos, repos, worktrees y sesiones recientes.
export function CommandPalette({ open, onOpenChange, projects, onSelect, onNewProject }) {
  const launch = useLaunch()
  const { data } = useDashboard()

  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        onOpenChange((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpenChange])

  const repos = projects.flatMap((p) => p.repos.map((r) => ({ project: p, repo: r })))
  // Los worktrees solo se piden con la paleta abierta (comparten caché con las tarjetas de repo).
  const worktrees = useQueries({
    queries: repos.map(({ repo }) => ({
      queryKey: ['worktrees', repo.path],
      queryFn: () => api.worktrees(repo.path),
      enabled: open
    }))
  })

  const wtItems = repos.flatMap(({ project, repo }, i) =>
    (worktrees[i]?.data ?? []).map((wt) => ({ project, repo, wt, title: `${repo.name}:${wtLabel(wt)}` }))
  )

  const recent = []
  for (const l of data?.launches ?? []) {
    if (!recent.some((r) => r.dir === l.dir)) recent.push(l)
    if (recent.length === 10) break
  }
  const projectName = (id) => projects.find((p) => p.id === id)?.name

  const run = (fn) => () => {
    onOpenChange(false)
    fn()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Buscar en todo"
      description="Proyectos, repositorios, worktrees y sesiones"
      className="sm:max-w-xl"
    >
      <CommandInput placeholder="Buscar proyectos, repos, worktrees, sesiones…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>Sin resultados.</CommandEmpty>

        <CommandGroup heading="Acciones">
          <CommandItem value="action:home Inicio" onSelect={run(() => onSelect(null))}>
            <House /> Ir a Inicio
          </CommandItem>
          <CommandItem value="action:new Nuevo proyecto" onSelect={run(onNewProject)}>
            <Plus /> Nuevo proyecto
          </CommandItem>
        </CommandGroup>

        {projects.length > 0 && (
          <CommandGroup heading="Proyectos">
            {projects.map((p) => (
              <CommandItem key={p.id} value={`project:${p.id} ${p.name}`} onSelect={run(() => onSelect(p.id))}>
                <FolderKanban /> {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {repos.length > 0 && (
          <CommandGroup heading="Repositorios">
            {repos.map(({ project, repo }) => (
              <CommandItem
                key={repo.id}
                value={`repo:${repo.id} ${repo.name} ${project.name}`}
                keywords={[repo.path]}
                onSelect={run(() => onSelect(project.id))}
              >
                <FolderGit2 />
                <span className="truncate">{repo.name}</span>
                <CommandShortcut className="tracking-normal">{project.name}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {wtItems.length > 0 && (
          <CommandGroup heading="Abrir Claude en worktree">
            {wtItems.map(({ project, repo, wt, title }) => (
              <CommandItem
                key={wt.path}
                value={`wt:${wt.path} ${title} ${project.name}`}
                keywords={[wt.path]}
                onSelect={run(() => launch(wt.path, title, { projectId: project.id, repoId: repo.id }))}
              >
                <GitBranch />
                <span className="truncate">{title}</span>
                <CommandShortcut className="tracking-normal">{project.name}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {recent.length > 0 && (
          <CommandGroup heading="Sesiones recientes">
            {recent.map((l) => (
              <CommandItem
                key={l.dir}
                value={`session:${l.dir} ${l.title} ${projectName(l.projectId) ?? ''}`}
                keywords={[l.dir]}
                onSelect={run(() =>
                  launch(
                    l.dir,
                    l.title,
                    l.projectId && projectName(l.projectId) ? { projectId: l.projectId, repoId: l.repoId } : undefined
                  )
                )}
              >
                <History />
                <span className="truncate">{l.title}</span>
                <CommandShortcut className="flex items-center gap-1 tracking-normal">
                  <ClaudeIcon className="size-3" /> {timeAgo(l.at)}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
