import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, CalendarPlus, CheckCircle2, ClipboardCheck, Plus, Save, XCircle } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { useHomes, useInspection, useInspections, usePublishedChecklistVersions, type ChecklistQuestionRow, type InspectionResponseRow, type InspectionRow } from '../../lib/data'
import { formatDateTime, humanize } from '../../lib/utils'
import { newCommand, runCommand } from '../../lib/commands'
import { useAuth } from '../auth/AuthProvider'
import { RemoveInspectionButton } from './RemoveInspectionButton'
import { InspectionRepairPlanning } from './InspectionRepairPlanning'
import type { UUID } from '../../types/domain'
import { findOfflineInspection, listHomeOfflineBundles } from '../../lib/offline'

const inspectionTypes = ['internal_quality', 'external_quality', 'pre_walkthrough', 'final_walkthrough', 'reinspection'] as const
const results = ['pass', 'fail', 'not_applicable', 'not_checked'] as const
type InspectionResult = (typeof results)[number]
type DraftResponse = { result?: InspectionResult; explanation: string; findingTitle: string }

export function InspectionsPage() {
  const { org } = useParams()
  const { user, can } = useAuth()
  const queryClient = useQueryClient()
  const inspections = useInspections(org)
  const cachedHomes = useQuery({
    queryKey: ['offline-home-list', user?.id, org],
    enabled: Boolean(user && org),
    queryFn: () => listHomeOfflineBundles(user!.id, org!)
  })
  const inspectionRows = inspections.data ?? (cachedHomes.data ?? []).flatMap((bundle) => bundle.inspections as unknown as InspectionRow[])
  const homes = useHomes(org)
  const templates = usePublishedChecklistVersions(org)
  const [scheduling, setScheduling] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!org || !user) return
    const form = new FormData(event.currentTarget)
    const scheduledAt = String(form.get('scheduled_at'))
    setSaving(true)
    setError('')
    try {
      const response = await runCommand<Record<string, unknown>, { id: UUID }>('schedule_inspection', newCommand({
        home_id: String(form.get('home_id')),
        type: String(form.get('type')),
        template_version_id: String(form.get('template_version_id')),
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
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
    <PageHeader eyebrow="QUALITY CONTROL" title="Inspections" description="Capture complete checklist coverage, preserve immutable submissions, and amend through numbered revisions." actions={can('inspection.manage') ? <button className="button primary" disabled={!navigator.onLine} onClick={() => setScheduling((value) => !value)}><Plus />Schedule inspection</button> : undefined} />
    {scheduling && <form className="panel form-panel stack-lg" onSubmit={schedule}>
      <div className="section-heading"><div><h2>Schedule inspection</h2><p>The signed-in administrator becomes the lead inspector.</p></div><button type="button" className="icon-button" aria-label="Close scheduling form" onClick={() => setScheduling(false)}><XCircle /></button></div>
      <div className="form-grid two">
        <label className="field">Home<select name="home_id" required defaultValue=""><option value="" disabled>Select home</option>{homes.data?.map((home) => <option value={home.id} key={home.id}>Lot {home.lot_code} · {home.address_line1 ?? 'Address pending'}</option>)}</select></label>
        <label className="field">Inspection type<select name="type" required defaultValue="internal_quality">{inspectionTypes.map((type) => <option value={type} key={type}>{humanize(type)}</option>)}</select></label>
        <label className="field">Published checklist<select name="template_version_id" required defaultValue=""><option value="" disabled>Select checklist</option>{templates.data?.map((template) => <option value={template.id} key={template.id}>{template.template_name} · v{template.number}</option>)}</select></label>
        <label className="field">Scheduled date and time (optional)<input name="scheduled_at" type="datetime-local" /><span className="fine-print">Leave blank to start an ad-hoc inspection.</span></label>
      </div>
      {error && <div className="notice danger" role="alert">{error}</div>}
      <div className="form-actions"><button type="button" className="button ghost" onClick={() => setScheduling(false)}>Cancel</button><button className="button primary" disabled={saving || homes.isLoading || templates.isLoading}><CalendarPlus />{saving ? 'Creating…' : 'Create inspection'}</button></div>
    </form>}
    {!inspectionRows.length && (inspections.isLoading || cachedHomes.isLoading) && <LoadingState label="Loading inspections" />}
    {!inspectionRows.length && inspections.isError && <ErrorState message={inspections.error.message} retry={() => void inspections.refetch()} />}
    {!inspections.isLoading && !inspectionRows.length && <EmptyState title="No inspections in scope" description="No scheduled or ad-hoc inspections are currently authorized." action={can('inspection.manage') ? <button className="button secondary" disabled={!navigator.onLine} onClick={() => setScheduling(true)}><CalendarPlus />Schedule inspection</button> : undefined} />}
    {!!inspectionRows.length && <section className="panel"><div className="inspection-table-head"><span>Inspection</span><span>Home</span><span>Scheduled</span><span>Status</span><span>Revision</span><span /></div>{inspectionRows.map((inspection) => <Link className="inspection-table-row" to={`/org/${org}/inspections/${inspection.id}`} key={inspection.id}><span><span className="icon-tile"><ClipboardCheck /></span><strong>{humanize(inspection.type)}</strong></span><span><strong>Lot {inspection.lot_code ?? '—'}</strong><small>{inspection.address_line1 ?? 'Address pending'}</small></span><span>{formatDateTime(inspection.scheduled_at)}</span><span><span className={`state-badge state-${inspection.status}`}><span />{humanize(inspection.status)}</span></span><span>v{inspection.current_revision}</span><ArrowUpRight /></Link>)}</section>}
  </div>
}

export function InspectionDetailPage() {
  const { org, id } = useParams()
  const navigate = useNavigate()
  const { user, can } = useAuth()
  const queryClient = useQueryClient()
  const detail = useInspection(org, id)
  const cachedDetail = useQuery({
    queryKey: ['offline-inspection', user?.id, org, id],
    enabled: Boolean(user && org && id),
    queryFn: () => findOfflineInspection(user!.id, org!, id!)
  })
  const inspectionData = detail.data ?? cachedDetail.data as unknown as NonNullable<typeof detail.data>
  const [drafts, setDrafts] = useState<Record<string, DraftResponse>>({})
  const [selectedSpace, setSelectedSpace] = useState('')
  const [localResponses, setLocalResponses] = useState<Record<string, InspectionResponseRow>>({})
  const [busyQuestion, setBusyQuestion] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const effectiveResponses = useMemo(() => {
    const byQuestion = new Map((inspectionData?.responses ?? []).map((response) => [response.question_id, response]))
    Object.values(localResponses).forEach((response) => byQuestion.set(response.question_id, response))
    return [...byQuestion.values()]
  }, [inspectionData?.responses, localResponses])
  const counts = useMemo(() => Object.fromEntries(results.map((result) => [result, effectiveResponses.filter((response) => response.result === result).length])), [effectiveResponses]) as Record<InspectionResult, number>

  async function command<TResult>(name: string, payload: Record<string, unknown>, dependencies: UUID[] = []) {
    if (!org || !id || !user || !inspectionData) throw new Error('Inspection context is unavailable.')
    const response = await runCommand<Record<string, unknown>, TResult>(name, newCommand(payload, inspectionData.inspection.version), { organizationId: org, userId: user.id, aggregateId: id, dependencies, allowOffline: ['upsert_inspection_response', 'submit_inspection'].includes(name) })
    if ('queued' in response) return response
    if (!response.ok) throw new Error(response.error.message)
    return response.data
  }

  async function saveResponse(question: ChecklistQuestionRow) {
    if (!org || !id || !user || !inspectionData) return
    const draft = drafts[question.id]
    if (!draft?.result) return setError('Choose a response before saving.')
    if (['not_applicable', 'not_checked'].includes(draft.result) && !draft.explanation.trim()) return setError('An explanation is required for this response.')
    setBusyQuestion(question.id)
    setError('')
    try {
      let findingId = effectiveResponses.find((response) => response.question_id === question.id)?.finding_work_item_id ?? null
      let dependencies: UUID[] = []
      if (draft.result === 'fail' && !findingId) {
        if (!draft.findingTitle.trim()) throw new Error('A finding title is required for a failed item.')
        findingId = crypto.randomUUID()
        const findingCommand = newCommand({
          id: findingId,
          organization_id: org,
          neighborhood_id: inspectionData.inspection.neighborhood_id,
          home_id: inspectionData.inspection.home_id,
          inspection_id: id,
          origin: inspectionData.inspection.type === 'external_quality' ? 'external_inspection' : 'internal_inspection',
          title: draft.findingTitle.trim(),
          description: draft.explanation.trim() || question.label,
          category_id: question.category_id,
          priority: 'normal',
          safety_flag: false
        })
        const finding = await runCommand<Record<string, unknown>, { id: UUID }>('create_work_item', findingCommand, { organizationId: org, userId: user.id, aggregateId: findingId, allowOffline: true })
        if ('queued' in finding) dependencies = [finding.operation_id]
        else if (!finding.ok) throw new Error(finding.error.message)
        else findingId = finding.data.id
      }
      const response = await command('upsert_inspection_response', {
        inspection_id: id,
        question_id: question.id,
        response: draft.result,
        reason: draft.explanation,
        finding_id: draft.result === 'fail' ? findingId : null
      }, dependencies)
      if (typeof response === 'object' && response && 'queued' in response) {
        setLocalResponses((current) => ({ ...current, [question.id]: {
          id: String((response as unknown as { operation_id: UUID }).operation_id),
          question_id: question.id,
          result: draft.result!,
          explanation: draft.explanation || null,
          finding_work_item_id: draft.result === 'fail' ? findingId : null
        } }))
      } else await detail.refetch()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save response.')
    } finally { setBusyQuestion(null) }
  }

  async function submitInspection() {
    if (!id) return
    setSubmitting(true)
    setError('')
    try {
      const response = await command('submit_inspection', { inspection_id: id })
      if (typeof response === 'object' && response && 'queued' in response) {
        navigate(`/org/${org}/sync`)
        return
      }
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

  if (!inspectionData && (detail.isLoading || cachedDetail.isLoading)) return <LoadingState label="Loading inspection" />
  if (!inspectionData) return <ErrorState message={detail.error?.message ?? 'This inspection was not downloaded before the device went offline.'} retry={() => void Promise.all([detail.refetch(), cachedDetail.refetch()])} />
  const inspection = inspectionData.inspection
  const editable = ['draft', 'in_progress', 'amended'].includes(inspection.status)
  const allRequiredAnswered = inspectionData.questions.filter((question) => question.requires_response).every((question) => effectiveResponses.some((response) => response.question_id === question.id))

  return <div className="stack-xl"><PageHeader eyebrow={inspection.current_revision > 1 ? `REVISION ${inspection.current_revision}` : 'INSPECTION'} title={humanize(inspection.type)} description={`Scheduled ${formatDateTime(inspection.scheduled_at)}`} actions={<div className="button-row"><span className={`state-badge state-${inspection.status}`}><span />{humanize(inspection.status)}</span>{org && <RemoveInspectionButton org={org} id={inspection.id} version={inspection.version} />}{inspection.status === 'submitted' && can('inspection.manage') && <button className="button secondary" disabled={submitting} onClick={() => void beginAmendment()}>Edit submitted answers</button>}</div>} />
    {!navigator.onLine && cachedDetail.data && <div className="notice warning"><AlertTriangle />Offline checklist loaded. Saved responses and findings remain queued until membership and versions are revalidated.</div>}
    {error && <div className="notice danger" role="alert"><AlertTriangle />{error}</div>}
    <section className="coverage-summary"><div><strong>{counts.pass}</strong><span>Pass</span></div><div><strong>{counts.fail}</strong><span>Fail</span></div><div><strong>{counts.not_applicable}</strong><span>Not applicable</span></div><div><strong>{counts.not_checked}</strong><span>Not checked</span></div></section>
    {org && ['submitted', 'amended'].includes(inspection.status) && <InspectionRepairPlanning org={org} id={inspection.id} neighborhoodId={inspection.neighborhood_id} editable={inspection.status === 'submitted'} />}
    {inspection.status === 'amended' && <div className="notice">You are editing a new version of this inspection. Submit it to finish the update and create repair work from its findings.</div>}
    {['submitted', 'amended'].includes(inspection.status) && can('work.assign') && effectiveResponses.some((response) => response.result === 'fail' && response.finding_work_item_id) && <section className="panel form-panel stack-lg" aria-label="Inspection findings to assign"><div><h2>Inspection findings</h2><p>Open a finding to assign the repair and track its progress.</p></div>{effectiveResponses.filter((response) => response.result === 'fail' && response.finding_work_item_id).map((response) => <div className="section-heading" key={response.id}><div><h2>{inspectionData.questions.find((question) => question.id === response.question_id)?.label ?? 'Inspection finding'}</h2>{response.explanation && <p>{response.explanation}</p>}</div><Link className="button secondary" to={`/org/${org}/work/${response.finding_work_item_id}`}>Open work item</Link></div>)}</section>}
    <section className="panel form-panel"><label className="field">Select space<select aria-label="Select space" value={selectedSpace || inspectionData.questions[0]?.section || ''} onChange={(event) => setSelectedSpace(event.target.value)}>{[...new Set(inspectionData.questions.map((question) => question.section))].map((space) => <option key={space} value={space}>{space}</option>)}</select></label></section>
    <section className="stack-lg" aria-label="Inspection checklist">{inspectionData.questions.filter((question) => question.section === (selectedSpace || inspectionData.questions[0]?.section)).map((question) => {
      const saved = effectiveResponses.find((response) => response.question_id === question.id)
      const draft = drafts[question.id] ?? { result: saved?.result, explanation: saved?.explanation ?? '', findingTitle: '' }
      return <article className="panel checklist-question" key={question.id}><div className="question-title"><span>{question.ordinal}</span><div><small>{question.section}</small><h2>{question.label}</h2></div>{saved && <CheckCircle2 aria-label="Response saved" />}</div>
        <div className="response-options" role="radiogroup" aria-label={`Response for ${question.label}`}>{results.map((result) => <label key={result} className={draft.result === result ? 'selected' : ''}><input type="radio" name={`response-${question.id}`} value={result} checked={draft.result === result} disabled={!editable} onChange={() => setDrafts((current) => ({ ...current, [question.id]: { ...draft, result } }))} />{humanize(result)}</label>)}</div>
        {draft.result === 'fail' && !saved?.finding_work_item_id && <label className="field">Finding title<input value={draft.findingTitle} disabled={!editable} maxLength={160} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: { ...draft, findingTitle: event.target.value } }))} placeholder="Describe the correction needed" /></label>}
        {draft.result && draft.result !== 'pass' && <label className="field">Explanation<textarea value={draft.explanation} disabled={!editable} maxLength={4000} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: { ...draft, explanation: event.target.value } }))} /></label>}
        {editable && <button className="button secondary" disabled={!draft.result || busyQuestion === question.id} onClick={() => void saveResponse(question)}><Save />{busyQuestion === question.id ? 'Saving…' : 'Save response'}</button>}
      </article>
    })}</section>
    {editable && <div className="form-actions sticky-actions"><span>{effectiveResponses.length} of {inspectionData.questions.length} questions saved</span><button className="button primary" disabled={!allRequiredAnswered || submitting} onClick={() => void submitInspection()}><ClipboardCheck />{submitting ? 'Submitting…' : 'Submit inspection'}</button></div>}
  </div>
}
