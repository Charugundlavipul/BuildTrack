import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, CalendarClock, Camera, ChevronLeft, ClipboardCheck, MessageSquare, Paperclip, ShieldCheck, UserRound } from 'lucide-react'
import { ErrorState, LoadingState, PageHeader, PriorityBadge, StateBadge } from '../../components/Ui'
import { useParticipants, useRosterCompanies, useWorkItem } from '../../lib/data'
import { formatDateTime, humanize, relativeDate } from '../../lib/utils'
import { newCommand, runCommand } from '../../lib/commands'
import { uploadWorkEvidence } from '../../lib/uploads'
import { stageWorkEvidence } from '../../lib/offline'
import { useAuth } from '../auth/AuthProvider'
import type { WorkState } from '../../types/domain'

const actionByState: Partial<Record<WorkState, { command: string; label: string }>> = {
  draft: { command: 'submit_work_item', label: 'Submit for triage' },
  assigned: { command: 'acknowledge_work', label: 'Acknowledge work' },
  acknowledged: { command: 'start_work', label: 'Start work' },
  rework_required: { command: 'start_work', label: 'Resume correction' },
  blocked: { command: 'unblock_work', label: 'Resume blocked work' }
}

export function WorkDetailPage() {
  const { org, id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const work = useWorkItem(org, id)
  const participants = useParticipants(org, work.data?.item.neighborhood_id)
  const companies = useRosterCompanies(org, work.data?.item.neighborhood_id)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [accountableType, setAccountableType] = useState<'internal' | 'company'>('internal')

  async function execute(command: string, payload: Record<string, unknown> = {}) {
    if (!org || !id || !user || !work.data) return
    setBusy(true)
    setError('')
    try {
      const result = await runCommand(command, newCommand({ item_id: id, ...payload }, work.data.item.version), {
        organizationId: org,
        userId: user.id,
        aggregateId: id,
        allowOffline: ['acknowledge_work', 'start_work', 'block_work', 'submit_correction', 'add_comment'].includes(command)
      })
      if ('queued' in result) navigate(`/org/${org}/sync`)
      else if (!result.ok) setError(result.error.message)
      else await queryClient.invalidateQueries({ queryKey: ['work-item', org, id] })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The command could not be completed')
    } finally { setBusy(false) }
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = String(form.get('body')).trim()
    if (!body) return
    await execute('add_comment', { body, visibility: form.get('visibility') })
    event.currentTarget.reset()
  }

  async function uploadEvidence(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !org || !id || !work.data) return
    setUploading(true)
    setError('')
    try {
      if (!navigator.onLine) {
        if (!user) throw new Error('Sign in again before saving offline evidence.')
        await stageWorkEvidence({
          userId: user.id,
          organizationId: org,
          neighborhoodId: work.data.item.neighborhood_id,
          homeId: work.data.item.home_id,
          workItemId: id,
          file
        })
        navigate(`/org/${org}/sync`)
        return
      }
      await uploadWorkEvidence({
        organizationId: org,
        neighborhoodId: work.data.item.neighborhood_id,
        homeId: work.data.item.home_id,
        workItemId: id,
        file
      })
      await work.refetch()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Evidence upload failed.')
    } finally {
      event.target.value = ''
      setUploading(false)
    }
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const attachmentIds = work.data?.attachments.filter((attachment) => attachment.status === 'ready' && attachment.visibility === 'shared').map((attachment) => attachment.id) ?? []
    await execute('submit_correction', { note: String(form.get('note')).trim(), attachment_ids: attachmentIds })
  }

  async function assignWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await execute('assign_work_item', {
      accountable_internal_user_id: accountableType === 'internal' ? String(form.get('internal_user_id')) : null,
      company_id: accountableType === 'company' ? String(form.get('company_id')) : null,
      due_at: new Date(String(form.get('due_at'))).toISOString(),
      reason: String(form.get('reason')).trim() || 'Initial assignment'
    })
  }

  async function updateDueDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await execute('update_due_date', {
      new_due_at: new Date(String(form.get('new_due_at'))).toISOString(),
      reason: String(form.get('reason')).trim()
    })
  }

  async function issueEvidenceException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const expires = String(form.get('expires_at') ?? '')
    await execute('issue_evidence_exception', {
      reason: String(form.get('reason')).trim(),
      expires_at: expires ? new Date(expires).toISOString() : null
    })
  }

  async function reopenWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await execute('reopen_work', { reason: String(form.get('reason')).trim() })
  }

  async function cancelWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await execute('cancel_work', { reason: String(form.get('reason')).trim(), duplicate_of_id: null })
  }

  if (work.isLoading) return <LoadingState label="Loading work item" />
  if (work.isError || !work.data) return <ErrorState message={work.error?.message ?? 'Work item was not found or is outside your scope.'} retry={() => void work.refetch()} />
  const item = work.data.item
  const primaryAction = actionByState[item.state]

  return <div className="stack-xl">
    <button className="text-button" onClick={() => navigate(-1)}><ChevronLeft />Back</button>
    <PageHeader eyebrow={item.lot_code ? `LOT ${item.lot_code}` : 'COMMON AREA'} title={item.title} description={item.description} actions={<div className="button-row"><PriorityBadge priority={item.priority} /><StateBadge state={item.state} />{primaryAction && <button className="button primary" disabled={busy} onClick={() => void execute(primaryAction.command, primaryAction.command === 'unblock_work' ? { resolution: 'Work is ready to resume.' } : {})}>{primaryAction.label}</button>}</div>} />
    {error && <div className="notice danger" role="alert"><AlertTriangle />{error}</div>}
    <div className="detail-layout">
      <div className="stack-lg">
        <section className="panel detail-card">
          <div className="section-heading"><h2>Work details</h2><span>Version {item.version}</span></div>
          <dl className="detail-grid">
            <div><dt><UserRound />Accountable party</dt><dd>{item.assigned_party_name ?? 'Awaiting assignment'}</dd></div>
            <div><dt><CalendarClock />Due date</dt><dd>{formatDateTime(item.due_at)}<small>{relativeDate(item.due_at)}</small></dd></div>
            <div><dt>Location</dt><dd>{item.lot_code ? `Lot ${item.lot_code}` : 'Common area'}{item.address ? <small>{item.address}</small> : null}</dd></div>
            <div><dt>Safety</dt><dd>{item.safety_flag ? 'On-site verification required' : 'Standard verification policy'}</dd></div>
          </dl>
          {['in_progress', 'acknowledged', 'rework_required'].includes(item.state) && <div className="inline-actions"><button className="button secondary" onClick={() => void execute('block_work', { cause: 'other', notes: 'Blocked from work detail' })}>Report blocker</button></div>}
          {item.state === 'in_progress' && <form className="correction-form" onSubmit={submitCorrection}><label className="field">Completion note<textarea name="note" required maxLength={4000} placeholder="Describe what was corrected and where." /></label><p className="muted">At least one ready shared evidence file is required unless an authorized exception exists.</p><button className="button primary" disabled={busy}><ClipboardCheck />Submit correction</button></form>}
          {['submitted', 'assigned', 'acknowledged', 'in_progress', 'blocked', 'rework_required'].includes(item.state) && <form className="assignment-form" onSubmit={assignWork}><div className="section-heading"><h3>Assign or reassign</h3><span>Due date required</span></div><div className="form-grid two">
            <label className="field">Accountable party type<select value={accountableType} onChange={(event) => setAccountableType(event.target.value as 'internal' | 'company')}><option value="internal">Internal member</option><option value="company">Trade company</option></select></label>
            {accountableType === 'internal' ? <label className="field">Internal member<select name="internal_user_id" required defaultValue=""><option value="" disabled>Select member</option>{participants.data?.map((participant) => <option value={participant.user_id} key={participant.user_id}>{participant.display_name}</option>)}</select></label> : <label className="field">Rostered company<select name="company_id" required defaultValue=""><option value="" disabled>Select company</option>{companies.data?.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label>}
            <label className="field">Due date and time<input name="due_at" type="datetime-local" required /></label>
            <label className="field">Assignment reason<input name="reason" maxLength={500} placeholder="Initial assignment or reason for reassignment" /></label>
          </div><button className="button secondary" disabled={busy}>Assign work</button></form>}
          {item.due_at && !['verified', 'cancelled'].includes(item.state) && <details className="command-disclosure"><summary>Change due date</summary><form className="form-grid two" onSubmit={updateDueDate}><label className="field">New due date and time<input name="new_due_at" type="datetime-local" required /></label><label className="field">Reason<input name="reason" maxLength={500} required /></label><div className="full-span"><button className="button secondary" disabled={busy}>Update due date</button></div></form></details>}
          {['assigned', 'acknowledged', 'in_progress', 'blocked', 'rework_required'].includes(item.state) && <details className="command-disclosure"><summary>Authorize an evidence exception</summary><form className="form-grid two" onSubmit={issueEvidenceException}><label className="field">Reason<textarea name="reason" maxLength={1000} required /></label><label className="field">Expires at (optional)<input name="expires_at" type="datetime-local" /></label><div className="full-span"><button className="button secondary" disabled={busy}>Authorize exception</button></div></form></details>}
          {item.state === 'ready_for_verification' && <div className="verification-box"><ShieldCheck /><div><strong>Ready for independent verification</strong><p>An eligible verifier must record an on-site or remote decision.</p></div><div><button className="button secondary" onClick={() => void execute('verify_correction', { decision: 'rejected', method: 'on_site', notes: 'Additional correction required' })}>Return for rework</button><button className="button primary" onClick={() => void execute('verify_correction', { decision: 'accepted', method: item.safety_flag ? 'on_site' : 'remote', notes: 'Correction accepted' })}>Accept correction</button></div></div>}
          {item.state === 'verified' && <details className="command-disclosure danger-zone"><summary>Reopen verified work</summary><form onSubmit={reopenWork}><label className="field">Reason<textarea name="reason" maxLength={1000} required /></label><button className="button secondary" disabled={busy}>Reopen for correction</button></form></details>}
          {!['verified', 'cancelled'].includes(item.state) && <details className="command-disclosure danger-zone"><summary>Cancel work item</summary><form onSubmit={cancelWork}><label className="field">Cancellation reason<textarea name="reason" maxLength={1000} required /></label><button className="button danger" disabled={busy}>Cancel work item</button></form></details>}
        </section>
        <section className="panel detail-card">
          <div className="section-heading"><h2><MessageSquare />Conversation</h2><span>{work.data.comments.length} messages</span></div>
          <div className="comment-list">{work.data.comments.map((comment) => <article className="comment" key={String(comment.id)}><div><strong>{String(comment.author_id).slice(0, 8)}</strong><span className={`visibility ${String(comment.visibility)}`}>{String(comment.visibility)}</span><time>{formatDateTime(String(comment.created_at))}</time></div><p>{String(comment.body)}</p></article>)}{!work.data.comments.length && <p className="muted">No comments yet.</p>}</div>
          <form className="comment-form" onSubmit={addComment}><textarea name="body" required placeholder="Add a clear update or question…" /><div><label><span className="sr-only">Comment visibility</span><select name="visibility"><option value="shared">Shared with assigned participants</option><option value="internal">Internal only</option></select></label><button className="button primary" disabled={busy}>Post comment</button></div></form>
        </section>
        <section className="panel detail-card">
          <div className="section-heading"><h2><Camera />Evidence</h2><span>Private storage</span></div>
          <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" onChange={uploadEvidence} />
          <button className="upload-drop interactive" disabled={uploading || work.data.attachments.length >= 20} onClick={() => fileInput.current?.click()}><Paperclip /><div><strong>{uploading ? 'Processing evidence…' : navigator.onLine ? 'Upload evidence' : 'Save evidence offline'}</strong><span>JPEG, PNG, HEIC, HEIF, or PDF · 20 MB maximum · 20 files per item</span></div></button>
          <div className="evidence-list">{work.data.attachments.map((attachment) => <div className="evidence-row" key={String(attachment.id)}><Paperclip /><span><strong>{String(attachment.original_name)}</strong><small>{(Number(attachment.byte_size) / 1024 / 1024).toFixed(1)} MB</small></span><StateBadge state={String(attachment.status)} /></div>)}{!work.data.attachments.length && <p className="muted">No evidence uploaded yet.</p>}</div>
        </section>
      </div>
      <aside className="panel timeline-card">
        <div className="section-heading"><h2>History</h2><span>Append-only</span></div>
        <ol className="timeline">{work.data.events.map((event) => <li key={String(event.id)}><span className="timeline-dot" /><div><strong>{humanize(String(event.event_type))}</strong><p>{event.from_state && event.to_state ? `${humanize(String(event.from_state))} → ${humanize(String(event.to_state))}` : 'Recorded event'}</p><time>{formatDateTime(String(event.server_at))}</time></div></li>)}{!work.data.events.length && <li><span className="timeline-dot" /><div><strong>Draft created</strong><p>History will appear after the first synchronized command.</p></div></li>}</ol>
      </aside>
    </div>
  </div>
}
