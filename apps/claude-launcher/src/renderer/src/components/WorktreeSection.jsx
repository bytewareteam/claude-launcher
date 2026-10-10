import { useState } from 'react'
import { AlertTriangle, ChevronRight, Folder, GitCommit, Terminal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { BranchCombobox } from '@/components/BranchCombobox'
import { api, errMsg } from '@/lib/api'
import { useAction, useWorktrees, useWorktreeStatus } from '@/lib/queries'
import { useRememberedOpen } from '@/lib/useRememberedOpen'
import { plural } from '@/lib/format'

export const DEFAULT_BASE_BRANCH = 'origin/develop'

export const wtLabel = (wt) => wt.branch || (wt.detached ? `detached @ ${wt.head}` : wt.head || '—')

export function WorktreeSection({ project, repo, onLaunch }) {
  const [open, setOpen] = useRememberedOpen(`wt:${repo.id}`)
  const { data: worktrees, isPending, error } = useWorktrees(repo.path)
  const base = repo.baseBranch || DEFAULT_BASE_BRANCH
  const setBase = useAction((branch) => api.setBaseBranch(project.id, repo.id, branch))
  const scope = { projectId: project.id, repoId: repo.id }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <div className="flex items-center justify-between gap-3">
        <CollapsibleTrigger className="group flex items-center gap-1 py-1 text-xs tracking-widest text-muted-foreground uppercase hover:text-foreground">
          <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
          Worktrees {worktrees && `(${worktrees.length})`}
        </CollapsibleTrigger>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Rama principal
          <BranchCombobox repoPath={repo.path} value={base} onChange={(b) => setBase.mutate(b)} />
        </div>
      </div>
      <CollapsibleContent className="pt-1.5">
        {isPending ? (
          <p className="text-sm text-muted-foreground">Cargando worktrees…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{errMsg(error)}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {worktrees.map((wt) => (
              <WorktreeRow
                key={wt.path}
                repo={repo}
                wt={wt}
                base={base}
                onLaunch={() => onLaunch(wt.path, `${repo.name}:${wtLabel(wt)}`, scope)}
              />
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function WorktreeRow({ repo, wt, base, onLaunch }) {
  const [confirming, setConfirming] = useState(false)
  const label = wtLabel(wt)

  return (
    <li className="flex items-center justify-between gap-3 rounded-md bg-secondary px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {label}
          {wt.main && <Badge variant="outline">principal</Badge>}
          {wt.locked && <Badge variant="outline" className="text-yellow-500">bloqueado</Badge>}
          {wt.prunable && <Badge variant="outline" className="text-yellow-500">huérfano</Badge>}
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">{wt.path}</p>
      </div>
      {!wt.bare && (
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" onClick={() => api.openFolder(wt.path)}>
            <Folder /> Carpeta
          </Button>
          <Button size="sm" onClick={onLaunch}>
            <Terminal /> Claude
          </Button>
          {!wt.main && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-destructive"
              title="Eliminar worktree"
              onClick={() => setConfirming(true)}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      )}
      {confirming && (
        <RemoveWorktreeDialog repo={repo} wt={wt} label={label} base={base} onClose={() => setConfirming(false)} />
      )}
    </li>
  )
}

function RemoveWorktreeDialog({ repo, wt, label, base, onClose }) {
  const { data: status, isPending, error } = useWorktreeStatus(wt.path, base, true)
  const remove = useAction((force) => api.removeWorktree(repo.path, wt.path, force), {
    onSuccess: () => toast.success(`Worktree ${label} eliminado`)
  })
  const hasWarnings = status && (status.dirtyCount > 0 || status.aheadCount > 0 || status.baseError)

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar el worktree «{label}»?</AlertDialogTitle>
          <AlertDialogDescription className="break-all">
            Se borra la carpeta {wt.path}. La rama {wt.branch ? `«${wt.branch}» ` : ''}no se elimina.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex min-w-0 flex-col gap-3 text-sm">
          {isPending && <p className="text-muted-foreground">Comprobando cambios…</p>}
          {error && <p className="text-destructive">{errMsg(error)}</p>}
          {status?.missing && (
            <p className="text-muted-foreground">La carpeta ya no existe: solo se limpiará la referencia en git.</p>
          )}
          {status?.dirtyCount > 0 && (
            <Warning title={`${plural(status.dirtyCount, 'archivo', 'archivos')} con cambios sin commitear. Se perderán.`} lines={status.dirty} more={status.dirtyCount} />
          )}
          {status?.aheadCount > 0 && (
            <Warning
              icon={GitCommit}
              title={`${plural(status.aheadCount, 'commit', 'commits')} que no está${status.aheadCount === 1 ? '' : 'n'} en ${base}.`}
              lines={status.ahead}
              more={status.aheadCount}
            />
          )}
          {status?.baseError && <Warning title={status.baseError} />}
          {status && !status.missing && !hasWarnings && (
            <p className="text-muted-foreground">Sin cambios pendientes ni commits fuera de {base}.</p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPending}
            onClick={() => remove.mutate(status?.dirtyCount > 0)}
          >
            {hasWarnings ? 'Eliminar de todos modos' : 'Eliminar worktree'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Warning({ icon: Icon = AlertTriangle, title, lines = [], more = 0 }) {
  return (
    <div className="min-w-0 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3">
      <p className="flex items-center gap-2 font-medium text-yellow-500">
        <Icon className="size-4 shrink-0" /> {title}
      </p>
      {lines.length > 0 && (
        <ul className="mt-2 space-y-0.5 font-mono text-xs text-muted-foreground">
          {lines.map((l) => (
            <li key={l} className="truncate">
              {l}
            </li>
          ))}
          {more > lines.length && <li>… y {more - lines.length} más</li>}
        </ul>
      )}
    </div>
  )
}
