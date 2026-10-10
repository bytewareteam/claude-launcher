import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from './api'

export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: api.projects })

export const useVaultStatus = () =>
  useQuery({ queryKey: ['vault', 'status'], queryFn: api.vault.status })

export const useWorktrees = (repoPath) =>
  useQuery({ queryKey: ['worktrees', repoPath], queryFn: () => api.worktrees(repoPath) })

export function useVars(scope) {
  const { data: vault } = useVaultStatus()
  return useQuery({
    queryKey: ['vault', 'vars', scope.projectId, scope.repoId ?? null],
    queryFn: () => api.vault.list(scope),
    enabled: !!vault?.unlocked
  })
}

// Mutación genérica: la caché global muestra los errores y refresca los datos.
export const useAction = (fn, options) => useMutation({ mutationFn: fn, ...options })

export const useRemoteBranches = (repoPath, enabled) =>
  useQuery({
    queryKey: ['branches', repoPath],
    queryFn: () => api.remoteBranches(repoPath),
    enabled
  })

export const useWorktreeStatus = (wtPath, base, enabled) =>
  useQuery({
    queryKey: ['worktree-status', wtPath, base],
    queryFn: () => api.worktreeStatus(wtPath, base),
    enabled,
    staleTime: 0
  })

export const useOnboardingPending = () =>
  useQuery({ queryKey: ['onboarding'], queryFn: api.onboarding.pending, staleTime: Infinity })

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard })

export const useExtensions = () =>
  useQuery({ queryKey: ['extensions'], queryFn: api.extensions.list })

// El proceso principal cachea el catálogo; sin red, la pestaña «Disponibles» muestra el error.
export const useExtensionCatalog = () =>
  useQuery({
    queryKey: ['ext-catalog'],
    queryFn: () => api.extensions.catalog(false),
    retry: false
  })

// Vista declarativa de una extensión: la pinta ExtensionView con los componentes de la app.
export const useExtensionView = (extId, viewId) =>
  useQuery({
    queryKey: ['ext-view', extId, viewId],
    queryFn: () => api.extensions.render(extId, viewId)
  })
