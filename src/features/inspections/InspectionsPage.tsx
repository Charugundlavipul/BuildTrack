import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, CalendarPlus, Check, CheckCircle2, ClipboardCheck, Plus, Save, XCircle } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { PersonRoleSelect } from '../../components/PersonRoleSelect'
import { useHomes, useInspection, useInspectionQueue, type InspectionResponseRow, type InspectionRow } from '../../lib/data'
import { formatDateTime, humanize } from '../../lib/utils'
import { newCommand, runCommand } from '../../lib/commands'
import { functionErrorMessage } from '../../lib/functionError'
import { useAuth } from '../auth/AuthProvider'
import { RemoveInspectionButton } from './RemoveInspectionButton'
import type { UUID } from '../../types/domain'
import { listFieldContexts, saveFieldContext, pendingInspectionDependencies, findOfflineInspection, listHomeOfflineBundles, synchronizeQueue } from '../../lib/offline'
import { requireSupabase } from '../../lib/supabase'

import { qualityClient, usePlans }  from './qualityData'
import { ObservationCapture, PropertyRepairReadiness } from './InspectionObservations'
import { InspectionManagement } from './InspectionManagement'
import { InspectionNavigation } from './InspectionNavigation'
import { ReinspectionInbox } from './ObservationPanels'
import { InspectionItemMedia } from './InspectionItemMedia'
import { InspectionReport } from './InspectionReport'

const inspectionTypes = ['internal_quality', 'external_quality', 'pre_walkthrough', 'final_walkthrough', 'reinspection'] as const
const results = ['pass', 'fail', 'not_applicable', 'not_checked'] as const
type InspectionResult = (typeof results)[number]
type DraftResponse = { result?: InspectionResult; explanation: string; priority?: 'low' | 'normal' | 'high' | 'critical'; safety?: boolean }

