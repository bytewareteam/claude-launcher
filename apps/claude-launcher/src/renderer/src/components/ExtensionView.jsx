import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/SearchInput'
import { api, errMsg } from '@/lib/api'
import { extIcon } from '@/lib/extIcons'
import { useAction, useExtensionView } from '@/lib/queries'
import { cn } from '@/lib/utils'

// Pinta la vista que devuelve una extensión (JSON, ver extensions/README.md). Ningún código
// de la extensión llega al renderer: solo datos que se muestran con nuestros componentes.
export function ExtensionView({ extension, view }) {
  const { data, error, isPending, isFetching, refetch } = useExtensionView(extension.id, view.id)
  const ctx = { extId: extension.id, viewId: view.id }

  return (
    <section>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {data?.title || view.title}
            {isFetching && !isPending && (
              <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            )}
          </h1>
          {data?.description && <p className="text-sm text-muted-foreground">{data.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {data?.actions?.map((a) => (
            <ActionButton key={a.id} action={a} ctx={ctx} variant={a.variant || 'outline'} />
          ))}
        </div>
      </header>

      {isPending && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Cargando…
        </p>
      )}
      {error && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-destructive">{errMsg(error)}</p>
          <Button variant="outline" onClick={() => refetch()}>
            Reintentar
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-5">
        {data?.blocks?.map((b, i) => (
          <Block key={i} block={b} ctx={ctx} />
        ))}
      </div>
    </section>
  )
}

function Block({ block, ctx }) {
  if (block.type === 'text')
    return (
      <p
        className={cn(
          'whitespace-pre-line',
          block.tone === 'muted' && 'text-muted-foreground',
          block.tone === 'error' && 'text-destructive'
        )}
      >
        {block.text}
      </p>
    )
  if (block.type === 'list') return <ListBlock block={block} ctx={ctx} />
  return null
}

function ListBlock({ block, ctx }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const items = (block.items ?? []).filter(
    (it) =>
      !q ||
      [it.title, it.description, ...(it.badges ?? [])].some((s) => s?.toLowerCase().includes(q))
  )

  return (
    <div className="flex flex-col gap-3">
      {block.searchable && <SearchInput value={query} onChange={setQuery} placeholder="Filtrar…" />}
      {!block.items?.length && <p className="text-muted-foreground">{block.empty || 'Sin elementos.'}</p>}
      {q && !items.length && (
        <p className="text-muted-foreground">Ningún elemento coincide con «{query}».</p>
      )}
      <ul className="divide-y rounded-xl border bg-card">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{it.title}</span>
                {it.badges?.map((b) => (
                  <Badge key={b} variant="outline">
                    {b}
                  </Badge>
                ))}
              </div>
              {it.description && (
                <p className="truncate text-sm text-muted-foreground">{it.description}</p>
              )}
              {it.meta && <p className="text-xs text-muted-foreground">{it.meta}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              {it.actions?.map((a) => (
                <ActionButton key={a.id} action={a} ctx={ctx} variant={a.variant || 'outline'} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ActionButton({ action, ctx, variant }) {
  const run = useAction(() => api.extensions.action(ctx.extId, ctx.viewId, action.id, action.args), {
    onSuccess: (res) => res?.toast && toast.success(res.toast)
  })
  const Icon = run.isPending ? LoaderCircle : extIcon(action.icon)

  return (
    <Button
      variant={variant}
      size={action.label ? 'default' : 'icon'}
      title={action.title || action.label}
      disabled={run.isPending}
      onClick={() => run.mutate()}
    >
      <Icon className={cn(run.isPending && 'animate-spin')} />
      {action.label}
    </Button>
  )
}
