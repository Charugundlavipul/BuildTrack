import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, CalendarPlus, CheckCircle2, ClipboardCheck, Plus, Save, XCircle } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { useHomes, useInspection, useInspections, usePublishedChecklistVersions, type ChecklistQuestionRow } from '../../lib/data'
import { formatDateTime, humanize } from '../../lib/utils'
import { newCommand, runCommand } from '../../lib/commands'
import { useAuth } from '../auth/AuthProvider'
import type { UUID } from '../../types/domain'

const inspectionTypes = ['internal_quality', 'external_quality', 'pre_walkthrough', 'final_walkthrough', 'reinspection'] as const
const results = ['pass', 'fail', 'not_applicable', 'not_checked'] as const
type InspectionResult = (typeof results)[number]
type DraftResponse = { result?: InspectionResult; explanation: string; findingTitle: string }

export function InspectionsPage() {
  const { org } = useParams()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const inspections = useInspections(org)
  const homes = useHomes(org)
  const templates = usePublishedChecklistVersions(org)
  const [scheduling, setScheduling] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!org || !user) return
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setError('')
    try {
      const response = await runCommand<Record<string, unknown>, { id: UUID }>('schedule_inspection', newCommand({
        home_id: String(form.get('home_id')),
        type: String(form.get('type')),
        template_version_id: String(form.get('template_version_id')),
        scheduled_at: new Date(String(form.get('scheduled_at'))).toISOString(),
        lead_inspector_user_id: user.id
      }), { organizationId: org, userId: user.id, aggregateId: crypto.randomUUID() })
      if ('queued' in response) throw new Error('Inspection scheduling requires a live connection.')
      if (!response.ok) throw new Error(response.error.message)
      await queryClient.invalidateQueries({ queryKey: ['inspections', org] })
      setScheduling(false)
      event.currentTarget.reset()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to schedule inspection.')
    } finally { setSaving(false) }
  }

  return <div className="stack-xl">
    <PageHeader eyebrow="QUALITY CONTROL" title="Inspections" description="Capture complete checklist coverage, preserve immutable submissions, and amend through numbered revisions." actions={<button className="button primary" onClick={() => setScheduling((value) => !value)}><Plus />Schedule inspection</button>} />
    {scheduling && <form className="panel form-panel stack-lg" onSubmit={schedule}>
      <div className="section-heading"><div><h2>Schedule inspection</h2><p>The signed-in administrator becomes the lead inspector.</p></div><button type="button" className="icon-button" aria-label="Close scheduling form" onClick={() => setScheduling(false)}><XCircle /></button></div>
      <div className="form-grid two">
        <label className="field">Home<select name="home_id" required defaultValue=""><option value="" disabled>Select home</option>{homes.data?.map((home) => <option value={home.id} key={home.id}>Lot {home.lot_code} · {home.address_line1 ?? 'Address pending'}</option>)}</select></label>
        <label className="field">Inspection type<select name="type" required defaultValue="internal_quality">{inspectionTypes.map((type) => <option value={type} key={type}>{humanize(type)}</option>)}</select></label>
        <label className="field">Published checklist<select name="template_version_id" required defaultValue=""><option value="" disabled>Select checklist</option>{templates.data?.map((template) => <option value={template.id} key={template.id}>{template.template_name} · v{template.number}</option>)}</select></label>
        <label className="field">Scheduled date and time<input name="scheduled_at" type="datetime-local" required /></label>
      </div>
      {error && <div className="notice danger" role="alert">{error}</div>}
      <div className="form-actions"><button type="button" className="button ghost" onClick={() => setScheduling(false)}>Cancel</button><button className="button primary" disabled={saving || homes.isLoading || templates.isLoading}><CalendarPlus />{saving ? 'Scheduling…' : 'Schedule'}</button></div>
    </form>}
    {inspections.isLoading && <LoadingState label="Loading inspections" />}
    {inspections.isError && <ErrorState message={inspections.error.message} retry={() => void inspections.refetch()} />}
    {!inspections.isLoading && !inspections.data?.length && <EmptyState title="No inspections in scope" description="Schedule an inspection or begin an authorized ad-hoc review." action={<button className="button secondary" onClick={() => setScheduling(true)}><CalendarPlus />Schedule inspection</button>} />}
    {!!inspections.data?.length && <section className="panel"><div className="inspection-table-head"><span>Inspection</span><span>Home</span><span>Scheduled</span><span>Status</span><span>Revision</span><span /></div>{inspections.data.map((inspection) => <Link className="inspection-table-row" to={`/org/${org}/inspections/${inspection.id}`} key={inspection.id}><span><span className="icon-tile"><ClipboardCheck /></span><strong>{humanize(inspection.type)}</strong></span><span><strong>Lot {inspection.lot_code ?? '—'}</strong><small>{inspection.address_line1 ?? 'Address pending'}</small></span><span>{formatDateTime(inspection.scheduled_at)}</span><span><span className={`state-badge state-${inspection.status}`}><span />{humanize(inspection.status)}</span></span><span>v{inspection.current_revision}</span><ArrowUpRight /></Link>)}</section>}
  </div>
}

