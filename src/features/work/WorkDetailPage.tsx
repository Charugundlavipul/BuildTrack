import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ChevronLeft, ClipboardCheck, ShieldCheck, UserRound } from 'lucide-react'
import { ErrorState, LoadingState, PageHeader, PriorityBadge, StateBadge } from '../../components/Ui'
import { useParticipants, useRosterCompanies, useWorkItem } from '../../lib/data'
import { formatDateTime, humanize, relativeDate } from '../../lib/utils'
import { newCommand, runCommand } from '../../lib/commands'
import { isAvailableCompletionEvidence, uploadWorkEvidence } from '../../lib/uploads'
import { findOfflineWorkItem, stageWorkEvidence } from '../../lib/offline'
import { useAuth } from '../auth/AuthProvider'
import type { WorkState } from '../../types/domain'
import { requireSupabase } from '../../lib/supabase'
import { functionErrorMessage } from '../../lib/functionError'

import { AssignReinspection, ReinspectionItem } from '../inspections/ObservationPanels'
import { ObservationActivity, type ActivityEntry } from './ObservationActivity'
import type { Observation } from '../inspections/qualityData'
import { WorkCompletionDialog } from './WorkCompletionDialog'
import { qualityClient } from '../inspections/qualityData'

const actionByState: Partial<Record<WorkState, { command: string; label: string }>> = {
  draft: { command: 'submit_work_item', label: 'Submit work item' },
}

