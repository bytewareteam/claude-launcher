import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAskVault } from '@/components/VaultProvider'
import { api, errMsg } from './api'
import { useVaultStatus } from './queries'

// Abre Claude; si la bóveda existe y está bloqueada, pide la contraseña antes.
// Con `{ resume: true, sessionId }` reanuda esa sesión del historial.
export function useLaunch() {
  const qc = useQueryClient()
  const askVault = useAskVault()
  const { data: vault } = useVaultStatus()

  return async (dir, title, scope, opts) => {
    if (vault?.exists && !vault.unlocked && !(await askVault({ allowSkip: true }))) return
    try {
      const n = await api.openClaude(dir, title, scope, opts)
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(n ? `Claude abierto en ${title} con ${n} variables` : `Claude abierto en ${title}`)
    } catch (err) {
      toast.error(errMsg(err))
    }
  }
}
