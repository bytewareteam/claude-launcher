import { Folder, Terminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EnvSection } from '@/components/EnvSection'
import { WorktreeSection } from '@/components/WorktreeSection'
import { api } from '@/lib/api'
import { useAction } from '@/lib/queries'
import { useLaunch } from '@/lib/useLaunch'

export function RepoCard({ project, repo }) {
  const launch = useLaunch()
  const removeRepo = useAction(() => api.removeRepo(project.id, repo.id))
  const scope = { projectId: project.id, repoId: repo.id }

  return (
    <article className="rounded-xl border bg-card px-4 py-3.5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{repo.name}</h2>
          <p className="truncate font-mono text-xs text-muted-foreground">{repo.path}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button onClick={() => launch(repo.path, repo.name, scope)}>
            <Terminal /> Abrir Claude
          </Button>
          <Button variant="outline" onClick={() => api.openFolder(repo.path)}>
            <Folder /> Carpeta
          </Button>
          <Button
            variant="ghost"
            className="text-destructive"
            title="Quitar del proyecto (no borra archivos)"
            onClick={() => removeRepo.mutate()}
          >
            <X /> Quitar
          </Button>
        </div>
      </header>

      <div className="mt-2">
        <EnvSection id={repo.id} scope={scope} label="Variables del repo" />
      </div>
      <WorktreeSection project={project} repo={repo} onLaunch={launch} />
    </article>
  )
}