export function InspectionDetailPage() {
  const { org, id } = useParams()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const detail = useInspection(org, id)
  const [drafts, setDrafts] = useState<Record<string, DraftResponse>>({})
  const [busyQuestion, setBusyQuestion] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const counts = useMemo(() => Object.fromEntries(results.map((result) => [result, detail.data?.responses.filter((response) => response.result === result).length ?? 0])), [detail.data]) as Record<InspectionResult, number>

  async function command<TResult>(name: string, payload: Record<string, unknown>) {
    if (!org || !id || !user || !detail.data) throw new Error('Inspection context is unavailable.')
    const response = await runCommand<Record<string, unknown>, TResult>(name, newCommand(payload, detail.data.inspection.version), { organizationId: org, userId: user.id, aggregateId: id })
    if ('queued' in response) throw new Error('Inspection submission requires a live connection.')
    if (!response.ok) throw new Error(response.error.message)
    return response.data
  }

  async function saveResponse(question: ChecklistQuestionRow) {
    if (!org || !id || !user || !detail.data) return
    const draft = drafts[question.id]
    if (!draft?.result) return setError('Choose a response before saving.')
    if (['not_applicable', 'not_checked'].includes(draft.result) && !draft.explanation.trim()) return setError('An explanation is required for this response.')
    setBusyQuestion(question.id)
    setError('')
    try {
      let findingId = detail.data.responses.find((response) => response.question_id === question.id)?.finding_work_item_id ?? null
      if (draft.result === 'fail' && !findingId) {
        if (!draft.findingTitle.trim()) throw new Error('A finding title is required for a failed item.')
        const finding = await runCommand<Record<string, unknown>, { id: UUID }>('create_work_item', newCommand({
          organization_id: org,
          neighborhood_id: detail.data.inspection.neighborhood_id,
          home_id: detail.data.inspection.home_id,
          inspection_id: id,
          origin: 'inspection_finding',
          title: draft.findingTitle.trim(),
          description: draft.explanation.trim() || question.label,
          category_id: question.category_id,
          priority: 'normal',
          safety_flag: false
        }), { organizationId: org, userId: user.id, aggregateId: crypto.randomUUID() })
        if ('queued' in finding) throw new Error('Inspection findings require a live connection.')
        if (!finding.ok) throw new Error(finding.error.message)
        findingId = finding.data.id
      }
      await command('upsert_inspection_response', {
        inspection_id: id,
        question_id: question.id,
        response: draft.result,
        reason: draft.explanation,
        finding_id: draft.result === 'fail' ? findingId : null
      })
      await detail.refetch()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save response.')
    } finally { setBusyQuestion(null) }
  }

  async function submitInspection() {
    if (!id) return
    setSubmitting(true)
    setError('')
    try {
      await command('submit_inspection', { inspection_id: id })
      await Promise.all([detail.refetch(), queryClient.invalidateQueries({ queryKey: ['inspections', org] })])
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to submit inspection.') }
    finally { setSubmitting(false) }
  }

  async function beginAmendment() {
    if (!id) return
    setSubmitting(true)
    setError('')
    try {
      await command('begin_inspection_amendment', { inspection_id: id })
      await detail.refetch()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to begin amendment.') }
    finally { setSubmitting(false) }
  }

  if (detail.isLoading) return <LoadingState label="Loading inspection" />
  if (detail.isError || !detail.data) return <ErrorState message={detail.error?.message ?? 'Inspection was not found or is outside your scope.'} retry={() => void detail.refetch()} />
  const inspection = detail.data.inspection
  const editable = ['draft', 'in_progress', 'amended'].includes(inspection.status)
  const allRequiredAnswered = detail.data.questions.filter((question) => question.requires_response).every((question) => detail.data.responses.some((response) => response.question_id === question.id))

  return <div className="stack-xl"><PageHeader eyebrow={`REVISION ${inspection.current_revision}`} title={humanize(inspection.type)} description={`Scheduled ${formatDateTime(inspection.scheduled_at)}`} actions={<div className="button-row"><span className={`state-badge state-${inspection.status}`}><span />{humanize(inspection.status)}</span>{inspection.status === 'submitted' && <button className="button secondary" disabled={submitting} onClick={() => void beginAmendment()}>Begin amendment</button>}</div>} />
    {error && <div className="notice danger" role="alert"><AlertTriangle />{error}</div>}
    <section className="coverage-summary"><div><strong>{counts.pass}</strong><span>Pass</span></div><div><strong>{counts.fail}</strong><span>Fail</span></div><div><strong>{counts.not_applicable}</strong><span>Not applicable</span></div><div><strong>{counts.not_checked}</strong><span>Not checked</span></div></section>
    <section className="stack-lg" aria-label="Inspection checklist">{detail.data.questions.map((question) => {
      const saved = detail.data.responses.find((response) => response.question_id === question.id)
      const draft = drafts[question.id] ?? { result: saved?.result, explanation: saved?.explanation ?? '', findingTitle: '' }
      return <article className="panel checklist-question" key={question.id}><div className="question-title"><span>{question.ordinal}</span><div><small>{question.section}</small><h2>{question.label}</h2></div>{saved && <CheckCircle2 aria-label="Response saved" />}</div>
        <div className="response-options" role="radiogroup" aria-label={`Response for ${question.label}`}>{results.map((result) => <label key={result} className={draft.result === result ? 'selected' : ''}><input type="radio" name={`response-${question.id}`} value={result} checked={draft.result === result} disabled={!editable} onChange={() => setDrafts((current) => ({ ...current, [question.id]: { ...draft, result } }))} />{humanize(result)}</label>)}</div>
        {draft.result === 'fail' && !saved?.finding_work_item_id && <label className="field">Finding title<input value={draft.findingTitle} disabled={!editable} maxLength={160} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: { ...draft, findingTitle: event.target.value } }))} placeholder="Describe the correction needed" /></label>}
        {draft.result && draft.result !== 'pass' && <label className="field">Explanation<textarea value={draft.explanation} disabled={!editable} maxLength={4000} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: { ...draft, explanation: event.target.value } }))} /></label>}
        {editable && <button className="button secondary" disabled={!draft.result || busyQuestion === question.id} onClick={() => void saveResponse(question)}><Save />{busyQuestion === question.id ? 'Saving…' : 'Save response'}</button>}
      </article>
    })}</section>
    {editable && <div className="form-actions sticky-actions"><span>{detail.data.responses.length} of {detail.data.questions.length} questions saved</span><button className="button primary" disabled={!allRequiredAnswered || submitting} onClick={() => void submitInspection()}><ClipboardCheck />{submitting ? 'Submitting…' : `Submit revision ${inspection.current_revision}`}</button></div>}
  </div>
}
