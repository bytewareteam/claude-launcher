import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Circle, LoaderCircle, Minus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { BranchCombobox } from '@/components/BranchCombobox'
import { useAskVault } from '@/components/VaultProvider'
import { DEFAULT_BASE_BRANCH } from '@/components/WorktreeSection'
import { api, errMsg } from '@/lib/api'
import { useAction, useProjects, useVaultStatus } from '@/lib/queries'
import { cn } from '@/lib/utils'

// Diálogo «Iniciar desarrollo» que piden las extensiones (`ctx.dev.start`): elige repo y rama,
// y va pidiendo al proceso principal cada paso: worktree, dependencias y Claude en modo plan.
export function DevelopDialog() {
  const [requests, setRequests] = useState([])
  const request = requests[0]

  useEffect(() => api.dev.onRequest((req) => setRequests((list) => [...list, req])), [])

  const close = (cancel) => {
    if (cancel) api.dev.cancel(request.id)
    setRequests((list) => list.slice(1))
  }

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && close(true)}>
      {request && <DevelopForm key={request.id} request={request} onClose={close} />}
    </Dialog>
  )
}

const STEPS = [
  ['worktree', 'Crear el worktree'],
  ['install', 'Instalar dependencias'],
  ['open', 'Abrir Claude Code en modo plan']
]

// Ruta orientativa: la real la decide el proceso principal (dev.worktreePath).
const previewPath = (repoPath, branch) => {
  const sep = repoPath.includes('\\') ? '\\' : '/'
  const parts = repoPath.split(/[\\/]/)
  const name = parts.pop()
  return [...parts, `${name}-worktrees`, ...branch.split('/')].join(sep)
}

