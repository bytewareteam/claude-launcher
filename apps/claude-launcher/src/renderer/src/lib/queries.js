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

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard })
