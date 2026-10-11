import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowUpCircle,
  Download,
  FileArchive,
  RefreshCw,
  ScrollText,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, errMsg } from '@/lib/api'
import { useAction, useExtensionCatalog, useExtensions } from '@/lib/queries'

// Texto legible de cada permiso del manifest.
export function permissionLines(p) {
  const lines = []
  if (p.exec?.length) lines.push(`Ejecutar programas: ${p.exec.join(', ')}`)
  if (p.projects) lines.push('Ver tus proyectos y añadirles repositorios')
  if (p.dialogs) lines.push('Abrir diálogos para elegir carpetas')
  if (p.develop) lines.push('Proponerte crear worktrees y abrir Claude Code con un contexto')
  if (p.secrets) lines.push('Guardar sus propias credenciales cifradas (no ve la bóveda)')
  return lines
}

const installed = (r) => toast.success(`${r.displayName} v${r.version} instalada`)

// embedded: dentro de Configuración, con un título secundario.
export function ExtensionsPage({ embedded = false }) {
  const { data: extensions = [] } = useExtensions()
  const catalog = useExtensionCatalog()
  const entries = catalog.data ?? []
  const available = entries.filter((e) => !e.installedVersion)
  const [staged, setStaged] = useState(null)
  // El token vive en un ref: confirmar también cierra el diálogo y no debe descartarlo.
  const stagedToken = useRef(null)

  const reload = useAction(async () => {
    await api.extensions.reload()
    await api.extensions.catalog(true)
  })
  const pickZip = useAction(api.extensions.pickZip, {
    onSuccess: (s) => {
      if (!s) return
      stagedToken.current = s.token
      setStaged(s)
    }
  })
  const installStaged = useAction(api.extensions.installStaged, { onSuccess: installed })

  // Cerrar el diálogo sin confirmar descarta el paquete ya extraído.
  const finishStaged = (install) => {
    const token = stagedToken.current
    stagedToken.current = null
    setStaged(null)
    if (!token) return
    if (install) installStaged.mutate(token)
    else api.extensions.discardStaged(token)
  }

  return (
    <section>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          {embedded ? (
            <h2 className="text-lg font-semibold">Extensiones</h2>
          ) : (
            <h1 className="text-2xl font-semibold">Extensiones</h1>
          )}
          <p className="text-sm text-muted-foreground">
            Añaden vistas y acciones a la app. Cada una corre en su propio proceso, sin acceso a la
            bóveda.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => pickZip.mutate()} disabled={pickZip.isPending}>
            <FileArchive /> Instalar desde .zip
          </Button>
          <Button
            variant="outline"
            onClick={() => reload.mutate()}
            disabled={reload.isPending}
            title="Vuelve a leer las extensiones instaladas y el catálogo"
          >
            <RefreshCw className={reload.isPending ? 'animate-spin' : undefined} /> Recargar
          </Button>
        </div>
      </header>

      <Tabs defaultValue="installed">
        <TabsList>
          <TabsTrigger value="installed">Instaladas ({extensions.length})</TabsTrigger>
          <TabsTrigger value="available">
            Disponibles{catalog.isSuccess && ` (${available.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-3">
          {extensions.length ? (
            <ul className="flex flex-col gap-3">
              {extensions.map((ext) => (
                <InstalledCard
                  key={ext.id}
                  ext={ext}
                  entry={entries.find((e) => e.name === ext.id)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No tienes extensiones instaladas. Busca alguna en «Disponibles».
            </p>
          )}
        </TabsContent>

        <TabsContent value="available" className="mt-3">
          {catalog.isPending && <p className="text-sm text-muted-foreground">Cargando catálogo…</p>}
          {catalog.isError && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <TriangleAlert className="size-4 shrink-0" /> {errMsg(catalog.error)}
            </p>
          )}
          {catalog.isSuccess &&
            (available.length ? (
              <ul className="flex flex-col gap-3">
                {available.map((entry) => (
                  <AvailableCard key={entry.name} entry={entry} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ya tienes instaladas todas las extensiones del catálogo.
              </p>
            ))}
        </TabsContent>
      </Tabs>

      {staged && (
        <ConsentDialog
          open
          onOpenChange={(open) => !open && finishStaged(false)}
          title={`¿Instalar «${staged.displayName}» v${staged.version}?`}
          note={
            staged.installedVersion &&
            `Sustituye a la versión ${staged.installedVersion} que tienes instalada.`
          }
          permissions={staged.permissions}
          confirmLabel="Instalar"
          onConfirm={() => finishStaged(true)}
        />
      )}
    </section>
  )
}

function InstalledCard({ ext, entry }) {
  const [consent, setConsent] = useState(null) // 'enable' | 'update'
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const setEnabled = useAction((enabled) => api.extensions.setEnabled(ext.id, enabled))
  const update = useAction(() => api.extensions.install(ext.id), { onSuccess: installed })
  const uninstall = useAction(() => api.extensions.uninstall(ext.id), {
    onSuccess: () => toast.success(`${ext.displayName} desinstalada`)
  })
  const perms = permissionLines(ext.permissions)
  const canUpdate = entry?.update && entry.compatible && ext.source === 'user'

  // Sin consentimiento para los permisos actuales (nunca dado o han cambiado), se pide antes.
  const toggle = () =>
    ext.enabled || ext.granted ? setEnabled.mutate(!ext.enabled) : setConsent('enable')

  return (
    <li className="rounded-xl border bg-card px-4 py-3.5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {ext.displayName}
            {ext.version && <span className="text-xs text-muted-foreground">v{ext.version}</span>}
            {ext.source === 'dev' && <Badge variant="outline">desarrollo</Badge>}
            {!ext.enabled && !ext.invalid && <Badge variant="secondary">desactivada</Badge>}
          </h2>
          {ext.description && <p className="text-sm text-muted-foreground">{ext.description}</p>}
          <p className="truncate font-mono text-xs text-muted-foreground">{ext.dir}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button variant="ghost" title="Registro de la extensión" onClick={() => setLogOpen(true)}>
            <ScrollText /> Registro
          </Button>
          {canUpdate && (
            <Button onClick={() => setConsent('update')} disabled={update.isPending}>
              <ArrowUpCircle /> Actualizar a v{entry.version}
            </Button>
          )}
          {!ext.invalid && (
            <Button variant={ext.enabled ? 'outline' : 'default'} onClick={toggle}>
              {ext.enabled ? 'Desactivar' : 'Activar'}
            </Button>
          )}
          {ext.source === 'user' && (
            <Button
              variant="ghost"
              size="icon"
              title="Desinstalar"
              onClick={() => setConfirmRemove(true)}
              disabled={uninstall.isPending}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </header>

      {(ext.invalid || ext.error) && (
        <p className="mt-2 flex items-center gap-2 text-sm text-destructive">
          <TriangleAlert className="size-4 shrink-0" /> {ext.invalid || ext.error}
        </p>
      )}
      {perms.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
          {perms.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}

      <ConsentDialog
        open={consent === 'enable'}
        onOpenChange={(open) => !open && setConsent(null)}
        title={`¿Activar «${ext.displayName}»?`}
        permissions={ext.permissions}
        confirmLabel="Activar"
        onConfirm={() => setEnabled.mutate(true)}
      />
      {canUpdate && (
        <ConsentDialog
          open={consent === 'update'}
          onOpenChange={(open) => !open && setConsent(null)}
          title={`¿Actualizar «${ext.displayName}» a v${entry.version}?`}
          permissions={entry.permissions}
          confirmLabel="Actualizar"
          onConfirm={() => update.mutate()}
        />
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desinstalar «{ext.displayName}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran sus archivos y los datos que había guardado. Puedes volver a instalarla
              desde «Disponibles».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => uninstall.mutate()}>Desinstalar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Registro de {ext.displayName}</DialogTitle>
          </DialogHeader>
          {logOpen && <ExtensionLog id={ext.id} />}
        </DialogContent>
      </Dialog>
    </li>
  )
}

function AvailableCard({ entry }) {
  const [consentOpen, setConsentOpen] = useState(false)
  const install = useAction(() => api.extensions.install(entry.name), { onSuccess: installed })
  const perms = permissionLines(entry.permissions)

  return (
    <li className="rounded-xl border bg-card px-4 py-3.5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {entry.displayName}
            <span className="text-xs text-muted-foreground">v{entry.version}</span>
          </h2>
          {entry.description && (
            <p className="text-sm text-muted-foreground">{entry.description}</p>
          )}
        </div>
        <Button
          className="shrink-0"
          onClick={() => setConsentOpen(true)}
          disabled={!entry.compatible || install.isPending}
        >
          <Download /> {install.isPending ? 'Instalando…' : 'Instalar'}
        </Button>
      </header>
      {!entry.compatible && (
        <p className="mt-2 text-xs text-muted-foreground">
          Necesita otra versión de Claude Launcher.
        </p>
      )}
      {perms.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
          {perms.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <ConsentDialog
        open={consentOpen}
        onOpenChange={setConsentOpen}
        title={`¿Instalar «${entry.displayName}»?`}
        permissions={entry.permissions}
        confirmLabel="Instalar"
        onConfirm={() => install.mutate()}
      />
    </li>
  )
}

function ConsentDialog({ open, onOpenChange, title, note, permissions, confirmLabel, onConfirm }) {
  const perms = permissionLines(permissions)
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            Las extensiones ejecutan código en tu equipo con tu usuario. No pueden leer la bóveda,
            pero sí tus archivos. Hazlo solo si confías en quien la escribió.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {note && <p className="text-sm">{note}</p>}
        {perms.length > 0 ? (
          <ul className="list-inside list-disc text-sm">
            {perms.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No pide permisos adicionales.</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ExtensionLog({ id }) {
  const { data: log } = useQuery({
    queryKey: ['ext-log', id],
    queryFn: () => api.extensions.log(id),
    staleTime: 0
  })
  return (
    <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
      {log || 'Sin salida.'}
    </pre>
  )
}
