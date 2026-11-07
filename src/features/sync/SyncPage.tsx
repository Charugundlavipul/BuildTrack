import { useCallback, useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { useParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CloudOff, Eye, RefreshCw, RotateCw, Wifi } from 'lucide-react'
import { PageHeader, StateBadge } from '../../components/Ui'
import { dependentOperations, discardLocalOperation, offlineDb, purgeExpiredCache, synchronizeQueue } from '../../lib/offline'
import { requireSupabase } from '../../lib/supabase'
import { formatDateTime, humanize } from '../../lib/utils'
import type { OfflineOperation } from '../../types/domain'
import { useAuth } from '../auth/AuthProvider'

const readableFields = new Set(['title', 'description', 'body', 'note', 'notes', 'completion_note', 'result', 'explanation', 'finding_title', 'priority', 'state', 'type', 'status', 'scheduled_at', 'due_at', 'resolution', 'cause', 'safety_flag', 'visibility'])
const fieldLabels: Record<string, string> = { body: 'Comment', note: 'Correction note', completion_note: 'Correction note', safety_flag: 'Safety-sensitive' }
function ChangeDetails({ values }: { values: Record<string, unknown> }) {
  const fields = Object.entries(values).filter(([key, value]) => readableFields.has(key) && value != null && value !== '')
  return <div className="stack-lg">{fields.length ? <dl className="sync-change-details">{fields.map(([key, value]) => <div key={key}><dt>{fieldLabels[key] ?? humanize(key)}</dt><dd>{typeof value === 'boolean' ? value ? 'Yes' : 'No' : key.endsWith('_at') ? formatDateTime(String(value)) : ['state', 'status', 'priority', 'result', 'type', 'visibility', 'cause'].includes(key) ? humanize(String(value)) : String(value)}</dd></div>)}</dl> : <p>No editable text was recorded for this action.</p>}{Array.isArray(values.attachment_ids) && <p>{values.attachment_ids.length} evidence files linked.</p>}<details className="command-disclosure"><summary>Original record data</summary><pre className="sync-comparison">{JSON.stringify(values, null, 2)}</pre></details></div>
}

export function SyncPage() {
  const { org } = useParams()
  const { user } = useAuth()
  const [operations, setOperations] = useState<OfflineOperation[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')
  const [reviewing, setReviewing] = useState<OfflineOperation | null>(null)
  const [serverRecord, setServerRecord] = useState<Record<string, unknown> | null>(null)
  const [reviewError, setReviewError] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  const refresh = useCallback(async () => {
    if (!org || !user) return
    const rows = await offlineDb.operations.where('[user_id+organization_id]').equals([user.id, org]).reverse().sortBy('created_at')
    setOperations(rows)
  }, [org, user])

  useEffect(() => { void purgeExpiredCache().then(refresh) }, [refresh])
  useEffect(() => {
    if (!org || !user) return
    const subscription = liveQuery(() => offlineDb.operations.where('[user_id+organization_id]').equals([user.id, org]).reverse().sortBy('created_at')).subscribe({ next: setOperations, error: () => setMessage('Saved work could not be read. Check your browser storage.') })
    return () => subscription.unsubscribe()
  }, [org, user])
  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])
  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string; organizationId: string; syncing: boolean }>).detail
      if (detail?.userId === user?.id && detail.organizationId === org) setSyncing(detail.syncing)
    }
    window.addEventListener('buildtrack:sync-status', onStatus)
    return () => window.removeEventListener('buildtrack:sync-status', onStatus)
  }, [org, user?.id])

  const failed = operations.filter((item) => ['failed', 'conflict', 'access_revoked'].includes(item.state)).length
  const pending = operations.filter((item) => ['queued', 'failed', 'uploading', 'sending'].includes(item.state)).length
  const recordPath = (operation: OfflineOperation) => `/org/${org}/${operation.command_name.includes('inspection') ? 'inspections' : 'work'}/${operation.aggregate_id}`
  async function review(operation: OfflineOperation) {
    setReviewing(operation); setDiscarding(false); setServerRecord(null); setReviewError(''); setReviewBusy(true)
    try {
      const client = requireSupabase()
      const { data, error } = await (operation.command_name.includes('inspection') ? client.from('inspections').select('*').eq('organization_id', org!).eq('id', operation.aggregate_id).maybeSingle() : client.from('work_item_list').select('*').eq('organization_id', org!).eq('id', operation.aggregate_id).maybeSingle())
      if (error) throw new Error(error.message)
      setServerRecord(data as Record<string, unknown> | null)
      if (!data) setReviewError('The current record is unavailable or outside your access. Your local change remains saved.')
    } catch (caught) { setReviewError(caught instanceof Error ? caught.message : 'Unable to load the current record.') }
    finally { setReviewBusy(false) }
  }
  async function discard() {
    if (!reviewing || !user || !org || syncing) return
    setReviewBusy(true); setReviewError('')
    try { await discardLocalOperation(user.id, org, reviewing.id); await refresh(); setReviewing(null) }
    catch (caught) { setReviewError(caught instanceof Error ? caught.message : 'Local work could not be discarded.') }
    finally { setReviewBusy(false) }
  }

  const synchronize = useCallback(async () => {
    if (!org || !user || !navigator.onLine || syncing) return
    setSyncing(true)
    setMessage('')
    try {
      await offlineDb.operations
        .where('[user_id+organization_id]').equals([user.id, org])
        .filter((operation) => operation.state === 'failed')
        .modify({ state: 'queued', retryable: true, retries: 0 })
      const result = await synchronizeQueue(user.id, org)
      setMessage(`Last attempt: ${result.synced} synchronized · ${result.conflicts} new conflicts · ${result.accessRevoked} access changes · ${result.blocked} waiting for earlier changes`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Synchronization failed.')
    } finally {
      await refresh()
      setSyncing(false)
    }
  }, [org, refresh, syncing, user])

  return <div className="stack-xl">
    <PageHeader eyebrow="SAVED WORK" title="Sync center" description="Changes sync automatically when you reconnect while the app is open. Review anything that needs attention here." actions={<button className="button secondary" disabled={!online || !pending || syncing} onClick={() => void synchronize()}><RefreshCw />{syncing ? 'Syncing…' : 'Retry now'}</button>} />
    {message && <div className="notice" role="status">{message}</div>}
    <section className="sync-status-grid"><article className={online ? 'online' : 'offline'}>{online ? <Wifi /> : <CloudOff />}<span><strong>{online ? syncing ? 'Syncing' : 'Connected' : 'Offline'}</strong><small>{online ? 'Saved work syncs automatically' : 'Work stays on this device until you reconnect'}</small></span></article><article><RotateCw /><span><strong>{pending}</strong><small>Pending operations</small></span></article><article className={failed ? 'danger' : ''}>{failed ? <AlertTriangle /> : <CheckCircle2 />}<span><strong>{failed}</strong><small>Needs attention</small></span></article></section>
    <section className="panel"><div className="section-heading"><h2>Saved work on this device</h2><button className="text-button" onClick={() => void refresh()}><RefreshCw />Refresh</button></div>{!operations.length ? <div className="empty-state"><CheckCircle2 /><h2>Device queue is clear</h2><p>No unsynchronized work is stored for this user and organization.</p></div> : <div className="queue-list">{operations.map((operation) => <article className="queue-row" key={operation.id}><span className={`queue-icon queue-${operation.state}`}>{['failed', 'conflict', 'access_revoked'].includes(operation.state) ? <AlertTriangle /> : operation.state === 'synced' ? <CheckCircle2 /> : <RotateCw />}</span><span><strong>{humanize(operation.command_name)}</strong><small>{new Date(operation.created_at).toLocaleString()} · aggregate {operation.aggregate_id.slice(0, 8)}</small>{operation.last_error && <em>{operation.last_error}</em>}</span><StateBadge state={operation.state} /><button className="icon-button" aria-label="Review local operation" disabled={syncing || !['synced', 'failed', 'conflict', 'access_revoked'].includes(operation.state)} onClick={() => void review(operation)}><Eye /></button></article>)}</div>}</section>
    {reviewing && <section className="panel form-panel stack-lg" aria-label="Review local change"><div className="section-heading"><h2>Review local change</h2><button className="button ghost" disabled={reviewBusy} onClick={() => setReviewing(null)}>Close review</button></div><p>{humanize(reviewing.command_name)} · {humanize(reviewing.state)}</p>{reviewBusy && <p role="status">Loading…</p>}{reviewError && <div className="notice danger" role="alert">{reviewError}</div>}<div className="form-grid two"><div><h3>Saved on this device</h3><p>Based on version {reviewing.envelope.expected_version ?? 'not specified'}.</p><ChangeDetails values={reviewing.envelope.payload} /></div><div><h3>Current server record</h3>{serverRecord && <><p>Version {String(serverRecord.version ?? '—')}</p><ChangeDetails values={serverRecord} /></>}</div></div><p>For a conflict, open the current record and apply the changes that are still needed. Keep this local copy until you have checked the result.</p><Link className="button secondary" to={recordPath(reviewing)}>Open current record</Link>{discarding ? <div className="notice warning stack-lg"><p>Discard this operation and {Math.max(0, dependentOperations(operations, reviewing.id).length - 1)} dependent local operations? Their saved payloads and unsent evidence files will be removed from this device. Server records will remain.</p><div className="button-row"><button className="button danger" disabled={reviewBusy || syncing} onClick={() => void discard()}>Confirm discard</button><button className="button ghost" disabled={reviewBusy} onClick={() => setDiscarding(false)}>Keep local work</button></div></div> : <button className="button secondary" disabled={reviewBusy || syncing} onClick={() => setDiscarding(true)}>{reviewing.state === 'synced' ? 'Remove acknowledged local copy' : 'Discard local operation'}</button>}</section>}
    <div className="notice warning"><AlertTriangle /><span><strong>Logout protection:</strong> synchronize first whenever possible. Logout removes cached authorized records after warning and never transfers queued work to another account.</span></div>
  </div>
}
