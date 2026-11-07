import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { MessageSquare, Paperclip, Send } from 'lucide-react'
import { ErrorState, LoadingState } from '../../components/Ui'
import { formatDateTime, humanize } from '../../lib/utils'
import { downloadEvidence } from '../../lib/uploads'
import { useAuth } from '../auth/AuthProvider'
import { qualityClient } from '../inspections/qualityData'
import { offlineAccessExpiry, offlineDb, purgeOrganizationCache } from '../../lib/offline'

export interface ActivityEntry {
  key: string; at: string; kind: 'event' | 'comment' | 'attachment'; actor_id: string | null; actor_name: string;
  event_type: string; from_state?: string | null; to_state?: string | null; details: Record<string, unknown>;
  body?: string | null; visibility: string; attachment_id?: string | null; file_status?: string | null; file_name?: string | null; legacy_name?: boolean
}
interface ActivityPage { entries: ActivityEntry[]; has_more: boolean }
type Cursor = { at: string; key: string } | null
const actionNames: Record<string, string> = {
  'work.created': 'created this observation', 'work.draft_updated': 'updated the draft', 'work.submitted': 'submitted this observation for review',
  'work.triaged': 'updated category and priority', 'work.assigned': 'assigned this observation', 'work.delegated': 'changed the assigned tradesperson',
  'work.acknowledged': 'accepted the assignment', 'work.started': 'started work', 'work.blocked': 'reported a blocker', 'work.unblocked': 'cleared the blocker',
  'correction.submitted': 'submitted a repair for review', 'correction.accepted': 'accepted the repair', 'correction.rejected': 'returned the repair for rework',
  'work.reopened': 'reopened this observation', 'work.cancelled': 'disregarded or cancelled this observation', 'work.due_date_changed': 'changed the due date',
  'evidence.exception_issued': 'authorized an evidence exception', 'observation.reinspection_assigned': 'assigned an independent reinspection',
  'observation.reinspection_accepted': 'inspected and accepted the repair', 'observation.reinspection_rejected': 'inspected and returned the repair for rework'
}
function text(value: unknown) { return typeof value === 'string' ? value : '' }

export function ObservationActivity({ org, itemId, busy, uploading, attachmentCount, onComment, onUpload, offlineEntries }: {
  org: string; itemId: string; busy: boolean; uploading: boolean; attachmentCount: number;
  onComment: (event: FormEvent<HTMLFormElement>) => void; onUpload: (event: ChangeEvent<HTMLInputElement>) => void; offlineEntries: ActivityEntry[]
}) {
  const { user, access, can } = useAuth()
  const [downloadError, setDownloadError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const activity = useInfiniteQuery({ queryKey: ['observation-activity', org, itemId], networkMode: 'always', initialPageParam: null as Cursor,
    queryFn: async ({ pageParam }) => {
      const cacheKey = `${user?.id}:${org}:observation-feed:${itemId}:${pageParam?.key ?? 'latest'}`
      if (!navigator.onLine) {
        const saved = await offlineDb.cache.get(cacheKey)
        const page = saved && saved.expires_at > new Date().toISOString() ? saved.value as ActivityPage : null
        return { entries: page?.entries ?? offlineEntries, has_more: false }
      }
      const { data, error } = await qualityClient().rpc('observation_activity', { p_org: org, p_item: itemId, p_before_at: pageParam?.at ?? null, p_before_key: pageParam?.key ?? null })
      if (error) { if (user && ['42501', 'PGRST301'].includes(error.code)) await purgeOrganizationCache(user.id, org); throw error }
      if (!data || !Array.isArray(data.entries)) throw new Error('The observation history could not be confirmed. Refresh before continuing.')
      const page = { entries: data.entries, has_more: data.has_more ?? false } as ActivityPage
      if (user && access) await offlineDb.cache.put({ cache_key: cacheKey, user_id: user.id, organization_id: org, entity_type: 'observation_activity', entity_id: itemId, server_version: 1, value: page, cached_at: new Date().toISOString(), expires_at: offlineAccessExpiry(access) }).catch(() => undefined)
      return page
    }, getNextPageParam: (page): Cursor | undefined => page.has_more && page.entries.length ? { at: page.entries.at(-1)!.at, key: page.entries.at(-1)!.key } : undefined,
    refetchInterval: navigator.onLine ? 15000 : false
  })
  const entries = [...new Map((activity.data?.pages.flatMap((page) => page.entries) ?? []).map((entry) => [entry.key, entry])).values()].sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key))
  return <section className="panel form-panel observation-activity stack-lg" aria-label="Observation conversation and history"><div className="section-heading"><div><h2><MessageSquare />Conversation & history</h2><p>Assignments, updates, evidence, and decisions stay with this observation when it changes hands.</p></div></div>
    {downloadError && <ErrorState message={downloadError} />}
    {activity.hasNextPage && <button className="button ghost" disabled={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()}>{activity.isFetchingNextPage ? 'Loading…' : 'Load earlier activity'}</button>}
    {activity.isLoading && <LoadingState label="Loading observation history" />}{activity.error && <ErrorState message={activity.error.message} retry={() => void activity.refetch()} />}
    {!activity.error && <ol className="observation-feed">{entries.map((entry) => {
      const previous = [text(entry.details.previous_company_name), text(entry.details.previous_assignee_name)].filter(Boolean).join(' · ')
      const target = [text(entry.details.company_name), text(entry.details.assignee_name)].filter(Boolean).join(' · ')
      return <li key={entry.key} className={`observation-feed-entry ${entry.kind}`}><span className="activity-avatar" aria-hidden="true">{entry.actor_name.slice(0, 2).toUpperCase()}</span><div className="activity-entry-body"><div className="activity-entry-meta"><strong>{entry.actor_name}</strong><time dateTime={entry.at}>{formatDateTime(entry.at)}</time>{entry.visibility === 'internal' && <span className="activity-private">Internal only</span>}</div>
        {entry.kind === 'comment' ? <p className="activity-message">{entry.body}</p> : entry.kind === 'attachment' ? <div className="activity-file"><Paperclip /><span><strong>{entry.file_name}</strong><small>{humanize(entry.file_status ?? 'pending')}</small></span>{entry.file_status === 'ready' && entry.attachment_id && user && <button className="text-button" onClick={() => void downloadEvidence(entry.attachment_id!, user.id, org).catch((error) => setDownloadError((error as Error).message))}>Download</button>}</div> : <div className="activity-event"><p>{actionNames[entry.event_type] ?? humanize(entry.event_type.replaceAll('.', ' '))}.</p>{previous && <p><strong>From:</strong> {previous}</p>}{target && <p><strong>To:</strong> {target}</p>}{entry.from_state && entry.to_state && entry.from_state !== entry.to_state && <p className="muted">{humanize(entry.from_state)} → {humanize(entry.to_state)}</p>}{text(entry.details.new_due_at) && <p>Due date: {text(entry.details.old_due_at) ? formatDateTime(text(entry.details.old_due_at)) : 'Not set'} → {formatDateTime(text(entry.details.new_due_at))}</p>}{['reason', 'completion_note', 'notes', 'resolution', 'cause'].map((key) => text(entry.details[key]) && <p className="activity-reason" key={key}>{text(entry.details[key])}</p>)}</div>}
      </div></li>
    })}</ol>}
    {!activity.isLoading && !activity.error && !entries.length && <p className="muted">No synchronized activity yet. New updates will appear here.</p>}
    {entries.some((entry) => entry.legacy_name) && <p className="fine-print">Older activity may show current profile names. New assignment events preserve names recorded at the time.</p>}
    {can('comment.create_shared') && <form className="activity-composer stack-lg" onSubmit={onComment}><label className="field">Message about this observation<textarea name="body" required maxLength={10000} rows={3} placeholder="Explain what changed, ask a question, or hand over the next step…" /></label><div className="activity-composer-actions"><label className="field">Audience<select name="visibility"><option value="shared">Shared with observation participants</option>{can('comment.internal') && <option value="internal">Internal team only</option>}</select></label><button className="button primary" disabled={busy}><Send />{busy ? 'Posting…' : 'Post comment'}</button></div></form>}
    <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" onChange={onUpload} />
    {can('evidence.upload') && <button className="button secondary" disabled={uploading || attachmentCount >= 20} onClick={() => fileInput.current?.click()}><Paperclip />{uploading ? 'Processing evidence…' : navigator.onLine ? 'Upload evidence' : 'Save evidence offline'}</button>}
  </section>
}
