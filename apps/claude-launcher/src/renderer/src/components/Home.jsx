import { AlertTriangle, Clock, FolderGit2, GitBranch, GraduationCap, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDashboard } from '@/lib/queries'
import { plural, timeAgo } from '@/lib/format'
import { useLaunch } from '@/lib/useLaunch'

const WEEK_MS = 7 * 24 * 3600 * 1000

function maxDate(...isos) {
  const valid = isos.filter(Boolean)
  return valid.length ? valid.reduce((a, b) => (a > b ? a : b)) : null
}

export function Home({ projects, onSelect, onTutorial }) {
  const { data } = useDashboard()
  const launch = useLaunch()
  const summaries = data?.repos ?? {}
  const launches = data?.launches ?? []

  const repos = projects.flatMap((p) => p.repos)
  const sum = (fn) => repos.reduce((n, r) => n + (fn(summaries[r.id]) || 0), 0)
  const weekAgo = new Date(Date.now() - WEEK_MS).toISOString()

  const stats = [
    { label: 'Proyectos', value: projects.length },
    { label: 'Repositorios', value: repos.length },
    { label: 'Worktrees activos', value: data ? sum((s) => s?.worktreeCount) : '–' },
    {
      label: 'Worktrees con cambios sin commitear',
      value: data ? sum((s) => s?.dirtyWorktrees) : '–',
      warn: true
    },
    { label: 'Sesiones de Claude (7 días)', value: data ? launches.filter((l) => l.at > weekAgo).length : '–' }
  ]

  // Tarjetas de proyecto ordenadas por actividad reciente (commit o sesión de Claude).
  const cards = projects
    .map((p) => {
      const s = p.repos.map((r) => summaries[r.id]).filter(Boolean)
      const lastLaunch = launches.find((l) => l.projectId === p.id)?.at
      const lastCommit = maxDate(...s.map((x) => x.lastCommitAt))
      return {
        project: p,
        worktrees: s.reduce((n, x) => n + (x.worktreeCount || 0), 0),
        dirtyWorktrees: s.reduce((n, x) => n + (x.dirtyWorktrees || 0), 0),
        brokenRepos: s.filter((x) => x.error).length,
        lastCommit,
        lastLaunch,
        lastActivity: maxDate(lastCommit, lastLaunch)
      }
    })
    .sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''))

  // Últimas sesiones, una por carpeta.
  const recent = []
  for (const l of launches) {
    if (!recent.some((r) => r.dir === l.dir)) recent.push(l)
    if (recent.length === 5) break
  }
  const projectName = (id) => projects.find((p) => p.id === id)?.name

  return (
    <section className="flex flex-col gap-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Inicio</h1>
          <p className="text-sm text-muted-foreground">Resumen de tus proyectos y sesiones de Claude.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onTutorial}>
          <GraduationCap /> Ver tutorial
        </Button>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border bg-card px-4 py-3">
            <div className="flex items-center gap-1.5 text-3xl font-semibold tabular-nums">
              {s.value}
              {s.warn && s.value > 0 && <AlertTriangle className="size-5 text-yellow-500" aria-label="atención" />}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {recent.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs tracking-widest text-muted-foreground uppercase">Sesiones recientes</h2>
          <ul className="flex flex-col gap-1">
            {recent.map((l) => (
              <li key={l.dir} className="flex items-center justify-between gap-3 rounded-md bg-card px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{l.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {projectName(l.projectId) ?? 'Proyecto eliminado'} · {timeAgo(l.at)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    launch(l.dir, l.title, l.projectId && projectName(l.projectId) ? { projectId: l.projectId, repoId: l.repoId } : undefined)
                  }
                >
                  <Terminal /> Reabrir
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-xs tracking-widest text-muted-foreground uppercase">Proyectos</h2>
        {!projects.length && (
          <p className="text-muted-foreground">Aún no tienes proyectos. Crea uno con «Nuevo proyecto» o sigue el tutorial.</p>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {cards.map((c) => (
            <button
              key={c.project.id}
              onClick={() => onSelect(c.project.id)}
              className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/60"
            >
              <div className="truncate text-base font-semibold">{c.project.name}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <FolderGit2 className="size-4" /> {plural(c.project.repos.length, 'repo', 'repos')}
                </span>
                <span className="flex items-center gap-1.5">
                  <GitBranch className="size-4" /> {plural(c.worktrees, 'worktree', 'worktrees')}
                </span>
              </div>
              {(c.dirtyWorktrees > 0 || c.brokenRepos > 0) && (
                <div className="flex flex-col gap-1 text-sm text-yellow-500">
                  {c.dirtyWorktrees > 0 && (
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="size-4" /> {plural(c.dirtyWorktrees, 'worktree', 'worktrees')} con cambios sin commitear
                    </span>
                  )}
                  {c.brokenRepos > 0 && (
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="size-4" /> {plural(c.brokenRepos, 'repo no accesible', 'repos no accesibles')}
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="size-3.5" /> Último commit: {timeAgo(c.lastCommit) ?? '—'}
                </span>
                <span className="flex items-center gap-1.5">
                  <Terminal className="size-3.5" /> Última sesión: {timeAgo(c.lastLaunch) ?? 'nunca'}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
