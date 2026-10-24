import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, CalendarClock, Camera, ChevronLeft, ClipboardCheck, MessageSquare, Paperclip, ShieldCheck, UserRound } from 'lucide-react'
import { ErrorState, LoadingState, PageHeader, PriorityBadge, StateBadge } from '../../components/Ui'
import { useParticipants, useRosterCompanies, useWorkItem } from '../../lib/data'
import { formatDateTime, humanize, relativeDate } from '../../lib/utils'
import { newCommand, runCommand } from '../../lib/commands'
import { downloadEvidence, uploadWorkEvidence } from '../../lib/uploads'
import { findOfflineWorkItem, stageWorkEvidence } from '../../lib/offline'
import { useAuth } from '../auth/AuthProvider'
import type { WorkState } from '../../types/domain'
import { requireSupabase } from '../../lib/supabase'

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
  const { user, can } = useAuth()
  const work = useWorkItem(org, id)
  const cachedWork = useQuery({
    queryKey: ['offline-work-item', user?.id, org, id],
    enabled: Boolean(user && org && id),
    queryFn: () => findOfflineWorkItem(user!.id, org!, id!)
  })
  const workData = work.data ?? cachedWork.data
  const participants = useParticipants(org, workData?.item.neighborhood_id)
  const companies = useRosterCompanies(org, workData?.item.neighborhood_id)
  const categories = useQuery({
    queryKey: ['work-categories', org],
    enabled: Boolean(org && (can('work.create') || can('work.triage'))),
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('work_categories').select('id,name').eq('organization_id', org!).eq('active', true).order('name')
      if (error) throw error
      return data
    }
  })
  const delegation = useQuery({
    queryKey: ['company-delegation', org, id, workData?.item.version],
    enabled: Boolean(org && id && workData),
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('company_delegation_options', { p_organization_id: org!, p_work_item_id: id! })
      if (error) throw error
      return data as null | { company_id: string; current_technician_id: string | null; technicians: Array<{ user_id: string; display_name: string }> }
    },
    retry: false
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [accountableType, setAccountableType] = useState<'internal' | 'company'>('internal')

  async function execute(command: string, payload: Record<string, unknown> = {}) {
    if (!org || !id || !user || !workData) return
    setBusy(true)
    setError('')
    try {
      const result = await runCommand(command, newCommand({ item_id: id, ...payload }, workData.item.version), {
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
    if (!file || !org || !id || !workData) return
    setUploading(true)
    setError('')
    try {
      if (!navigator.onLine) {
        if (!user) throw new Error('Sign in again before saving offline evidence.')
        await stageWorkEvidence({
          userId: user.id,
          organizationId: org,
          neighborhoodId: workData.item.neighborhood_id,
          homeId: workData.item.home_id,
          workItemId: id,
          file
        })
        navigate(`/org/${org}/sync`)
        return
      }
      await uploadWorkEvidence({
        organizationId: org,
        neighborhoodId: workData.item.neighborhood_id,
        homeId: workData.item.home_id,
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
    const attachmentIds = workData?.attachments.filter((attachment) => attachment.status === 'ready' && attachment.visibility === 'shared').map((attachment) => attachment.id) ?? []
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

  async function updateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await execute('update_work_draft', {
      title: String(form.get('title')).trim(), description: String(form.get('description')).trim(),
      category_id: String(form.get('category_id')) || null, priority: String(form.get('priority')),
      safety_flag: form.get('safety_flag') === 'on'
    })
  }

  async function triageWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await execute('triage_work_item', { category_id: String(form.get('category_id')) || null, priority: String(form.get('priority')), notes: String(form.get('notes')).trim() })
  }

  async function delegateCompanyWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const technicianId = String(new FormData(event.currentTarget).get('technician_id'))
    await execute('delegate_company_work', { technician_id: technicianId || null })
    await delegation.refetch()
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

  if (!workData && (work.isLoading || cachedWork.isLoading)) return <LoadingState label="Loading work item" />
  if (!workData) return <ErrorState message={work.error?.message ?? 'This work item was not downloaded before the device went offline.'} retry={() => void Promise.all([work.refetch(), cachedWork.refetch()])} />
  const item = workData.item
  const primaryAction = actionByState[item.state]
  const mayUsePrimaryAction = Boolean(primaryAction && (item.state === 'draft' ? can('work.create') || can('work.triage') : can('work.execute_assigned')))

  return <div className="stack-xl">
    <button className="text-button" onClick={() => navigate(-1)}><ChevronLeft />Back</button>
    <PageHeader eyebrow={item.lot_code ? `LOT ${item.lot_code}` : 'COMMON AREA'} title={item.title} description={item.description} actions={<div className="button-row"><PriorityBadge priority={item.priority} /><StateBadge state={item.state} />{primaryAction && mayUsePrimaryAction && <button className="button primary" disabled={busy} onClick={() => void execute(primaryAction.command, primaryAction.command === 'unblock_work' ? { resolution: 'Work is ready to resume.' } : {})}>{primaryAction.label}</button>}</div>} />
    {!navigator.onLine && cachedWork.data && <div className="notice warning"><AlertTriangle />Offline copy loaded. Changes and photos are queued on this device until access and record versions are revalidated.</div>}
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
          {item.state === 'draft' && (can('work.create') || can('work.triage')) && <details className="command-disclosure" open><summary>Edit draft</summary><form className="stack-lg" onSubmit={updateDraft}><div className="form-grid two"><label className="field">Title<input name="title" defaultValue={item.title} maxLength={160} required/></label><label className="field">Priority<select name="priority" defaultValue={item.priority}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label><label className="field">Category<select name="category_id" defaultValue={item.category_id ?? ''}><option value="">Keep current</option>{categories.data?.map((category)=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="check-row"><input type="checkbox" name="safety_flag" defaultChecked={item.safety_flag}/><span>Safety-sensitive; require on-site verification</span></label><label className="field full-span">Description<textarea name="description" defaultValue={item.description} rows={4} maxLength={10000} required/></label></div><button className="button secondary" disabled={busy}>Save draft changes</button></form></details>}
          {can('work.triage') && !['verified','cancelled'].includes(item.state) && <details className="command-disclosure"><summary>Triage classification</summary><form className="form-grid two" onSubmit={triageWork}><label className="field">Category<select name="category_id" defaultValue={item.category_id ?? ''}><option value="">Keep current</option>{categories.data?.map((category)=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="field">Priority<select name="priority" defaultValue={item.priority}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label><label className="field full-span">Triage notes<input name="notes" maxLength={500}/></label><div className="full-span"><button className="button secondary" disabled={busy}>Save triage</button></div></form></details>}
          {can('work.execute_assigned') && ['in_progress', 'acknowledged', 'rework_required'].includes(item.state) && <div className="inline-actions"><button className="button secondary" onClick={() => void execute('block_work', { cause: 'other', notes: 'Blocked from work detail' })}>Report blocker</button></div>}
          {can('work.execute_assigned') && item.state === 'in_progress' && <form className="correction-form" onSubmit={submitCorrection}><label className="field">Completion note<textarea name="note" required maxLength={4000} placeholder="Describe what was corrected and where." /></label><p className="muted">At least one ready shared evidence file is required unless an authorized exception exists.</p><button className="button primary" disabled={busy}><ClipboardCheck />Submit correction</button></form>}
          {can('work.assign') && ['submitted', 'assigned', 'acknowledged', 'in_progress', 'blocked', 'rework_required'].includes(item.state) && <form className="assignment-form" onSubmit={assignWork}><div className="section-heading"><h3>Assign or reassign</h3><span>Due date required</span></div><div className="form-grid two">
            <label className="field">Accountable party type<select value={accountableType} onChange={(event) => setAccountableType(event.target.value as 'internal' | 'company')}><option value="internal">Internal member</option><option value="company">Trade company</option></select></label>
            {accountableType === 'internal' ? <label className="field">Internal member<select name="internal_user_id" required defaultValue=""><option value="" disabled>Select member</option>{participants.data?.map((participant) => <option value={participant.user_id} key={participant.user_id}>{participant.display_name}</option>)}</select></label> : <label className="field">Rostered company<select name="company_id" required defaultValue=""><option value="" disabled>Select company</option>{companies.data?.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label>}
            <label className="field">Due date and time<input name="due_at" type="datetime-local" required /></label>
            <label className="field">Assignment reason<input name="reason" maxLength={500} placeholder="Initial assignment or reason for reassignment" /></label>
          </div><button className="button secondary" disabled={busy}>Assign work</button></form>}
          {delegation.data && <form className="assignment-form" onSubmit={delegateCompanyWork}><div className="section-heading"><div><h3>Delegate company work</h3><p>Choose an active technician in your accountable company. The company remains accountable.</p></div></div><div className="form-grid two"><label className="field">Technician<select name="technician_id" defaultValue={delegation.data.current_technician_id ?? ''}><option value="">Company manager / unassigned technician</option>{delegation.data.technicians.map((technician)=><option key={technician.user_id} value={technician.user_id}>{technician.display_name}</option>)}</select></label></div><button className="button secondary" disabled={busy}>Save delegation</button></form>}
          {can('work.assign') && item.due_at && !['verified', 'cancelled'].includes(item.state) && <details className="command-disclosure"><summary>Change due date</summary><form className="form-grid two" onSubmit={updateDueDate}><label className="field">New due date and time<input name="new_due_at" type="datetime-local" required /></label><label className="field">Reason<input name="reason" maxLength={500} required /></label><div className="full-span"><button className="button secondary" disabled={busy}>Update due date</button></div></form></details>}
          {can('work.assign') && ['assigned', 'acknowledged', 'in_progress', 'blocked', 'rework_required'].includes(item.state) && <details className="command-disclosure"><summary>Authorize an evidence exception</summary><form className="form-grid two" onSubmit={issueEvidenceException}><label className="field">Reason<textarea name="reason" maxLength={1000} required /></label><label className="field">Expires at (optional)<input name="expires_at" type="datetime-local" /></label><div className="full-span"><button className="button secondary" disabled={busy}>Authorize exception</button></div></form></details>}
          {can('work.verify') && item.state === 'ready_for_verification' && <div className="verification-box"><ShieldCheck /><div><strong>Ready for independent verification</strong><p>An eligible verifier must record an on-site or remote decision.</p></div><div><button className="button secondary" onClick={() => void execute('verify_correction', { decision: 'rejected', method: 'on_site', notes: 'Additional correction required' })}>Return for rework</button><button className="button primary" onClick={() => void execute('verify_correction', { decision: 'accepted', method: item.safety_flag ? 'on_site' : 'remote', notes: 'Correction accepted' })}>Accept correction</button></div></div>}
          {can('work.triage') && item.state === 'verified' && <details className="command-disclosure danger-zone"><summary>Reopen verified work</summary><form onSubmit={reopenWork}><label className="field">Reason<textarea name="reason" maxLength={1000} required /></label><button className="button secondary" disabled={busy}>Reopen for correction</button></form></details>}
          {can('work.triage') && !['verified', 'cancelled'].includes(item.state) && <details className="command-disclosure danger-zone"><summary>Cancel work item</summary><form onSubmit={cancelWork}><label className="field">Cancellation reason<textarea name="reason" maxLength={1000} required /></label><button className="button danger" disabled={busy}>Cancel work item</button></form></details>}
        </section>
        <section className="panel detail-card">
          <div className="section-heading"><h2><MessageSquare />Conversation</h2><span>{workData.comments.length} messages</span></div>
          <div className="comment-list">{workData.comments.map((comment) => <article className="comment" key={String(comment.id)}><div><strong>{String(comment.author_id).slice(0, 8)}</strong><span className={`visibility ${String(comment.visibility)}`}>{String(comment.visibility)}</span><time>{formatDateTime(String(comment.created_at))}</time></div><p>{String(comment.body)}</p></article>)}{!workData.comments.length && <p className="muted">No comments yet.</p>}</div>
          {can('comment.create_shared') && <form className="comment-form" onSubmit={addComment}><textarea name="body" required placeholder="Add a clear update or question…" /><div><label><span className="sr-only">Comment visibility</span><select name="visibility"><option value="shared">Shared with assigned participants</option>{can('comment.internal') && <option value="internal">Internal only</option>}</select></label><button className="button primary" disabled={busy}>Post comment</button></div></form>}
        </section>
        <section className="panel detail-card">
          <div className="section-heading"><h2><Camera />Evidence</h2><span>Private storage</span></div>
          <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" onChange={uploadEvidence} />
          {can('work.execute_assigned') && <button className="upload-drop interactive" disabled={uploading || workData.attachments.length >= 20} onClick={() => fileInput.current?.click()}><Paperclip /><div><strong>{uploading ? 'Processing evidence…' : navigator.onLine ? 'Upload evidence' : 'Save evidence offline'}</strong><span>JPEG, PNG, HEIC, HEIF, or PDF · 20 MB maximum · 20 files per item</span></div></button>}
          <div className="evidence-list">{workData.attachments.map((attachment) => <div className="evidence-row" key={String(attachment.id)}><Paperclip /><span><strong>{String(attachment.original_name)}</strong><small>{(Number(attachment.byte_size) / 1024 / 1024).toFixed(1)} MB</small></span><StateBadge state={String(attachment.status)} />{attachment.status === 'ready' && navigator.onLine && <button className="text-button" onClick={() => void downloadEvidence(String(attachment.id)).catch((caught) => setError(caught instanceof Error ? caught.message : 'Download failed.'))}>Download</button>}</div>)}{!workData.attachments.length && <p className="muted">No evidence uploaded yet.</p>}</div>
        </section>
      </div>
      <aside className="panel timeline-card">
        <div className="section-heading"><h2>History</h2><span>Append-only</span></div>
        <ol className="timeline">{workData.events.map((event) => <li key={String(event.id)}><span className="timeline-dot" /><div><strong>{humanize(String(event.event_type))}</strong><p>{event.from_state && event.to_state ? `${humanize(String(event.from_state))} → ${humanize(String(event.to_state))}` : 'Recorded event'}</p><time>{formatDateTime(String(event.server_at))}</time></div></li>)}{!workData.events.length && <li><span className="timeline-dot" /><div><strong>Draft created</strong><p>History will appear after the first synchronized command.</p></div></li>}</ol>
      </aside>
    </div>
  </div>
}