function DevelopForm({ request, onClose }) {
  const qc = useQueryClient()
  const askVault = useAskVault()
  const { data: vault } = useVaultStatus()
  const { data: projects = [] } = useProjects()
  const project = projects.find((p) => p.id === request.projectId)
  const repos = project?.repos ?? []
  const [repoId, setRepoId] = useState(request.repoId || repos[0]?.id)
  const [branch, setBranch] = useState(request.branch)
  const [install, setInstall] = useState(true)
  // Estado de cada paso: pending | running | done | skipped | error, con un texto opcional.
  const [steps, setSteps] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const repo = repos.find((r) => r.id === repoId) ?? repos[0]
  const base = repo?.baseBranch || DEFAULT_BASE_BRANCH
  const setBase = useAction((b) => api.setBaseBranch(project.id, repo.id, b))
  // Tras crear el worktree ya no se puede cambiar ni el repo ni la rama.
  const started = !!steps.worktree && steps.worktree.state !== 'error'
  const failedAt = Object.entries(steps).find(([, s]) => s.state === 'error')?.[0]

  const mark = (id, state, detail) => setSteps((s) => ({ ...s, [id]: { state, detail } }))

  async function openClaude() {
    mark('open', 'running')
    const n = await api.dev.open(request.id)
    mark('open', 'done')
    qc.invalidateQueries()
    toast.success(
      n ? `Claude abierto en ${branch} con ${n} variables` : `Claude abierto en ${branch}`
    )
    onClose(false)
  }

  async function run(skipInstall) {
    setError('')
    setBusy(true)
    let step = 'worktree'
    try {
      // La contraseña se pide antes de esperar a la instalación, no al final.
      if (vault?.exists && !vault.unlocked && !(await askVault({ allowSkip: true }))) return
      if (!started) {
        mark('worktree', 'running')
        const wt = await api.dev.worktree(request.id, repo.id, branch.trim())
        mark('worktree', 'done', wt.created ? wt.path : `Ya existía: ${wt.path}`)
        qc.invalidateQueries({ queryKey: ['worktrees'] })
        if (!install || skipInstall || !wt.install)
          mark('install', 'skipped', wt.install ? undefined : 'No se reconoce ningún gestor')
        else {
          step = 'install'
          mark('install', 'running', wt.install)
          await api.dev.install(request.id)
          mark('install', 'done', wt.install)
        }
      } else if (failedAt === 'install' && !skipInstall) {
        step = 'install'
        mark('install', 'running')
        const cmd = await api.dev.install(request.id)
        mark('install', 'done', cmd)
      } else if (failedAt === 'install') mark('install', 'skipped', 'Omitido tras el error')
      step = 'open'
      await openClaude()
    } catch (err) {
      mark(step, 'error')
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    run(false)
  }

  if (!project) return null

  return (
    // Mientras trabaja no se puede cerrar: el principal descartaría la petición a medias.
    <DialogContent
      className="sm:max-w-lg"
      showCloseButton={!busy}
      onEscapeKeyDown={(e) => busy && e.preventDefault()}
      onInteractOutside={(e) => busy && e.preventDefault()}
    >
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Iniciar desarrollo</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {request.title} · {request.from}
          </DialogDescription>
        </DialogHeader>

        {repos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            El proyecto «{project.name}» no tiene repositorios. Añade uno para empezar.
          </p>
        ) : (
          <>
            {repos.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Repositorio</span>
                <div className="flex flex-wrap gap-1.5">
                  {repos.map((r) => (
                    <Button
                      key={r.id}
                      type="button"
                      size="sm"
                      variant={r.id === repo.id ? 'default' : 'outline'}
                      disabled={started || busy}
                      onClick={() => setRepoId(r.id)}
                    >
                      {r.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Rama nueva</span>
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={started || busy}
                spellCheck={false}
                autoFocus
              />
              <span className="truncate text-xs text-muted-foreground" title={repo.path}>
                {previewPath(repo.path, branch.trim() || '…')}
              </span>
            </label>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Desde la rama principal
              {started || busy ? (
                <span className="font-mono text-foreground">{base}</span>
              ) : (
                <BranchCombobox
                  repoPath={repo.path}
                  value={base}
                  onChange={(b) => setBase.mutate(b)}
                />
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={install}
                disabled={started || busy}
                onChange={(e) => setInstall(e.target.checked)}
              />
              Instalar dependencias
              <span className="text-xs text-muted-foreground">
                (npm, pnpm, yarn, bun, uv, poetry o dotnet)
              </span>
            </label>

            {Object.keys(steps).length > 0 && (
              <ol className="flex flex-col gap-1.5 rounded-md bg-secondary p-3 text-sm">
                {STEPS.map(([id, label]) => (
                  <StepRow key={id} label={label} step={steps[id]} />
                ))}
              </ol>
            )}

            {error && (
              <pre className="max-h-40 overflow-auto rounded-md border border-destructive/40 p-2 text-xs whitespace-pre-wrap text-destructive">
                {error}
              </pre>
            )}
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onClose(true)}>
            Cancelar
          </Button>
          {failedAt === 'install' && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => run(true)}>
              Abrir Claude sin instalar
            </Button>
          )}
          {repos.length > 0 && (
            <Button type="submit" disabled={busy || !branch.trim()}>
              {busy && <LoaderCircle className="animate-spin" />}
              {failedAt ? 'Reintentar' : 'Iniciar'}
            </Button>
          )}
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

const ICONS = { running: LoaderCircle, done: Check, skipped: Minus, error: X }

function StepRow({ label, step }) {
  const state = step?.state ?? 'pending'
  const Icon = ICONS[state] ?? Circle
  return (
    <li className="flex min-w-0 items-start gap-2">
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          state === 'running' && 'animate-spin text-muted-foreground',
          state === 'done' && 'text-success',
          state === 'error' && 'text-destructive',
          (state === 'pending' || state === 'skipped') && 'text-muted-foreground'
        )}
      />
      <div className="min-w-0">
        <div className={cn(state === 'pending' && 'text-muted-foreground')}>{label}</div>
        {step?.detail && (
          <div className="truncate text-xs text-muted-foreground" title={step.detail}>
            {step.detail}
          </div>
        )}
      </div>
    </li>
  )
}
