import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
import { api, errMsg } from '@/lib/api'
import { useVaultStatus } from '@/lib/queries'

const VaultContext = createContext(null)

// askVault({ allowSkip }) abre el diálogo y resuelve 'unlocked', 'skip' o null.
export const useAskVault = () => useContext(VaultContext)

export function VaultProvider({ children }) {
  const qc = useQueryClient()
  const { data: vault } = useVaultStatus()
  const [request, setRequest] = useState(null) // { allowSkip, resolve }

  const askVault = useCallback(
    ({ allowSkip = false } = {}) => new Promise((resolve) => setRequest({ allowSkip, resolve })),
    []
  )

  const close = (result) => {
    request?.resolve(result)
    setRequest(null)
  }

  useEffect(
    () =>
      api.vault.onLocked(() => {
        qc.invalidateQueries({ queryKey: ['vault'] })
        toast('Bóveda bloqueada por inactividad')
      }),
    [qc]
  )

  return (
    <VaultContext.Provider value={askVault}>
      {children}
      <Dialog open={!!request} onOpenChange={(open) => !open && close(null)}>
        {request && vault && (
          <VaultForm
            creating={!vault.exists}
            path={vault.path}
            allowSkip={request.allowSkip}
            onDone={async (result) => {
              await qc.invalidateQueries({ queryKey: ['vault'] })
              close(result)
            }}
          />
        )}
      </Dialog>
    </VaultContext.Provider>
  )
}

function VaultForm({ creating, path, allowSkip, onDone }) {
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  const submit = async (e) => {
    e.preventDefault()
    if (creating && password.length < 8) return setError('Usa al menos 8 caracteres.')
    if (creating && password !== confirm) return setError('Las contraseñas no coinciden.')
    setBusy(true)
    setError('')
    try {
      await (creating ? api.vault.create(password) : api.vault.unlock(password))
      onDone('unlocked')
    } catch (err) {
      setError(errMsg(err))
      inputRef.current?.select()
    } finally {
      setBusy(false)
    }
  }

  const useExisting = async () => {
    if (await api.vault.useExisting()) {
      await qc.invalidateQueries({ queryKey: ['vault'] })
      setError('')
    }
  }

  return (
    <DialogContent>
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{creating ? 'Crear bóveda de secretos' : 'Desbloquear bóveda'}</DialogTitle>
          <DialogDescription>
            {creating
              ? 'Se creará un archivo KeePass (.kdbx) cifrado con esta contraseña. También puedes abrirlo con KeePassXC. Si la olvidas, no hay forma de recuperar los secretos.'
              : 'Introduce la contraseña maestra.'}
          </DialogDescription>
        </DialogHeader>
        <Input
          ref={inputRef}
          type="password"
          placeholder="Contraseña maestra"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {creating && (
          <Input
            type="password"
            placeholder="Repite la contraseña"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="truncate font-mono text-xs text-muted-foreground" title={path}>
          {path}
        </p>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={useExisting}>
            Usar .kdbx existente
          </Button>
          <div className="flex gap-2">
            {allowSkip && (
              <Button type="button" variant="outline" onClick={() => onDone('skip')}>
                Abrir sin secretos
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Un momento…' : creating ? 'Crear' : 'Desbloquear'}
            </Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
