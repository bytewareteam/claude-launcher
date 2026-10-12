import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { api, errMsg } from '@/lib/api'
import { useSettings } from '@/lib/queries'

const UpdateContext = createContext(null)

// { info, checking, check(), show() }: info es la última comprobación (null si aún no hay).
export const useUpdates = () => useContext(UpdateContext)

export function UpdateProvider({ children }) {
  const { data: settings } = useSettings()
  const [info, setInfo] = useState(null)
  const [checking, setChecking] = useState(false)
  const [open, setOpen] = useState(false)
  const startupDone = useRef(false)

  // Manual: avisa también si no hay nada nuevo o si falla. Al arrancar, solo si hay versión nueva.
  const check = useCallback(async ({ manual = true } = {}) => {
    setChecking(true)
    try {
      const res = await api.updates.check()
      setInfo(res)
      if (res.available) {
        if (manual) setOpen(true)
        else
          toast(`Claude Launcher v${res.latest} disponible`, {
            description: `Tienes la v${res.current}.`,
            action: { label: 'Ver', onClick: () => setOpen(true) },
            duration: 15_000
          })
      } else if (manual) toast.success(`Tienes la última versión (v${res.current}).`)
    } catch (err) {
      if (manual) toast.error(errMsg(err))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    api.updates.failed().then((version) => {
      if (version)
        toast.error(`No se pudo instalar la v${version}.`, {
          description: 'Descárgala desde GitHub y sustituye el .exe a mano.'
        })
    })
  }, [])

  useEffect(() => {
    if (!settings || startupDone.current) return
    startupDone.current = true
    if (settings.updates.checkOnStartup) check({ manual: false })
  }, [settings, check])

  return (
    <UpdateContext.Provider value={{ info, checking, check, show: () => setOpen(true) }}>
      {children}
      {info?.available && <UpdateDialog info={info} open={open} onOpenChange={setOpen} />}
    </UpdateContext.Provider>
  )
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1)

function UpdateDialog({ info, open, onOpenChange }) {
  const [progress, setProgress] = useState(null) // { received, total } mientras descarga

  useEffect(() => api.updates.onProgress(setProgress), [])

  const install = async () => {
    setProgress({ received: 0, total: 0 })
    try {
      await api.updates.install()
      // La app se cierra sola y se abre la versión nueva.
    } catch (err) {
      toast.error(errMsg(err))
      setProgress(null)
    }
  }

  const busy = progress !== null
  const percent = progress?.total ? Math.round((progress.received / progress.total) * 100) : null

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nueva versión: v{info.latest}</DialogTitle>
          <DialogDescription>
            Tienes la v{info.current}.{' '}
            {info.canInstall
              ? 'Se descarga, se comprueba que es la publicada y la app se reinicia con ella.'
              : 'Descárgala desde GitHub: solo el .exe portable se actualiza desde la app.'}
          </DialogDescription>
        </DialogHeader>
        {info.notes && (
          <div className="max-h-72 overflow-y-auto rounded-md bg-muted px-3 py-2 text-xs whitespace-pre-wrap text-muted-foreground">
            {info.notes}
          </div>
        )}
        {busy && (
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            {progress.received > 0
              ? `Descargando… ${mb(progress.received)}${progress.total ? ` de ${mb(progress.total)}` : ''} MB`
              : 'Preparando la descarga…'}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => api.openUrl(info.url)}>
            <ExternalLink /> Ver en GitHub
          </Button>
          {info.canInstall && (
            <Button onClick={install} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Download />} Actualizar y reiniciar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
