import { useState } from 'react'
import { Check, ChevronRight, ChevronsUpDown, LoaderCircle, User } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SafeHtml } from '@/components/SafeHtml'
import { SearchInput } from '@/components/SearchInput'
import { api, errMsg } from '@/lib/api'
import { extIcon } from '@/lib/extIcons'
import { useAction, useExtensionView } from '@/lib/queries'
import { useRememberedOpen } from '@/lib/useRememberedOpen'
import { cn } from '@/lib/utils'

// Tonos que admiten los bloques (ver extensions/README.md). Clases completas para Tailwind.
const TONE_TEXT = {
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
  error: 'text-destructive',
  muted: 'text-muted-foreground'
}
const TONE_BG = {
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info',
  error: 'bg-destructive',
  muted: 'bg-muted-foreground/50'
}
const TONE_BADGE = {
  success: 'border-success/40 text-success',
  warning: 'border-warning/40 text-warning',
  info: 'border-info/40 text-info',
  error: 'border-destructive/40 text-destructive'
}

// Pinta la vista que devuelve una extensión (JSON, ver extensions/README.md). Ningún código
// de la extensión llega al renderer: solo datos que se muestran con nuestros componentes.
// Con projectId es una pestaña dentro de ProjectView: sin título propio.
export function ExtensionView({ extension, view, projectId = null }) {
  const { data, error, isPending, isFetching, refetch } = useExtensionView(
    extension.id,
    view.id,
    projectId
  )
  const [detail, setDetail] = useState(null)
  const ctx = { extId: extension.id, viewId: view.id, projectId, openDetail: setDetail }
  const spinner = isFetching && !isPending && (
    <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
  )

  return (
    <section>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {projectId ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {data?.description}
              {spinner}
            </p>
          ) : (
            <>
              <h1 className="flex items-center gap-2 text-2xl font-semibold">
                {data?.title || view.title}
                {spinner}
              </h1>
              {data?.description && (
                <p className="text-sm text-muted-foreground">{data.description}</p>
              )}
            </>
          )}
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
      <Blocks blocks={data?.blocks} ctx={ctx} />

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
            {/* Radix avisa en consola si falta la descripción: siempre presente, aunque vacía. */}
            <DialogDescription>{detail?.description}</DialogDescription>
          </DialogHeader>
          <Blocks blocks={detail?.blocks} ctx={ctx} className="-mx-1 overflow-y-auto px-1" />
        </DialogContent>
      </Dialog>
    </section>
  )
}

function Blocks({ blocks, ctx, className }) {
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      {blocks?.map((b, i) => (
        <Block key={i} block={b} ctx={ctx} />
      ))}
    </div>
  )
}

function Block({ block, ctx }) {
  if (block.type === 'text')
    return <p className={cn('whitespace-pre-line', TONE_TEXT[block.tone])}>{block.text}</p>
  if (block.type === 'html') return <SafeHtml html={block.html} />
  if (block.type === 'heading') return <h2 className="-mb-2 text-lg font-semibold">{block.text}</h2>
  if (block.type === 'list') return <ListBlock block={block} ctx={ctx} />
  if (block.type === 'stats') return <StatsBlock block={block} ctx={ctx} />
  if (block.type === 'breakdown') return <BreakdownBlock block={block} ctx={ctx} />
  if (block.type === 'tabs') return <TabsBlock block={block} ctx={ctx} />
  if (block.type === 'kanban') return <KanbanBlock block={block} ctx={ctx} />
  if (block.type === 'section') return <SectionBlock block={block} ctx={ctx} />
  if (block.type === 'columns')
    return (
      <Blocks
        blocks={block.blocks}
        ctx={ctx}
        className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-4"
      />
    )
  return null
}

