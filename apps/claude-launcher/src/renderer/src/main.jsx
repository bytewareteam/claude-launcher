import './globals.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, MutationCache, focusManager } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { VaultProvider } from '@/components/VaultProvider'
import { ExtensionBridge } from '@/components/ExtensionBridge'
import { DevelopDialog } from '@/components/DevelopDialog'
import { UpdateProvider } from '@/components/UpdateProvider'
import { errMsg } from '@/lib/api'
import App from './App'

// En Electron cambiar de ventana no cambia la visibilidad: usamos el foco.
focusManager.setEventListener((handleFocus) => {
  const onFocus = () => handleFocus(true)
  const onBlur = () => handleFocus(false)
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  return () => {
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
  }
})

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
  // Cualquier mutación fallida se muestra como aviso; y tras cada una se refresca todo.
  mutationCache: new MutationCache({
    onError: (err) => toast.error(errMsg(err)),
    onSettled: () => queryClient.invalidateQueries()
  })
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <VaultProvider>
        <UpdateProvider>
          <App />
          <ExtensionBridge />
          <DevelopDialog />
        </UpdateProvider>
      </VaultProvider>
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>
)