export function InspectionsPage({ homeContext }: { homeContext?: string }) {
  const { org } = useParams()
  const [params] = useSearchParams()
  const { user, can } = useAuth()
  const queryClient = useQueryClient()
  const [queueNow, setQueueNow] = useState(() => Date.now())
  useEffect(() => { const interval = window.setInterval(() => setQueueNow(Date.now()), 60000); return () => window.clearInterval(interval) }, [])
  const [statusFilter, setStatusFilter] = useState(params.get('view') === 'reinspections' ? 'reinspections' : '')
  const [assignmentType, setAssignmentType] = useState('individual')
  const [homeFilter, setHomeFilter] = useState(homeContext ?? '')
  const [page, setPage] = useState(0)
  const inspections = useInspectionQueue(org, statusFilter, homeFilter, page)
  const cachedHomes = useQuery({
    queryKey: ['offline-home-list', user?.id, org],
    enabled: Boolean(user && org),
    queryFn: () => listHomeOfflineBundles(user!.id, org!)
  })
  const cachedFields = useQuery({ queryKey: ['offline-field-list', user?.id, org], enabled: Boolean(user && org), queryFn: () => listFieldContexts(user!.id, org!) })
  const cachedRows = [...(cachedHomes.data ?? []).flatMap((bundle) => bundle.inspections as unknown as InspectionRow[]), ...(cachedFields.data ?? []).flatMap((field) => field.inspectionDetail ? [field.inspectionDetail.inspection as unknown as InspectionRow] : [])]
  const cachedInspections = [...new Map(cachedRows.map((row) => [row.id, row])).values()].filter((row) => {
    const open = ['draft', 'in_progress', 'amended'].includes(row.status)
    const statusMatches = !statusFilter || statusFilter === 'assigned' && open || statusFilter === 'due' && open && Boolean(row.scheduled_at && Date.parse(row.scheduled_at) <= queueNow) || statusFilter === 'completed' && Boolean(row.reviewed_at) || statusFilter === 'escalated' && Boolean(row.escalated_at && !row.escalation_resolved_at) || statusFilter === 'submitted' && row.status === 'submitted' && !row.reviewed_at || !['assigned', 'due', 'completed', 'escalated', 'submitted'].includes(statusFilter) && row.status === statusFilter
    return statusMatches && (!homeFilter || row.home_id === homeFilter)
  })
  const inspectionRows = inspections.data?.rows ?? cachedInspections.slice(page * 25, page * 25 + 25)
  const total = inspections.data?.total ?? cachedInspections.length
  const homes = useHomes(org)
  const plans = usePlans(org)
  const [scheduling, setScheduling] = useState(params.get('new') === '1')
  const [scheduledHome, setScheduledHome] = useState(homeContext ?? params.get('home') ?? '')
  const [additionalItems, setAdditionalItems] = useState<Array<{ section: string; label: string }>>([])
  const scheduledProperty = useQuery({ queryKey: ['scheduled-property-plan', org, scheduledHome], enabled: Boolean(org && scheduledHome && scheduling), queryFn: async () => {
    const { data, error } = await qualityClient().from('homes').select('master_plan_id').eq('organization_id', org!).eq('id', scheduledHome).single()
    if (error) throw error
    return data as { master_plan_id: string | null }
  } })
  const selectedPlan = plans.data?.find((plan) => plan.id === scheduledProperty.data?.master_plan_id)
  const leads = useQuery({ queryKey: ['inspection-leads', org, scheduledHome], enabled: Boolean(org && scheduledHome && scheduling), queryFn: async () => {
    const { data, error } = await requireSupabase().rpc('inspection_lead_options', { p_organization_id: org!, p_home_id: scheduledHome })
    if (error) throw error
    return data
  } })
  const companyOptions = useQuery({ queryKey: ['inspection-companies', org, scheduledHome], enabled: Boolean(org && scheduledHome && scheduling), queryFn: async () => {
    const { data, error } = await qualityClient().rpc('inspection_company_options', { p_organization_id: org!, p_home_id: scheduledHome })
    if (error) throw error
    return data as Array<{ id: string; name: string }>
  } })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!org || !user) return
    const element = event.currentTarget
    const form = new FormData(element)
    const scheduledAt = String(form.get('scheduled_at'))
    if (assignmentType === 'individual' && !form.get('lead_inspector_user_id')) {
      setError('Choose a lead inspector.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const response = await runCommand<Record<string, unknown>, { id: UUID }>(assignmentType === 'company' ? 'schedule_company_inspection' : 'schedule_inspection', newCommand({
        home_id: String(form.get('home_id')),
        type: String(form.get('type')),
        plan_checklist: true,
        plan_version: selectedPlan?.version,
        additional_items: additionalItems,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        lead_inspector_user_id: assignmentType === 'individual' ? String(form.get('lead_inspector_user_id')) : null,
        company_id: assignmentType === 'company' ? String(form.get('company_id')) : null
      }), { organizationId: org, userId: user.id, aggregateId: crypto.randomUUID() })
      if ('queued' in response) throw new Error('Inspection scheduling requires a live connection.')
      if (!response.ok) throw new Error(response.error.message)
      await queryClient.invalidateQueries({ queryKey: ['inspections', org] })
      setScheduling(false)
      element.reset()
      setAdditionalItems([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to schedule inspection.')
    } finally { setSaving(false) }
  }

  return <div className="stack-xl">
    {homeContext ? <div className="section-heading"><h2>Inspections</h2>{can('inspection.manage') && <button className="button secondary" disabled={!navigator.onLine} onClick={() => setScheduling((value) => !value)}><Plus />Schedule inspection</button>}</div> : <><PageHeader eyebrow="QUALITY CONTROL" title="Inspections" description="Schedule inspections, complete checklists, and track findings by home." actions={can('inspection.manage') ? <button className="button primary" disabled={!navigator.onLine} onClick={() => setScheduling((value) => !value)}><Plus />Schedule inspection</button> : undefined} /><InspectionNavigation /></>}
    {org && <PropertyRepairReadiness org={org} homeId={homeContext} />}
    {scheduling && <form className="panel form-panel stack-lg" onSubmit={schedule}>
      <div className="section-heading"><div><h2>Schedule inspection</h2><p>Choose a home and assign an individual Inspector or an inspection company.</p></div><button type="button" className="icon-button" aria-label="Close scheduling form" onClick={() => setScheduling(false)}><XCircle /></button></div>
      <div className="form-grid two">
        {homeContext ? <input type="hidden" name="home_id" value={homeContext} /> : <label className="field">Home<select name="home_id" required value={scheduledHome} onChange={(event) => { setScheduledHome(event.target.value); setAdditionalItems([]) }}><option value="" disabled>Select home</option>{homes.data?.map((home) => <option value={home.id} key={home.id}>Lot {home.lot_code} · {home.address_line1 ?? 'Address pending'}</option>)}</select></label>}
        <label className="field">Assign inspection to<select value={assignmentType} onChange={(event) => setAssignmentType(event.target.value)}><option value="individual">Individual Inspector</option><option value="company">Inspection company</option></select></label>
        {assignmentType === 'individual' ? <div className="field"><span>Lead inspector</span><PersonRoleSelect key={scheduledHome} name="lead_inspector_user_id" required disabled={!scheduledHome || leads.isLoading || leads.isError || !leads.data?.length} placeholder={!scheduledHome ? 'Choose a home first' : leads.isLoading ? 'Loading eligible inspectors…' : 'Choose lead inspector'} options={(leads.data ?? []).map((lead) => ({ value: lead.user_id, name: lead.display_name, role: lead.role_label }))} /></div> : <label className="field">Inspection company<select name="company_id" aria-label="Inspection company" aria-describedby="inspection-company-help" required defaultValue="" key={scheduledHome} disabled={!scheduledHome || companyOptions.isLoading}><option value="">Choose approved inspection company</option>{companyOptions.data?.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select><small id="inspection-company-help">The company manager will select an Inspector.</small></label>}
        <label className="field">Inspection type<select name="type" required defaultValue="internal_quality">{inspectionTypes.map((type) => <option value={type} key={type}>{humanize(type)}</option>)}</select></label>

        <label className="field">Scheduled date and time (optional)<input name="scheduled_at" type="datetime-local" /><span className="fine-print">Leave blank to start an ad-hoc inspection.</span></label>
      </div>
      {scheduledHome && <section className="stack-lg" aria-label="Property inspection checklist"><h3>{selectedPlan ? `${selectedPlan.name} checklist` : 'Plan checklist'}</h3>{scheduledProperty.error && <ErrorState message={scheduledProperty.error.message} />}{plans.error && <ErrorState message={plans.error.message} />}{scheduledProperty.isLoading || plans.isLoading ? <LoadingState label="Loading plan checklist" /> : !selectedPlan ? <p className="notice warning">Apply a floor plan to this property before scheduling an inspection.</p> : <><p>Each space uses the editable checklist items saved with its floor plan. Property additions below apply only to this inspection.</p>{selectedPlan.spaces.map((space, index) => <div key={index}><strong>{space.name}</strong><small className="muted"> · {space.checklist_items?.filter((item) => item.trim()).length ?? 0} checklist items</small></div>)}{additionalItems.map((item, index) => <div className="form-grid two" key={index}><label className="field">Space for additional item {index + 1}<select required value={item.section} onChange={(event) => setAdditionalItems((all) => all.map((row, i) => i === index ? { ...row, section: event.target.value } : row))}><option value="">Choose space</option>{selectedPlan.spaces.map((space) => <option key={space.name} value={space.name}>{space.name}</option>)}</select></label><label className="field">Property-only item {index + 1}<input required minLength={2} maxLength={1000} value={item.label} onChange={(event) => setAdditionalItems((all) => all.map((row, i) => i === index ? { ...row, label: event.target.value } : row))} /></label><button type="button" className="button ghost" onClick={() => setAdditionalItems((all) => all.filter((_, i) => i !== index))}>Remove additional item {index + 1}</button></div>)}<div><button type="button" className="button secondary" disabled={additionalItems.length >= 100} onClick={() => setAdditionalItems((all) => [...all, { section: '', label: '' }])}><Plus />Add property-only item</button></div></>}</section>}
      {error && <div className="notice danger" role="alert">{error}</div>}{companyOptions.error && <ErrorState message={companyOptions.error.message} />}{assignmentType === 'company' && scheduledHome && companyOptions.isSuccess && !companyOptions.data.length && <p className="notice warning">No approved inspection companies. Add the Third-party inspection category and neighborhood coverage on the vendor record.</p>}
      {assignmentType === 'individual' && leads.error && <ErrorState message={leads.error.message} retry={() => void leads.refetch()} />}
      {assignmentType === 'individual' && scheduledHome && leads.isSuccess && !leads.data.length && <div className="notice warning">No eligible lead inspectors are available for this home. Review member scopes or inspector engagements.</div>}
      <div className="form-actions"><button type="button" className="button ghost" onClick={() => setScheduling(false)}>Cancel</button><button className="button primary" disabled={saving || homes.isLoading || plans.isLoading || scheduledProperty.isLoading || !selectedPlan || (assignmentType === 'individual' ? !leads.data?.length : !companyOptions.data?.length)}><CalendarPlus />{saving ? 'Creating…' : 'Create inspection'}</button></div>
    </form>}
    {!homeContext && <div className="segmented inspection-inbox-tabs" role="group" aria-label="Inspection inbox">{[['', 'All'], ['assigned', 'Assigned'], ['due', 'Due'], ['submitted', 'Submitted'], ['reinspections', 'Re-inspections'], ['completed', 'Completed'], ['escalated', 'Area manager review']].filter(([value]) => value !== 'escalated' || can('inspection.manage')).filter(([value]) => value !== 'reinspections' || can('inspection.perform')).map(([value, label]) => <button key={value} className={statusFilter === value ? 'active' : ''} aria-pressed={statusFilter === value} onClick={() => { setStatusFilter(value); setPage(0) }}>{label}</button>)}</div>}
    {statusFilter === 'reinspections' && org ? <ReinspectionInbox org={org} /> : <>
    <section className="panel form-panel form-grid two" aria-label="Inspection filters"><label className="field">Filter by status<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(0) }}><option value="">All statuses</option>{['assigned', 'due', 'draft', 'in_progress', 'submitted', 'amended', 'completed', 'escalated'].map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>{!homeContext && <label className="field">Filter by home<select value={homeFilter} onChange={(event) => { setHomeFilter(event.target.value); setPage(0) }}><option value="">All authorized homes</option>{homes.data?.map((row) => <option key={row.id} value={row.id}>Lot {row.lot_code} · {row.address_line1 ?? 'Address pending'}</option>)}</select></label>}</section>
    {!inspectionRows.length && (inspections.isLoading || cachedHomes.isLoading) && <LoadingState label="Loading inspections" />}
    {!inspectionRows.length && inspections.isError && <ErrorState message={inspections.error.message} retry={() => void inspections.refetch()} />}
    {!inspections.isLoading && !cachedHomes.isLoading && !inspections.isError && !inspectionRows.length && <EmptyState title="No inspections in scope" description="No scheduled or ad-hoc inspections are currently authorized." action={can('inspection.manage') ? <button className="button secondary" disabled={!navigator.onLine} onClick={() => setScheduling(true)}><CalendarPlus />Schedule inspection</button> : undefined} />}
    {!!inspectionRows.length && <section className="panel"><div className="inspection-table-head"><span>Inspection</span><span>Home</span><span>Scheduled</span><span>Status</span><span>Revision</span><span /></div>{inspectionRows.map((inspection) => <Link className="inspection-table-row" to={`/org/${org}/inspections/${inspection.id}`} key={inspection.id}><span><span className="icon-tile"><ClipboardCheck /></span><strong>{humanize(inspection.type)}{inspection.company_id && !inspection.lead_inspector_user_id && <small>Company to assign Inspector</small>}</strong></span><span><strong>Lot {inspection.lot_code ?? '—'}</strong><small>{inspection.address_line1 ?? 'Address pending'}</small></span><span className="inspection-schedule">{formatDateTime(inspection.scheduled_at)}</span><span><span className={`state-badge state-${inspection.status}`}><span />{humanize(inspection.status)}</span></span><span className="inspection-revision">Revision {inspection.current_revision}</span><ArrowUpRight /></Link>)}</section>}
    {total > 0 && <footer className="property-pagination"><span>{page * 25 + 1}–{Math.min(page * 25 + 25, total)} of {total} inspections</span><div className="button-row"><button className="button ghost" disabled={!page || inspections.isFetching} onClick={() => setPage(page - 1)}>Previous</button><button className="button ghost" disabled={(page + 1) * 25 >= total || inspections.isFetching} onClick={() => setPage(page + 1)}>Next</button></div></footer>}
    </>}
  </div>
}