// Pestañas con sus propios bloques: { tabs: [{ id, label, blocks }] }.
function TabsBlock({ block, ctx }) {
  const tabs = block.tabs ?? []
  if (!tabs.length) return null
  return (
    <Tabs defaultValue={tabs[0].id}>
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="mt-2">
          <Blocks blocks={t.blocks} ctx={ctx} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

// Sección plegable con sus propios bloques: { title, open?, blocks }. Recuerda si se plegó.
function SectionBlock({ block, ctx }) {
  const [open, setOpen] = useRememberedOpen(
    `section:${ctx.extId}/${ctx.viewId}/${ctx.projectId}/${block.id ?? block.title}`,
    block.open ?? true
  )
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-lg font-semibold hover:text-muted-foreground">
        <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
        {block.title}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Blocks blocks={block.blocks} ctx={ctx} className="mt-3" />
      </CollapsibleContent>
    </Collapsible>
  )
}

const ratio = (v) => `${Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 100)}%`

// Botón que abre el detalle (`{ title, description?, blocks }`) en un modal; sin detalle, un div.
function Detail({ detail, ctx, className, children, ...props }) {
  if (!detail)
    return (
      <div className={className} {...props}>
        {children}
      </div>
    )
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'cursor-pointer text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className
      )}
      onClick={(e) => {
        // Dentro de una tarjeta no debe activar otros clics.
        e.stopPropagation()
        ctx.openDetail(detail)
      }}
    >
      {children}
    </button>
  )
}

// Tarjetas de cifras: { label, value, hint?, tone?, progress? (0–1), detail? }.
function StatsBlock({ block, ctx }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
      {block.items?.map((it, i) => (
        <Detail
          key={i}
          detail={it.detail}
          ctx={ctx}
          className={cn(
            'flex flex-col gap-1 rounded-xl border bg-card px-4 py-3',
            it.detail && 'hover:border-primary/50 hover:bg-accent/40'
          )}
        >
          <span className="text-xs text-muted-foreground">{it.label}</span>
          <span className={cn('truncate text-2xl font-semibold', TONE_TEXT[it.tone])}>
            {it.value}
          </span>
          {it.progress != null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', TONE_BG[it.tone] || 'bg-primary')}
                style={{ width: ratio(it.progress) }}
              />
            </div>
          )}
          {it.hint && <span className="text-xs text-muted-foreground">{it.hint}</span>}
        </Detail>
      ))}
    </div>
  )
}