export function WorkDetailPage() {
  const { org, id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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
  const [accountableType, setAccountableType] = useState<'internal' | 'company'>('internal')
  const [tab, setTab] = useState(searchParams.get('tab') === 'review' ? 'actions' : 'overview')
  const [completing, setCompleting] = useState(false)
  const [success, setSuccess] = useState('')
  const completion = useQuery({ queryKey: ['work-completion-context', org, id, workData?.item.version], enabled: Boolean(org && id && workData && navigator.onLine), queryFn: async () => {
    const { data, error } = await qualityClient().rpc('work_completion_context', { p_org: org, p_item: id })
    if (error) throw error
    return data as { can_complete: boolean; can_review: boolean; can_request_reinspection: boolean; review_block_reason: string | null; evidence_exception_id: string | null }
  } })

  async function execute(command: string, payload: Record<string, unknown> = {}) {
    if (!org || !id || !user || !workData || busy) return false
    setBusy(true)
    setError('')
    try {
      const result = await runCommand(command, newCommand({ item_id: id, ...payload }, workData.item.version), {
        organizationId: org,
        userId: user.id,
        aggregateId: id,
        allowOffline: ['acknowledge_work', 'start_work', 'block_work', 'submit_correction', 'add_comment'].includes(command)
      })
      if ('queued' in result) { navigate(`/org/${org}/sync`); return true }
      if (!result.ok) { setError(result.error.message); return false }
      await Promise.all(['property-repair-readiness', 'inspection-observations', 'inspection', 'observations', 'home', 'work-item', 'observation-activity', 'work-items', 'dashboard-metrics'].map((key) => queryClient.invalidateQueries({ queryKey: [key, org] })))
      return true
    } catch (caught) {
      setError(await functionErrorMessage(caught, 'The command could not be completed'))
      return false
    } finally { setBusy(false) }
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const element = event.currentTarget
    const form = new FormData(element)
    const body = String(form.get('body')).trim()
    if (!body) return
    if (await execute('add_comment', { body, visibility: form.get('visibility') })) element.reset()
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
      await queryClient.invalidateQueries({ queryKey: ['observation-activity', org, id] })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Evidence upload failed.')
    } finally {
      event.target.value = ''
      setUploading(false)
    }
  }

  async function submitCorrection(note: string) {
    const attachmentIds = workData?.attachments.filter(isAvailableCompletionEvidence).map((attachment) => attachment.id) ?? []
    const saved = await execute('submit_correction', { note, attachment_ids: attachmentIds, evidence_exception_id: completion.data?.evidence_exception_id ?? null })
    if (saved) setSuccess('Completion submitted. Your supervisor can now review the work.')
    return saved
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
      priority: String(form.get('priority')),
      safety_flag: form.get('safety_flag') === 'on'
    })
  }

  async function triageWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await execute('triage_work_item', { priority: String(form.get('priority')), notes: String(form.get('notes')).trim() })
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
  const mayUsePrimaryAction = Boolean(primaryAction && (item.state === 'draft' ? !item.inspection_id && !can('work.assign') && (can('work.create') || can('work.triage')) : can('work.execute_assigned')))
  const mayComplete = completion.data?.can_complete === true || !navigator.onLine && can('work.execute_assigned') && ['assigned', 'acknowledged', 'in_progress', 'rework_required'].includes(item.state)
  const awaitingReview = item.state === 'ready_for_verification'
  const mayReview = awaitingReview && item.reinspection_status !== 'pending' && completion.data?.can_review === true
  const closed = ['verified', 'cancelled'].includes(item.state)
  const step = closed ? 3 : awaitingReview ? 2 : 1

  return <div className={`stack-xl work-item-page work-tab-${tab}`}>
    <button className="text-button" onClick={() => navigate(-1)}><ChevronLeft />Back</button>
    <PageHeader eyebrow={item.lot_code ? `LOT ${item.lot_code} · WORK ITEM` : 'COMMON AREA · WORK ITEM'} title={item.title} description={item.address ?? undefined} actions={<div className="button-row"><PriorityBadge priority={item.priority} /><StateBadge state={item.reinspection_status === 'pending' ? 'pending_reinspection' : item.state} />{mayComplete && <button className="button primary" disabled={busy || uploading} onClick={() => { setError(''); setCompleting(true) }}><ClipboardCheck />Mark as completed</button>}{mayReview && <button className="button primary" onClick={() => setTab('actions')}><ShieldCheck />Review completion</button>}{primaryAction && mayUsePrimaryAction && <button className="button primary" disabled={busy} onClick={() => void execute(primaryAction.command)}>{primaryAction.label}</button>}</div>} />
    {!navigator.onLine && cachedWork.data && <div className="notice warning"><AlertTriangle />Offline copy loaded. Changes and photos are queued on this device until access and record versions are revalidated.</div>}
    {error && <div className="notice danger" role="alert"><AlertTriangle />{error}</div>}
    {success && <div className="notice success" role="status">{success}</div>}
    {completion.error && <ErrorState message={completion.error.message} retry={() => void completion.refetch()} />}
    <ol className="work-progress" aria-label="Work progress">{['Assigned', 'Complete the work', 'Supervisor review', item.state === 'cancelled' ? 'Cancelled' : 'Closed'].map((label, index) => <li key={label} className={index < step ? 'done' : index === step ? 'current' : ''}><span>{String(index + 1).padStart(2, '0')}</span>{label}</li>)}</ol>
    <section className={`work-next-step ${awaitingReview ? 'awaiting-review' : ''}`}><span className="work-next-icon">{closed ? <ShieldCheck /> : awaitingReview ? <ClipboardCheck /> : <UserRound />}</span><div><small>NEXT STEP</small><h2>{closed ? item.state === 'verified' ? 'Work accepted and closed' : 'This work was cancelled' : awaitingReview ? item.reinspection_status === 'pending' ? 'Optional reinspection requested' : 'Completion submitted for review' : item.state === 'blocked' ? 'Resolve the blocker to continue' : item.state === 'rework_required' ? 'Complete the requested corrections' : 'Complete the assigned work'}</h2><p>{awaitingReview ? completion.data?.review_block_reason ?? 'A supervisor reviews the completion and accepts it or returns it for correction. An Inspector visit is optional.' : closed ? 'The history and supporting evidence remain available below.' : 'Follow the instructions, attach completion evidence, then mark the work as completed.'}</p></div>{!closed && <button className="button secondary" onClick={() => setTab(awaitingReview ? 'actions' : 'updates')}>{awaitingReview ? 'Open review actions' : 'Photos & updates'}</button>}</section>
    <nav className="report-tabs work-item-tabs" aria-label="Work item sections">{[['overview', 'Work instructions'], ['updates', 'Updates & evidence'], ['actions', can('work.assign') || can('work.verify') ? 'Manage & review' : 'Blockers & actions']].map(([value, label]) => <button key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{label}</button>)}</nav>
    <WorkCompletionDialog open={completing} title={item.title} busy={busy} uploading={uploading} files={workData.attachments.filter(isAvailableCompletionEvidence).map((file) => file.original_name)} exception={Boolean(completion.data?.evidence_exception_id)} error={error} onClose={() => setCompleting(false)} onUpload={(event) => void uploadEvidence(event)} onConfirm={submitCorrection} />
    {item.state === 'draft' && item.inspection_id && <div className="notice">This issue belongs to an inspection. Submit the inspection before assigning its issues.{(can('inspection.manage') || can('inspection.perform')) && <button className="text-button" onClick={() => navigate(`/org/${org}/inspections/${item.inspection_id}`)}>Open inspection</button>}</div>}
    {item.reinspection_status === 'pending' && item.reinspection_assignee_user_id === user?.id && org && <section className="panel form-panel"><ReinspectionItem org={org} item={item as unknown as Observation} /></section>}
    <div className="observation-detail-layout">
      <div className="stack-lg">
        <section className="panel detail-card">
          <div className="section-heading"><h2>Work details</h2><span>Version {item.version}</span></div>
          <p className="work-description">{item.description}</p>
          <dl className="detail-grid">
            <div><dt><UserRound />Accountable party</dt><dd>{item.assigned_party_name ?? (['draft', 'submitted'].includes(item.state) ? 'Awaiting assignment' : 'Assigned')}</dd></div>
            <div><dt><CalendarClock />Due date</dt><dd>{formatDateTime(item.due_at)}<small>{relativeDate(item.due_at)}</small></dd></div>
            <div><dt>Location</dt><dd>{item.lot_code ? `Lot ${item.lot_code}` : 'Common area'}{item.address ? <small>{item.address}</small> : null}</dd></div>
            <div><dt>Safety</dt><dd>{item.safety_flag ? 'On-site verification required' : 'Standard verification policy'}</dd></div>
          </dl>
          </section>
          <section className="panel detail-card work-action-panel" aria-label="Work management actions"><div className="section-heading"><h2>{can('work.assign') || can('work.verify') ? 'Manage & review' : 'Blockers & actions'}</h2></div>
          {item.state === 'draft' && (can('work.create') || can('work.triage')) && <details className="command-disclosure" open><summary>Edit draft</summary><form className="stack-lg" onSubmit={updateDraft}><div className="form-grid two"><label className="field">Title<input name="title" defaultValue={item.title} maxLength={160} required/></label><label className="field">Priority<select name="priority" defaultValue={item.priority}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label><label className="check-row"><input type="checkbox" name="safety_flag" defaultChecked={item.safety_flag}/><span>Safety-sensitive; require on-site verification</span></label><label className="field full-span">Description<textarea name="description" defaultValue={item.description} rows={4} maxLength={10000} required/></label></div><button className="button secondary" disabled={busy}>Save draft changes</button></form></details>}
          {can('work.triage') && !['verified','cancelled'].includes(item.state) && <details className="command-disclosure"><summary>Priority</summary><form className="form-grid two" onSubmit={triageWork}><label className="field">Priority<select name="priority" defaultValue={item.priority}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label><label className="field full-span">Review notes<input name="notes" maxLength={500}/></label><div className="full-span"><button className="button secondary" disabled={busy}>Save priority</button></div></form></details>}
          {(can('work.execute_assigned') || can('work.assign')) && ['assigned', 'in_progress', 'acknowledged', 'rework_required'].includes(item.state) && <details className="command-disclosure"><summary>Report blocker</summary><form className="stack-lg" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void execute('block_work', { cause: String(form.get('cause')), notes: String(form.get('notes')).trim() }) }}><label className="field">Blocker cause<select name="cause" required defaultValue=""><option value="" disabled>Choose cause</option><option value="access">Site access</option><option value="material">Materials unavailable</option><option value="dependency">Dependent work</option><option value="instructions">Instructions needed</option><option value="other">Other</option></select></label><label className="field">What is preventing progress?<textarea name="notes" maxLength={4000} required /></label><button className="button secondary" disabled={busy}>Save blocker</button></form></details>}
          {(can('work.execute_assigned') || can('work.assign')) && item.state === 'blocked' && <section className="notice warning stack-lg"><h3>Work is blocked</h3>{workData.blockers?.filter((blocker) => !blocker.resolved_at).map((blocker) => <div key={String(blocker.id)}><strong>{humanize(String(blocker.cause))}</strong><p>{String(blocker.notes)}</p><small>Opened {formatDateTime(String(blocker.opened_at))}</small></div>)}<p>Record the resolution before resuming work.</p><form className="stack-lg" onSubmit={(event) => { event.preventDefault(); void execute('unblock_work', { resolution: String(new FormData(event.currentTarget).get('resolution')).trim() }) }}><label className="field">How was the blocker resolved?<textarea name="resolution" maxLength={4000} required /></label><button className="button secondary" disabled={busy}>Resolve blocker and resume</button></form></section>}
          {can('work.assign') && !(item.state === 'draft' && item.inspection_id) && ['draft', 'submitted', 'assigned', 'acknowledged', 'in_progress', 'blocked', 'rework_required'].includes(item.state) && <details className="command-disclosure" open={item.state === 'draft' || undefined}><summary>{item.state === 'draft' || item.state === 'submitted' ? 'Assign work' : 'Reassign work'}</summary><form className="assignment-form" onSubmit={assignWork}><div className="section-heading"><h3>{item.state === 'draft' || item.state === 'submitted' ? 'Assign work' : 'Reassign work'}</h3><span>Due date required</span></div><div className="form-grid two">
            <label className="field">Accountable party type<select value={accountableType} onChange={(event) => setAccountableType(event.target.value as 'internal' | 'company')}><option value="internal">Internal member</option><option value="company">Trade company</option></select></label>
            {accountableType === 'internal' ? <label className="field">Internal member<select name="internal_user_id" required defaultValue=""><option value="" disabled>Select member</option>{participants.data?.map((participant) => <option value={participant.user_id} key={participant.user_id}>{participant.display_name}</option>)}</select></label> : <label className="field">Rostered company<select name="company_id" required defaultValue=""><option value="" disabled>Select company</option>{companies.data?.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label>}
            <label className="field">Due date and time<input name="due_at" type="datetime-local" required /></label>
            <label className="field">Assignment reason<input name="reason" maxLength={500} placeholder="Initial assignment or reason for reassignment" /></label>
          </div><button className="button secondary" disabled={busy}>Assign work</button></form></details>}
          {delegation.data && <form className="assignment-form" onSubmit={delegateCompanyWork}><div className="section-heading"><div><h3>Delegate company work</h3><p>Choose an active technician in your accountable company. The company remains accountable.</p></div></div><div className="form-grid two"><label className="field">Technician<select name="technician_id" defaultValue={delegation.data.current_technician_id ?? ''}><option value="">Company manager / unassigned technician</option>{delegation.data.technicians.map((technician)=><option key={technician.user_id} value={technician.user_id}>{technician.display_name}</option>)}</select></label></div><button className="button secondary" disabled={busy}>Save delegation</button></form>}
          {can('work.assign') && item.due_at && !['verified', 'cancelled'].includes(item.state) && <details className="command-disclosure"><summary>Change due date</summary><form className="form-grid two" onSubmit={updateDueDate}><label className="field">New due date and time<input name="new_due_at" type="datetime-local" required /></label><label className="field">Reason<input name="reason" maxLength={500} required /></label><div className="full-span"><button className="button secondary" disabled={busy}>Update due date</button></div></form></details>}
          {can('work.assign') && ['assigned', 'acknowledged', 'in_progress', 'blocked', 'rework_required'].includes(item.state) && <details className="command-disclosure"><summary>Authorize an evidence exception</summary><form className="form-grid two" onSubmit={issueEvidenceException}><label className="field">Reason<textarea name="reason" maxLength={1000} required /></label><label className="field">Expires at (optional)<input name="expires_at" type="datetime-local" /></label><div className="full-span"><button className="button secondary" disabled={busy}>Authorize exception</button></div></form></details>}
          {awaitingReview && completion.data?.review_block_reason && <div className="notice">{completion.data.review_block_reason}</div>}
          {mayReview && <section className="panel form-panel stack-lg"><h2><ShieldCheck />Supervisor completion review</h2><p>Accept and close satisfactory work, or return it with clear correction instructions.</p>{workData.corrections?.[0] && <div className="notice stack-lg"><strong>Completion attempt {String(workData.corrections[0].attempt_number)}</strong><p>{String(workData.corrections[0].completion_note)}</p><small>Submitted {formatDateTime(String(workData.corrections[0].submitted_at))}</small></div>}<button className="text-button" onClick={() => setTab('updates')}>View completion evidence & updates →</button><form className="stack-lg" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const decision = String(form.get('decision')); void execute('verify_correction', { decision, method: String(form.get('method')), notes: String(form.get('notes')).trim() }).then((saved) => { if (saved) setSuccess(decision === 'accepted' ? 'Completion accepted. This work item is closed.' : 'Work returned for correction. The assignee can submit a new completion.') }) }}><div className="form-grid two"><label className="field">Decision<select name="decision" required defaultValue=""><option value="" disabled>Choose decision</option><option value="accepted">Accept & close work</option><option value="rejected">Return for correction</option></select></label><label className="field">Review method<select name="method" required defaultValue=""><option value="" disabled>Choose actual method</option><option value="on_site">On-site supervisor check</option>{!item.safety_flag && <option value="remote">Review completion evidence</option>}</select>{item.safety_flag && <small>Safety-sensitive work requires an on-site check.</small>}</label></div><label className="field">Review notes<textarea name="notes" required maxLength={4000} placeholder="Record your findings and any corrections still required." /></label><label className="check-row"><input type="checkbox" required /><span>I reviewed the completed work using the selected method.</span></label><button className="button primary" disabled={busy}>Save supervisor decision</button></form></section>}
          {awaitingReview && item.reinspection_status !== 'pending' && completion.data?.can_request_reinspection && org && <AssignReinspection org={org} item={item} />}
          {can('work.verify') && item.state === 'verified' && <details className="command-disclosure danger-zone"><summary>Reopen verified work</summary><form onSubmit={reopenWork}><label className="field">Reason<textarea name="reason" maxLength={1000} required /></label><button className="button secondary" disabled={busy}>Reopen for correction</button></form></details>}
          {can('work.triage') && !['verified', 'cancelled'].includes(item.state) && <details className="command-disclosure danger-zone"><summary>Cancel work item</summary><form onSubmit={cancelWork}><label className="field">Cancellation reason<textarea name="reason" maxLength={1000} required /></label><button className="button danger" disabled={busy}>Cancel work item</button></form></details>}
        </section>
        <ObservationActivity org={org!} itemId={id!} busy={busy} uploading={uploading} attachmentCount={workData.attachments.length} onComment={addComment} onUpload={uploadEvidence} offlineEntries={[
          ...workData.events.filter((event) => event.event_type !== 'comment.added').map((event) => ({ key: `event:${event.id}`, at: String(event.server_at), kind: 'event', actor_id: event.actor_id, actor_name: String((event.details as Record<string, unknown> | null)?.actor_name ?? participants.data?.find((p) => p.user_id === event.actor_id)?.display_name ?? 'Team member'), event_type: event.event_type, from_state: event.from_state, to_state: event.to_state, details: event.details ?? {}, visibility: 'shared' })),
          ...workData.comments.map((comment) => ({ key: `comment:${comment.id}`, at: String(comment.created_at), kind: 'comment', actor_id: comment.author_id, actor_name: participants.data?.find((p) => p.user_id === comment.author_id)?.display_name ?? 'Team member', event_type: 'comment.added', details: {}, body: comment.body, visibility: comment.visibility })),
          ...workData.attachments.map((file) => ({ key: `attachment:${file.id}`, at: String(file.created_at), kind: 'attachment', actor_id: null, actor_name: 'Evidence uploader', event_type: 'evidence.added', details: {}, visibility: file.visibility ?? 'shared', attachment_id: file.id, file_name: file.original_name, file_status: file.status }))
        ] as ActivityEntry[]} />
      </div>

    </div>
  </div>
}
