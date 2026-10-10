import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderOpen, RefreshCw, ScrollText, TriangleAlert } from 'lucide-react'
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
import { api } from '@/lib/api'
import { useAction, useExtensions } from '@/lib/queries'

// Texto legible de cada permiso del manifest.
export function permissionLines(p) {
  const lines = []
  if (p.exec?.length) lines.push(`Ejecutar programas: ${p.exec.join(', ')}`)
  if (p.projects) lines.push('Ver tus proyectos y añadirles repositorios')
  if (p.dialogs) lines.push('Abrir diálogos para elegir carpetas')
  return lines
}

export function ExtensionsPage() {
  const { data: extensions = [] } = useExtensions()
  const reload = useAction(api.extensions.reload)

  return (
    <section>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Extensiones</h1>
          <p className="text-sm text-muted-foreground">
            Añaden vistas y acciones a la app. Cada una corre en su propio proceso, sin acceso a la
            bóveda.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => api.extensions.openFolder()}>
            <FolderOpen /> Carpeta de extensiones
          </Button>
          <Button variant="outline" onClick={() => reload.mutate()} title="Vuelve a leer las carpetas">
            <RefreshCw /> Recargar
          </Button>
        </div>
      </header>

      <ul className="flex flex-col gap-3">
        {extensions.map((ext) => (
          <ExtensionCard key={ext.id} ext={ext} />
        ))}
      </ul>
    </section>
  )
}

function ExtensionCard({ ext }) {
  const [consentOpen, setConsentOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const setEnabled = useAction((enabled) => api.extensions.setEnabled(ext.id, enabled))
  const perms = permissionLines(ext.permissions)

  // Las de terceros solo se activan tras ver y aceptar sus permisos.
  const toggle = () =>
    ext.enabled || ext.builtin ? setEnabled.mutate(!ext.enabled) : setConsentOpen(true)

  return (
    <li className="rounded-xl border bg-card px-4 py-3.5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {ext.displayName}
            {ext.version && <span className="text-xs text-muted-foreground">v{ext.version}</span>}
            <Badge variant="outline">{ext.builtin ? 'incluida' : 'de usuario'}</Badge>
          </h2>
          {ext.description && <p className="text-sm text-muted-foreground">{ext.description}</p>}
          <p className="truncate font-mono text-xs text-muted-foreground">{ext.dir}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" title="Registro de la extensión" onClick={() => setLogOpen(true)}>
            <ScrollText /> Registro
          </Button>
          {!ext.invalid && (
            <Button variant={ext.enabled ? 'outline' : 'default'} onClick={toggle}>
              {ext.enabled ? 'Desactivar' : 'Activar'}
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

      <AlertDialog open={consentOpen} onOpenChange={setConsentOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Activar «{ext.displayName}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Las extensiones ejecutan código en tu equipo con tu usuario. No pueden leer la
              bóveda, pero sí tus archivos. Actívala solo si confías en quien la escribió.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {perms.length > 0 && (
            <ul className="list-inside list-disc text-sm">
              {perms.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => setEnabled.mutate(true)}>Activar</AlertDialogAction>
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
