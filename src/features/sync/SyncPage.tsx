import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw, RotateCw, Trash2, Wifi } from 'lucide-react'
import { PageHeader, StateBadge } from '../../components/Ui'
import { offlineDb, purgeExpiredCache, synchronizeQueue } from '../../lib/offline'
import { humanize } from '../../lib/utils'
import type { OfflineOperation } from '../../types/domain'
import { useAuth } from '../auth/AuthProvider'

export function SyncPage() {
  const { org } = useParams()
  const { user } = useAuth()
  const [operations, setOperations] = useState<OfflineOperation[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')
  const attemptedOnlineSync = useRef(false)

  const refresh = useCallback(async () => {
    if (!org || !user) return
    const rows = await offlineDb.operations.where('[user_id+organization_id]').equals([user.id, org]).reverse().sortBy('created_at')
    setOperations(rows)
  }, [org, user])

  useEffect(() => { void purgeExpiredCache().then(refresh) }, [refresh])
  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])

  const failed = operations.filter((item) => ['failed', 'conflict', 'access_revoked'].includes(item.state)).length
  const pending = operations.filter((item) => ['queued', 'uploading', 'sending'].includes(item.state)).length

  const synchronize = useCallback(async () => {
    if (!org || !user || !navigator.onLine || syncing) return
    setSyncing(true)
    setMessage('')
    try {
      const result = await synchronizeQueue(user.id, org)
      setMessage(`${result.synced} synchronized · ${result.conflicts} conflicts · ${result.accessRevoked} access changes`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Synchronization failed.')
    } finally {
      await refresh()
      setSyncing(false)
    }
  }, [org, refresh, syncing, user])

  useEffect(() => {
    if (!online) {
      attemptedOnlineSync.current = false
      return
    }
    if (pending > 0 && !attemptedOnlineSync.current) {
      attemptedOnlineSync.current = true
      void synchronize()
    }
  }, [online, pending, synchronize])

  return <div className="stack-xl">
    <PageHeader eyebrow="DURABLE OFFLINE WORK" title="Sync center" description="Local saved does not mean server synchronized. Review conflicts and access changes before discarding anything." actions={<button className="button primary" disabled={!online || !pending || syncing} onClick={() => void synchronize()}><RefreshCw />{syncing ? 'Synchronizing…' : 'Sync now'}</button>} />
    {message && <div className="notice" role="status">{message}</div>}
    <section className="sync-status-grid"><article className={online ? 'online' : 'offline'}>{online ? <Wifi /> : <CloudOff />}<span><strong>{online ? 'Connected' : 'Offline'}</strong><small>{online ? 'Ready to validate queued operations' : 'Work will remain on this device'}</small></span></article><article><RotateCw /><span><strong>{pending}</strong><small>Pending operations</small></span></article><article className={failed ? 'danger' : ''}>{failed ? <AlertTriangle /> : <CheckCircle2 />}<span><strong>{failed}</strong><small>Needs attention</small></span></article></section>
    <section className="panel"><div className="section-heading"><h2>Local operation queue</h2><button className="text-button" onClick={() => void refresh()}><RefreshCw />Refresh</button></div>{!operations.length ? <div className="empty-state"><CheckCircle2 /><h2>Device queue is clear</h2><p>No unsynchronized work is stored for this user and organization.</p></div> : <div className="queue-list">{operations.map((operation) => <article className="queue-row" key={operation.id}><span className={`queue-icon queue-${operation.state}`}>{['failed', 'conflict', 'access_revoked'].includes(operation.state) ? <AlertTriangle /> : operation.state === 'synced' ? <CheckCircle2 /> : <RotateCw />}</span><span><strong>{humanize(operation.command_name)}</strong><small>{new Date(operation.created_at).toLocaleString()} · aggregate {operation.aggregate_id.slice(0, 8)}</small>{operation.last_error && <em>{operation.last_error}</em>}</span><StateBadge state={operation.state} /><button className="icon-button" aria-label="Remove acknowledged local operation" disabled={!['synced', 'failed', 'access_revoked'].includes(operation.state)} onClick={() => void offlineDb.operations.delete(operation.id).then(refresh)}><Trash2 /></button></article>)}</div>}</section>
    <div className="notice warning"><AlertTriangle /><span><strong>Logout protection:</strong> synchronize first whenever possible. Logout removes cached authorized records after warning and never transfers queued work to another account.</span></div>
  </div>
}