export function InspectionDetailPage() {
  const { org, id } = useParams()
  const navigate = useNavigate()
  const { user, can } = useAuth()
  const queryClient = useQueryClient()
  const detail = useInspection(org, id)
  const refreshInspection = detail.refetch
  const cachedDetail = useQuery({
    queryKey: ['offline-inspection', user?.id, org, id], networkMode: 'always',
    enabled: Boolean(user && org && id),
    queryFn: () => findOfflineInspection(user!.id, org!, id!)
  })
  const inspectionData = detail.data ?? cachedDetail.data as unknown as NonNullable<typeof detail.data>
  useEffect(() => {
    if (!navigator.onLine || !user || !org) return
    void synchronizeQueue(user.id, org).then(() => {
      void refreshInspection()
    }).catch(() => undefined)
  }, [org, user, refreshInspection])
  useEffect(() => {
    if (!navigator.onLine || !user || !org || !id || !detail.data) return
    let cancelled = false
    const snapshot = detail.data
    void (async () => {
      const client = requireSupabase()
      const [home, locations, observations] = await Promise.all([
        client.from('homes').select('*').eq('organization_id', org).eq('id', snapshot.inspection.home_id).single(),
        client.from('home_locations').select('*').eq('organization_id', org).eq('home_id', snapshot.inspection.home_id),
        client.from('work_items').select('*').eq('organization_id', org).eq('inspection_id', id)
      ])
      if (home.error || locations.error || observations.error || cancelled) return
      await saveFieldContext(user.id, org, `inspection:${id}`, { home: home.data, locations: locations.data ?? [], observations: observations.data ?? [], inspectionDetail: snapshot as unknown as import('../../lib/offline').CachedInspectionDetail })
    })().catch(() => undefined)
    return () => { cancelled = true }
  }, [detail.data, id, org, user])
  const [observationForms, setObservationForms] = useState<Record<string, boolean>>({})
  const [selectedSpace, setSelectedSpace] = useState('')
  const [uploadingItems, setUploadingItems] = useState<Record<string, boolean>>({})
  const mediaUploading = Object.values(uploadingItems).some(Boolean)
  const unsavedObservationForms = Object.values(observationForms).filter(Boolean).length
  const [drafts, setDrafts] = useState<Record<string, DraftResponse>>({})
  const [localResponses, setLocalResponses] = useState<Record<string, InspectionResponseRow>>({})
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftMessage, setDraftMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const effectiveResponses = useMemo(() => {
    const byQuestion = new Map((inspectionData?.responses ?? []).map((response) => [response.question_id, response]))
    Object.values(localResponses).forEach((response) => byQuestion.set(response.question_id, response))
    return [...byQuestion.values()]
  }, [inspectionData?.responses, localResponses])
  const counts = useMemo(() => Object.fromEntries(results.map((result) => [result, effectiveResponses.filter((response) => response.result === result).length])), [effectiveResponses]) as Record<InspectionResult, number>
  const dirtyQuestions = useMemo(() => {
    if (!inspectionData) return []
    return Object.keys(drafts).filter((questionId) => {
      const saved = effectiveResponses.find((response) => response.question_id === questionId)
      const questionObs = (inspectionData.observations ?? []).find((o) => o.question_id === questionId)
      const draft = drafts[questionId]
      if (!draft) return false
      const resultChanged = draft.result !== saved?.result
      const explanationChanged = draft.explanation !== (saved?.explanation ?? questionObs?.description ?? '')
      const priorityChanged = draft.result === 'fail' && (draft.priority ?? 'normal') !== (questionObs?.priority ?? 'normal')
      const safetyChanged = draft.result === 'fail' && Boolean(draft.safety) !== Boolean(questionObs?.safety_flag)
      return resultChanged || explanationChanged || priorityChanged || safetyChanged
    })
  }, [drafts, effectiveResponses, inspectionData])
  useEffect(() => {
    if (!dirtyQuestions.length && !unsavedObservationForms && !mediaUploading) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const followLink = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.href === window.location.href || anchor.target === '_blank') return
      if (!window.confirm(mediaUploading ? 'Evidence is still uploading. Leave this inspection?' : 'Leave this inspection? Unsaved answers will be lost.')) { event.preventDefault(); event.stopPropagation() }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', followLink, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', followLink, true) }
  }, [dirtyQuestions.length, unsavedObservationForms, mediaUploading])

  async function command<TResult>(name: string, payload: Record<string, unknown>, dependencies: UUID[] = [], expectedVersion = inspectionData?.inspection.version) {
    if (!org || !id || !user || !inspectionData) throw new Error('Inspection context is unavailable.')
    const response = await runCommand<Record<string, unknown>, TResult>(name, newCommand(payload, expectedVersion), { organizationId: org, userId: user.id, aggregateId: id, dependencies, allowOffline: ['save_inspection_responses', 'upsert_inspection_response', 'submit_inspection'].includes(name) })
    if ('queued' in response) return response
    if (!response.ok) throw new Error(response.error.message)
    return response.data
  }

  async function saveAllDrafts(): Promise<boolean> {
    if (!org || !id || !user || !inspectionData || savingDraft || submitting) return false
    const questionsToSave = dirtyQuestions.filter((qId) => Boolean(drafts[qId]?.result))
    if (!questionsToSave.length) return true
    setSavingDraft(true)
    setError('')
    setDraftMessage('')
    try {
      const batchResponses: Array<{
        question_id: UUID
        response: InspectionResult
        reason: string | null
        finding_id: UUID | null
        title: string
        description: string
        priority: 'low' | 'normal' | 'high' | 'critical'
        safety_flag: boolean
        observation_id: UUID
      }> = []
      for (const questionId of questionsToSave) {
        const question = inspectionData.questions.find((q) => q.id === questionId)
        const draft = drafts[questionId]
        if (!question || !draft?.result) continue

        if (['not_applicable', 'not_checked'].includes(draft.result) && !draft.explanation.trim()) {
          throw new Error(`An explanation is required for "${question.label}".`)
        }
        if (draft.result === 'fail' && !draft.explanation.trim()) {
          throw new Error(`Please describe what needs fixing for "${question.label}".`)
        }

        batchResponses.push({
          question_id: question.id,
          response: draft.result,
          reason: draft.explanation.trim() || null,
          finding_id: null,
          title: question.label.trim().slice(0, 160),
          description: draft.explanation.trim() || question.label.trim(),
          priority: draft.priority ?? 'normal',
          safety_flag: Boolean(draft.safety),
          observation_id: crypto.randomUUID()
        })
      }

      if (!batchResponses.length) return true

      const deps = await pendingInspectionDependencies(user.id, org, id)
      const response = await command('save_inspection_responses', {
        inspection_id: id,
        responses: batchResponses
      }, deps)

      if (typeof response === 'object' && response && 'queued' in response) {
        const opId = String((response as unknown as { operation_id: UUID }).operation_id)
        setLocalResponses((current) => {
          const next = { ...current }
          for (const item of batchResponses) {
            next[item.question_id] = {
              id: `${opId}-${item.question_id}`,
              question_id: item.question_id,
              result: item.response,
              explanation: item.reason,
              finding_work_item_id: null
            }
          }
          return next
        })
      }

      if (user && org && navigator.onLine) {
        await synchronizeQueue(user.id, org).catch(() => undefined)
      }

      await Promise.all([
        detail.refetch(),
        queryClient.invalidateQueries({ queryKey: ['inspection', org, id] }),
        queryClient.invalidateQueries({ queryKey: ['inspection-observations', org, id] })
      ])
      setDrafts({})
      setDraftMessage('Draft saved. You can continue or leave at any time.')
      return true
    } catch (caught) {
      const message = await functionErrorMessage(caught, 'Unable to save draft.')
      setError(message)
      return false
    } finally { setSavingDraft(false) }
  }

  async function submitInspection() {
    if (!id || savingDraft || submitting || mediaUploading) return
    setError('')
    setDraftMessage('')
    if (dirtyQuestions.length > 0) {
      const ok = await saveAllDrafts()
      if (!ok) return
    }
    setSubmitting(true)
    try {
      if (user && org && navigator.onLine) {
        await synchronizeQueue(user.id, org)
      }
      // Saving drafts and synchronizing the queue can each advance the version.
      // Read it after those operations rather than using this render's closure.
      const latest = navigator.onLine ? await detail.refetch() : null
      if (latest?.error) throw latest.error
      const response = await command('submit_inspection', { inspection_id: id }, user && org ? await pendingInspectionDependencies(user.id, org, id) : [], latest?.data?.inspection.version ?? inspectionData?.inspection.version)
      if (typeof response === 'object' && response && 'queued' in response) {
        navigate(`/org/${org}/sync`)
        return
      }
      await Promise.all([detail.refetch(), queryClient.invalidateQueries({ queryKey: ['inspections', org] })])
    } catch (caught) {
      const message = await functionErrorMessage(caught, 'Unable to submit inspection.')
      setError(message)
    } finally { setSubmitting(false) }
  }

  async function beginAmendment() {
    if (!id) return
    setSubmitting(true)
    setError('')
    try {
      await command('begin_inspection_amendment', { inspection_id: id })
      await detail.refetch()
    } catch (caught) {
      const message = await functionErrorMessage(caught, 'Unable to begin amendment.')
      setError(message)
    } finally { setSubmitting(false) }
  }

  if (!inspectionData && (detail.isLoading || cachedDetail.isLoading)) return <LoadingState label="Loading inspection" />
  if (!inspectionData) return <ErrorState message={detail.error?.message ?? 'This inspection was not downloaded before the device went offline.'} retry={() => void Promise.all([detail.refetch(), cachedDetail.refetch()])} />
  const inspection = inspectionData.inspection
  const editable = can('inspection.perform') && (inspection.lead_inspector_user_id === user?.id || can('inspection.manage')) && ['draft', 'in_progress', 'amended'].includes(inspection.status)
  const allRequiredAnswered = inspectionData.questions.filter((question) => question.requires_response).every((question) => effectiveResponses.some((response) => response.question_id === question.id && response.result) || Boolean(drafts[question.id]?.result))
  const spaces = [...new Set(inspectionData.questions.map((question) => question.section))]
  const currentSpace = spaces.includes(selectedSpace) ? selectedSpace : spaces[0] ?? ''
  const reportMode = inspection.status === 'submitted'

  return <div className="stack-xl"><Link className="text-button" to={`/org/${org}/inspections`}>← Inspections</Link><PageHeader eyebrow={inspection.current_revision > 1 ? `REVISION ${inspection.current_revision}` : 'INSPECTION'} title={humanize(inspection.type)} description={`${inspection.lot_code ? `Lot ${inspection.lot_code} · ` : ''}${inspection.address_line1 ? `${inspection.address_line1} · ` : ''}${inspection.scheduled_at ? `Scheduled ${formatDateTime(inspection.scheduled_at)}` : 'No scheduled date'}`} actions={<div className="button-row"><span className={`state-badge state-${inspection.status}`}><span />{humanize(inspection.status)}</span>{editable && <button className="button secondary" disabled={!dirtyQuestions.length || savingDraft || submitting} onClick={() => void saveAllDrafts()}><Save />{savingDraft ? 'Saving draft…' : 'Save draft'}</button>}{org && <RemoveInspectionButton org={org} id={inspection.id} version={inspection.version} />}{inspection.status === 'submitted' && can('inspection.manage') && <button className="button secondary" disabled={submitting} onClick={() => void beginAmendment()}>Revise submitted report</button>}</div>} />
    <Link className="text-button" to={`/org/${org}/homes/${inspection.home_id}`}>{inspection.lot_code ? `Open Lot ${inspection.lot_code}` : 'Open home'}</Link>
    {!navigator.onLine && cachedDetail.data && <div className="notice warning"><AlertTriangle />Offline checklist loaded. Saved responses and findings remain queued until membership and versions are revalidated.</div>}
    {error && <div className="notice danger" role="alert"><AlertTriangle />{error}</div>}{draftMessage && <div className="notice" role="status">{draftMessage}</div>}
    {org && <PropertyRepairReadiness org={org} homeId={inspection.home_id} />}
    {reportMode && org ? <InspectionReport org={org} inspection={inspection} questions={inspectionData.questions} responses={effectiveResponses} observations={inspectionData.observations ?? []} refresh={detail.refetch} /> : <>
    {org && <InspectionManagement org={org} inspection={inspection} refresh={detail.refetch} />}

    <section className="coverage-summary"><div><strong>{counts.pass}</strong><span>Pass</span></div><div><strong>{counts.fail}</strong><span>Fail</span></div><div><strong>{counts.not_applicable}</strong><span>Not applicable</span></div><div><strong>{counts.not_checked}</strong><span>Not checked</span></div></section>
    <section className="inspection-space-toolbar"><div><span className="eyebrow">INSPECTION SHEET</span><h2>Inspect one space at a time</h2><p>Responses are kept when you move between spaces.</p></div><label className="field">Select space<select aria-label="Select space" disabled={mediaUploading} value={currentSpace} onChange={(event) => setSelectedSpace(event.target.value)}>{spaces.map((space) => <option key={space} value={space}>{space} · {inspectionData.questions.filter((question) => question.section === space && (drafts[question.id]?.result || effectiveResponses.some((response) => response.question_id === question.id))).length}/{inspectionData.questions.filter((question) => question.section === space).length} completed</option>)}</select></label></section>
    <section className="stack-xl" aria-label="Inspection checklist">{spaces.filter((space) => space === currentSpace).map((space) => <section className="stack-lg" key={space} aria-label={`Checklist for ${space}`}><h2>{space}</h2>{inspectionData.questions.filter((question) => question.section === space).map((question) => {
      const saved = effectiveResponses.find((response) => response.question_id === question.id)
      const questionObs = (inspectionData.observations ?? []).find((o) => o.question_id === question.id)
      const draft = drafts[question.id] ?? {
        result: saved?.result,
        explanation: saved?.explanation ?? questionObs?.description ?? '',
        priority: questionObs?.priority ?? 'normal',
        safety: questionObs?.safety_flag ?? false
      }
      const isNeedsFixing = draft.result === 'fail'
      const isDirty = dirtyQuestions.includes(question.id)

      return <article className="panel checklist-question" key={question.id}><div className="question-title"><span>{question.ordinal}</span><div><small>{question.section}</small><h2>{question.label}</h2>{isDirty && <small role="status">Unsaved changes</small>}</div>{saved && !isDirty && <CheckCircle2 aria-label="Response saved" />}</div>
        <div><button type="button" className={`button checklist-check-btn ${draft.result === 'pass' || draft.result === 'fail' ? 'checked' : 'secondary'}`} aria-label={`Checked: ${question.label}`} aria-pressed={draft.result === 'pass' || draft.result === 'fail'} disabled={!editable || submitting || savingDraft} onClick={() => { const isChecked = draft.result === 'pass' || draft.result === 'fail'; setDrafts((current) => ({ ...current, [question.id]: { ...draft, result: isChecked ? undefined : (draft.result === 'fail' ? 'fail' : 'pass') } })) }}>{draft.result === 'pass' || draft.result === 'fail' ? <Check size={18} strokeWidth={2.5} /> : <span className="checklist-check-box" />}<span>Item checked</span></button></div>
        <label className="field">Result<select aria-label={`Result for ${question.label}`} value={draft.result ?? ''} disabled={!editable || submitting || savingDraft} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: { ...draft, result: event.target.value as InspectionResult } }))}><option value="" disabled>Choose result</option>{results.map((result) => <option key={result} value={result}>{result === 'pass' ? 'Checked — no issue' : result === 'fail' ? 'Needs fixing' : humanize(result)}</option>)}</select></label>
        <label className="field">{isNeedsFixing ? 'What needs fixing?' : 'Notes'}<textarea aria-label={isNeedsFixing ? `What needs fixing for ${question.label}` : `Notes for ${question.label}`} value={draft.explanation} disabled={!editable || submitting || savingDraft} maxLength={4000} placeholder={isNeedsFixing ? 'Describe what needs fixing or repair…' : 'Optional notes…'} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: { ...draft, explanation: event.target.value } }))} /></label>
        {isNeedsFixing && <div className="form-grid two inspection-fix-fields"><label className="field">Priority<select aria-label={`Priority for ${question.label}`} value={draft.priority ?? 'normal'} disabled={!editable || submitting || savingDraft} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: { ...draft, priority: event.target.value as 'low' | 'normal' | 'high' | 'critical' } }))}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label><label className="check-row inspection-safety-check"><input type="checkbox" aria-label={`Safety-sensitive issue for ${question.label}`} checked={Boolean(draft.safety)} disabled={!editable || submitting || savingDraft} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: { ...draft, safety: event.target.checked } }))} /><span>Safety-sensitive issue</span></label></div>}
        {questionObs && <div className="inspection-observation-summary"><small>Saved observation: <strong>{humanize(questionObs.priority)} priority</strong>{questionObs.safety_flag ? ' · Safety-sensitive' : ''}{questionObs.status ? ` · ${humanize(questionObs.status)}` : ''}</small></div>}
        {org && id && <InspectionItemMedia org={org} inspectionId={id} questionId={question.id} label={question.label} editable={editable && !submitting} onBusy={(busy) => setUploadingItems((all) => ({ ...all, [question.id]: busy }))} />}
      </article>
    })}</section>)}</section>
    <section className="panel form-panel">{org && id && <ObservationCapture org={org} inspectionId={id} homeId={inspection.home_id} editable={editable} observations={inspectionData.observations ?? []} onEditingChange={(editing) => setObservationForms((all) => ({ ...all, additional: editing }))} />}</section>
    {editable && <div className="form-actions sticky-actions inspection-submit-actions"><span>{mediaUploading ? 'Wait for evidence uploads to finish' : unsavedObservationForms ? 'Save or cancel the open observation before submitting' : dirtyQuestions.length ? `${dirtyQuestions.length} unsaved response${dirtyQuestions.length === 1 ? '' : 's'}` : `${effectiveResponses.length} of ${inspectionData.questions.length} questions completed`}</span><div className="button-row"><button type="button" className="button secondary" disabled={!dirtyQuestions.length || savingDraft || submitting} onClick={() => void saveAllDrafts()}><Save />{savingDraft ? 'Saving draft…' : 'Save draft'}</button><button className="button primary" disabled={!allRequiredAnswered || submitting || savingDraft || mediaUploading || unsavedObservationForms > 0} onClick={() => void submitInspection()}><ClipboardCheck />{submitting ? 'Submitting…' : 'Submit inspection'}</button></div></div>}
    </>}
  </div>
}
