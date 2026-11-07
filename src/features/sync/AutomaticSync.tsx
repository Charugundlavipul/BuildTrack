import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { offlineDb, synchronizeQueue } from '../../lib/offline'
import { useAuth } from '../auth/AuthProvider'

/** Keeps each signed-in user's queue moving on reconnect, including outside Sync center. */
export function AutomaticSync() {
  const { user } = useAuth()
  const cache = useQueryClient()
  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    let stopped = false
    let running = false
    let followUp = false
    let notifiedStorageFailure = false
    async function run() {
      if (stopped || !navigator.onLine) return
      if (running) { followUp = true; return }
      running = true
      try {
        const queued = await offlineDb.operations.filter((operation) => operation.user_id === userId && (operation.state === 'queued' || operation.state === 'sending' || operation.state === 'uploading' || operation.state === 'failed' && operation.retryable !== false)).toArray()
        notifiedStorageFailure = false
        const organizations = [...new Set(queued.map((operation) => operation.organization_id))]
        for (const organizationId of organizations) {
          if (stopped || !navigator.onLine) break
          window.dispatchEvent(new CustomEvent('buildtrack:sync-status', { detail: { userId, organizationId, syncing: true } }))
          try {
            const result = await synchronizeQueue(userId!, organizationId, { automatic: true, shouldContinue: () => !stopped })
            if (result.synced) {
              await cache.invalidateQueries()
              toast.success(`${result.synced} saved change${result.synced === 1 ? '' : 's'} synced`)
            }
            if (result.conflicts || result.accessRevoked) toast.warning('Some saved changes need review', { description: 'Open Sync center to see what needs attention.' })
          } catch {
            // Transient connectivity and session errors leave the queue untouched for the next attempt.
          } finally {
            window.dispatchEvent(new CustomEvent('buildtrack:sync-status', { detail: { userId, organizationId, syncing: false } }))
          }
        }
      } catch {
        if (!notifiedStorageFailure) toast.error('Saved work could not be read', { description: 'Check your browser storage and keep this app open to retry.' })
        notifiedStorageFailure = true
      } finally {
        running = false
        if (followUp && !stopped) { followUp = false; void run() }
      }
    }
    const wake = () => { void run() }
    const stopForLogout = () => { stopped = true }
    const interval = window.setInterval(wake, 30_000)
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('buildtrack:queue-changed', wake)
    window.addEventListener('buildtrack:logout-start', stopForLogout)
    document.addEventListener('visibilitychange', wake)
    wake()
    return () => {
      stopped = true
      window.clearInterval(interval)
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('buildtrack:queue-changed', wake)
      window.removeEventListener('buildtrack:logout-start', stopForLogout)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [cache, userId])
  return null
}
