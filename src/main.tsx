import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AuthProvider } from './features/auth/AuthProvider'
import { AutomaticSync } from './features/sync/AutomaticSync'
import './styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: false }
  }
})

// Numeric fields are typing-only. Scrolling over a focused number input can
// otherwise change saved values accidentally while the page is being scrolled.
document.addEventListener('wheel', (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement && target.type === 'number' && document.activeElement === target) target.blur()
}, { capture: true, passive: true })
document.addEventListener('keydown', (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement && target.type === 'number' && ['ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault()
})

const updateServiceWorker = registerSW({
  immediate: false,
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent('buildtrack:update-ready', { detail: { update: () => updateServiceWorker(true) } }))
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider><AutomaticSync /><App /></AuthProvider>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  </StrictMode>
)
