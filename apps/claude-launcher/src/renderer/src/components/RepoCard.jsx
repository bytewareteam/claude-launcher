import { ChevronRight, Ellipsis, Folder, Globe, Terminal, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { EnvSection } from '@/components/EnvSection'
import { IdeButton, IdeSubmenu } from '@/components/IdeButton'
import { WorktreeSection } from '@/components/WorktreeSection'
import { api } from '@/lib/api'
import { useAction, useWorktrees } from '@/lib/queries'
import { useLaunch } from '@/lib/useLaunch'
import { useRememberedOpen } from '@/lib/useRememberedOpen'

export function RepoCard({ project, repo }) {
  const [open, setOpen] = useRememberedOpen(`repo:${repo.id}`)
  const launch = useLaunch()
  const { data: worktrees } = useWorktrees(repo.path)
  const removeRepo = useAction(() => api.removeRepo(project.id, repo.id))
  // useAction para que un repo sin remoto muestre el error como toast.
  const openWeb = useAction(() => api.openWeb(repo.path))
  const scope = { projectId: project.id, repoId: repo.id }
  const extra = worktrees?.filter((w) => !w.main).length

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <article className="rounded-xl border bg-card">
        <header className="flex items-center gap-2 py-2 pr-2 pl-3">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-semibold">{repo.name}</h2>
                {extra > 0 && (
                  <Badge variant="outline" className="shrink-0">
                    {extra} worktree{extra === 1 ? '' : 's'}
                  </Badge>
                )}
              </div>
              <p className="truncate font-mono text-xs text-muted-foreground" title={repo.path}>
                {repo.path}
              </p>
            </div>
          </CollapsibleTrigger>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button size="sm" className="mr-1" onClick={() => launch(repo.path, repo.name, scope)}>
              <Terminal /> Claude
            </Button>
            <IdeButton dir={repo.path} />
            <Button
              size="icon-sm"
              variant="ghost"
              title="Abrir carpeta"
              onClick={() => api.openFolder(repo.path)}
            >
              <Folder />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="Abrir el repositorio remoto en el navegador"
              onClick={() => openWeb.mutate()}
            >
              <Globe />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" title="Más acciones">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <IdeSubmenu dir={repo.path} />
                <DropdownMenuItem variant="destructive" onSelect={() => removeRepo.mutate()}>
                  <X /> Quitar del proyecto
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <CollapsibleContent className="flex flex-col gap-1 border-t px-3 pt-1.5 pb-3">
          <EnvSection id={repo.id} scope={scope} label="Variables del repo" />
          <WorktreeSection project={project} repo={repo} onLaunch={launch} />
        </CollapsibleContent>
      </article>
    </Collapsible>
  )
}