// Reparto de un total en segmentos: barra apilada y leyenda.
function BreakdownBlock({ block, ctx }) {
  const items = (block.items ?? []).filter((it) => it.value > 0)
  const total = items.reduce((n, it) => n + it.value, 0)

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{block.title}</span>
        <span className="text-sm text-muted-foreground">{total}</span>
      </div>
      {!total ? (
        <p className="text-sm text-muted-foreground">{block.empty || 'Sin elementos.'}</p>
      ) : (
        <>
          <StackedBar items={items} total={total} ctx={ctx} />
          <ul className="-mx-2 flex flex-col text-sm">
            {items.map((it, i) => (
              <li key={i}>
                <Detail
                  detail={it.detail}
                  ctx={ctx}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-0.5',
                    it.detail && 'hover:bg-accent'
                  )}
                >
                  <span className={cn('size-2 rounded-full', TONE_BG[it.tone] || 'bg-primary')} />
                  <span className="flex-1 truncate">{it.label}</span>
                  <span className="text-muted-foreground tabular-nums">{it.value}</span>
                </Detail>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function StackedBar({ items, total, ctx, className }) {
  return (
    <div className={cn('flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted', className)}>
      {items.map((it, i) => (
        <Detail
          key={i}
          detail={it.detail}
          ctx={ctx}
          className={cn(TONE_BG[it.tone] || 'bg-primary', it.detail && 'hover:opacity-75')}
          style={{ width: ratio(it.value / total) }}
          title={`${it.label}: ${it.value}`}
        />
      ))}
    </div>
  )
}

// Reparto compacto dentro de un elemento (p. ej. tareas de una historia por estado).
function ItemBreakdown({ items: all, ctx, className }) {
  const items = (all ?? []).filter((it) => it.value > 0)
  const total = items.reduce((n, it) => n + it.value, 0)
  if (!total) return null
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <StackedBar items={items} total={total} ctx={ctx} className="h-1.5" />
      <ul className="-mx-1 flex flex-wrap gap-x-1 text-xs text-muted-foreground">
        {items.map((it, i) => (
          <li key={i}>
            <Detail
              detail={it.detail}
              ctx={ctx}
              className={cn(
                'flex items-center gap-1 rounded px-1',
                it.detail && 'hover:bg-accent hover:text-foreground'
              )}
            >
              <span className={cn('size-1.5 rounded-full', TONE_BG[it.tone] || 'bg-primary')} />
              {it.label}
              <span className="tabular-nums">{it.value}</span>
            </Detail>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Las etiquetas pueden ser texto o { label, tone }.
const badgeOf = (b) => (typeof b === 'string' ? { label: b } : b)

function ListBlock({ block, ctx }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const matches = (it) =>
    [it.title, it.description, it.meta, ...(it.badges ?? []).map((b) => badgeOf(b).label)].some(
      (s) => s?.toLowerCase().includes(q)
    )
  const items = (block.items ?? []).filter((it) => !q || matches(it) || it.children?.some(matches))

  return (
    <div className="flex flex-col gap-3">
      {block.searchable && <SearchInput value={query} onChange={setQuery} placeholder="Filtrar…" />}
      {!block.items?.length && (
        <p className="text-muted-foreground">{block.empty || 'Sin elementos.'}</p>
      )}
      {q && !items.length && (
        <p className="text-muted-foreground">Ningún elemento coincide con «{query}».</p>
      )}
      {items.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((it) => (
            <li key={it.id} className="px-4 py-3">
              <ItemRow item={it} ctx={ctx} />
              {it.children?.length > 0 && <ItemChildren item={it} ctx={ctx} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ItemRow({ item, ctx, compact }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('font-medium', compact && 'text-sm')}>{item.title}</span>
          {item.badges?.map(badgeOf).map((b) => (
            <Badge key={b.label} variant="outline" className={TONE_BADGE[b.tone]}>
              {b.label}
            </Badge>
          ))}
        </div>
        {item.description && (
          <p className="truncate text-sm text-muted-foreground">{item.description}</p>
        )}
        {item.meta && <p className="text-xs text-muted-foreground">{item.meta}</p>}
        {item.body && <p className="mt-1 text-sm whitespace-pre-line">{item.body}</p>}
        {item.html && <SafeHtml html={item.html} className="mt-1" />}
        <ItemBreakdown items={item.breakdown} ctx={ctx} className="mt-2 max-w-md" />
      </div>
      <div className="flex shrink-0 gap-2">
        {item.actions?.map((a) => (
          <ActionButton
            key={a.id}
            action={a}
            ctx={ctx}
            variant={a.variant || (compact ? 'ghost' : 'outline')}
          />
        ))}
      </div>
    </div>
  )
}

// Subelementos de un elemento (p. ej. tareas de una historia), plegables.
function ItemChildren({ item, ctx }) {
  const [open, setOpen] = useState(item.childrenOpen ?? true)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="group flex items-center gap-1 py-1 text-xs tracking-widest text-muted-foreground uppercase hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {item.childrenLabel || `Elementos (${item.children.length})`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 ml-1.5 divide-y border-l pl-4">
          {item.children.map((c) => (
            <li key={c.id} className="py-2">
              <ItemRow item={c} ctx={ctx} compact />
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

// Tablero por columnas. Cada tarjeta lleva en `filterValues` los valores por los que se puede
// filtrar (p. ej. personas asignadas); sus `children` también, para atenuar los que no coinciden.
function KanbanBlock({ block, ctx }) {
  const columns = block.columns ?? []
  const cards = columns.flatMap((c) => c.items ?? [])
  const options = [...new Set(cards.flatMap((it) => it.filterValues ?? []))].sort((a, b) =>
    a.localeCompare(b)
  )
  const [saved, setFilter] = useRememberedOpen(
    `kanban:${ctx.extId}/${ctx.viewId}/${ctx.projectId}`,
    null
  )
  // Si el valor elegido ya no aparece (p. ej. en otro sprint), se muestran todas.
  const filter = options.includes(saved) ? saved : null
  const matches = (it) => !filter || it.filterValues?.includes(filter)

  return (
    <div className="flex flex-col gap-3">
      {block.filter && (
        <FilterCombobox
          label={block.filter.label}
          all={block.filter.all}
          options={options}
          value={filter}
          onChange={setFilter}
        />
      )}
      {!cards.length && <p className="text-muted-foreground">{block.empty || 'Sin elementos.'}</p>}
      {cards.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {columns.map((col) => {
            const items = (col.items ?? []).filter(matches)
            return (
              <div
                key={col.id}
                className="flex w-72 shrink-0 flex-col gap-2 rounded-xl border bg-muted/40 p-2"
              >
                <div className="flex items-center gap-2 px-1 pt-1">
                  <span className={cn('size-2 rounded-full', TONE_BG[col.tone] || 'bg-primary')} />
                  <span className="flex-1 truncate text-sm font-medium">{col.title}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
                </div>
                {items.map((it) => (
                  <KanbanCard key={it.id} item={it} ctx={ctx} dim={(c) => !matches(c)} />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Con `action: { id, args }` toda la tarjeta es pulsable (p. ej. para abrir su detalle).
function KanbanCard({ item, ctx, dim }) {
  const [open, setOpen] = useState(item.childrenOpen ?? true)
  const run = useAction(() =>
    api.extensions.action(ctx.extId, ctx.viewId, item.action.id, item.action.args, ctx.projectId)
  )
  const clickable = item.action && !run.isPending
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border bg-card px-3 py-2',
        item.action &&
          'cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        run.isPending && 'opacity-60'
      )}
      {...(item.action && {
        role: 'button',
        tabIndex: 0,
        onClick: () => clickable && run.mutate(),
        onKeyDown: (e) => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
          e.preventDefault()
          if (clickable) run.mutate()
        }
      })}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{item.title}</span>
        <div className="-mt-1 -mr-2 flex shrink-0">
          {item.actions?.map((a) => (
            <ActionButton key={a.id} action={a} ctx={ctx} variant={a.variant || 'ghost'} small />
          ))}
        </div>
      </div>
      {item.badges?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.badges.map(badgeOf).map((b) => (
            <Badge key={b.label} variant="outline" className={TONE_BADGE[b.tone]}>
              {b.label}
            </Badge>
          ))}
        </div>
      )}
      {item.description && (
        <p className="truncate text-xs text-muted-foreground">{item.description}</p>
      )}
      {item.meta && <p className="text-xs text-muted-foreground">{item.meta}</p>}
      <ItemBreakdown items={item.breakdown} ctx={ctx} className="mt-1" />
      {item.children?.length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger
            className="group flex items-center gap-1 py-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
            {item.childrenLabel || `Elementos (${item.children.length})`}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex flex-col gap-1 border-l pl-2">
              {item.children.map((c) => {
                // En la tarjeta no caben etiquetas: la primera (el estado) se pinta como un punto.
                const state = badgeOf(c.badges?.[0] ?? '')
                return (
                  <li
                    key={c.id}
                    className={cn('flex items-center gap-2 text-xs', dim(c) && 'opacity-40')}
                  >
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        TONE_BG[state.tone] || TONE_BG.muted
                      )}
                      title={state.label}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" title={c.title}>
                        {c.title}
                      </span>
                      {c.meta && (
                        <span className="block truncate text-muted-foreground">{c.meta}</span>
                      )}
                    </span>
                    {c.actions?.map((a) => (
                      <ActionButton key={a.id} action={a} ctx={ctx} variant="ghost" small />
                    ))}
                  </li>
                )
              })}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

// Desplegable con búsqueda para elegir un valor del filtro (o todos).
function FilterCombobox({ label, all = 'Todos', options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const pick = (v) => {
    onChange(v)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          title={label}
          className="w-64 justify-between"
        >
          <User />
          <span className="flex-1 truncate text-left">{value ?? all}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={`${label || 'Filtrar'}…`} />
          <CommandList>
            <CommandEmpty>Sin coincidencias.</CommandEmpty>
            <CommandGroup>
              <CommandItem value={all} onSelect={() => pick(null)}>
                <Check className={cn(value == null ? 'opacity-100' : 'opacity-0')} />
                {all}
              </CommandItem>
              {options.map((o) => (
                <CommandItem key={o} value={o} onSelect={() => pick(o)}>
                  <Check className={cn(o === value ? 'opacity-100' : 'opacity-0')} />
                  {o}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ActionButton({ action, ctx, variant, small }) {
  const run = useAction(
    () => api.extensions.action(ctx.extId, ctx.viewId, action.id, action.args, ctx.projectId),
    { onSuccess: (res) => res?.toast && toast.success(res.toast) }
  )
  const Icon = run.isPending ? LoaderCircle : extIcon(action.icon)

  return (
    <Button
      variant={variant}
      size={action.label ? 'default' : small ? 'icon-xs' : 'icon'}
      title={action.title || action.label}
      disabled={run.isPending}
      onClick={(e) => {
        // Dentro de una tarjeta pulsable no debe activar también la tarjeta.
        e.stopPropagation()
        run.mutate()
      }}
    >
      <Icon className={cn(run.isPending && 'animate-spin')} />
      {action.label}
    </Button>
  )
}
