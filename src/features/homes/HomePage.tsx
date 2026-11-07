import { PropertyRepairReadiness } from '../inspections/InspectionObservations'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowUpRight, CheckCircle2, Clock3, Home as HomeIcon, MapPin, Plus, ShieldCheck } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader, PriorityBadge, StateBadge } from '../../components/Ui'
import { useHome, useInspections, useNeighborhoods, useWorkItems } from '../../lib/data'
import { formatDateTime } from '../../lib/utils'
import { newCommand, runCommand } from '../../lib/commands'
import { useAuth } from '../auth/AuthProvider'
import { cacheHomeEvidence, readHomeOfflineBundle, saveHomeOfflineBundle } from '../../lib/offline'
import type { HomeRow, InspectionRow } from '../../lib/data'
import type { WorkItemSummary } from '../../types/domain'
import { requireSupabase } from '../../lib/supabase'

const HomeDetails = lazy(() => import('../properties/PropertyDetailPage').then((module) => ({ default: module.PropertyDetailPage })))
const HomeInspections = lazy(() => import('../inspections/InspectionsPage').then((module) => ({ default: module.InspectionsPage })))
const HomeConfiguration = lazy(() => import('../settings/ConfigurationPage').then((module) => ({ default: module.ConfigurationPage })))

interface OfflineHomeBundle {
  home: HomeRow
  work: WorkItemSummary[]
  inspections: InspectionRow[]
  locations?: Array<Record<string, unknown>>
  neighborhood?: { id: string; name: string }
  workDetails?: Record<string, { item: WorkItemSummary; events: Array<Record<string, unknown>>; comments: Array<Record<string, unknown>>; attachments: Array<Record<string, unknown>> }>
  inspectionDetails?: Record<string, { inspection: Record<string, unknown>; questions: Array<Record<string, unknown>>; responses: Array<Record<string, unknown>>; observations?: Array<Record<string, unknown>> }>
}

export function HomePage() {
  const { org, id } = useParams()
  const [params] = useSearchParams()
  const homes = useHome(org, id)
  const work = useWorkItems(org, id)
  const inspections = useInspections(org, id)
  const neighborhoods = useNeighborhoods(org)
  const { user, can } = useAuth()
  const queryClient = useQueryClient()
  const tabs = [{ key: 'work', label: 'Work' }, { key: 'inspections', label: 'Inspections' }, ...(can('structure.manage') ? [{ key: 'details', label: 'Details & rooms' }] : []), ...(can('structure.manage') || can('config.manage') ? [{ key: 'milestones', label: 'Milestones' }] : [])]
  const tab = tabs.some((item) => item.key === params.get('tab')) ? params.get('tab')! : 'work'
  const milestoneKind = can('config.manage') && (params.get('view') === 'requirements' || !can('structure.manage')) ? 'requirements' : 'milestones'
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [approvalMessage, setApprovalMessage] = useState('')
  const [offlineMessage, setOfflineMessage] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [cacheRefresh, setCacheRefresh] = useState(0)
  const offlineBundle = useQuery({
    queryKey: ['offline-home', user?.id, org, id],
    enabled: Boolean(user && org && id),
    queryFn: async () => (await readHomeOfflineBundle(user!.id, org!, id!))?.value as OfflineHomeBundle | undefined
  })
  const refetchOfflineBundle = offlineBundle.refetch
  const liveHome = homes.data
  const home = liveHome ?? offlineBundle.data?.home
  const homeWork = useMemo(() => work.data?.filter((item) => item.home_id === id) ?? offlineBundle.data?.work ?? [], [work.data, id, offlineBundle.data])
  const homeInspections = useMemo(() => inspections.data?.filter((item) => item.home_id === id) ?? offlineBundle.data?.inspections ?? [], [inspections.data, id, offlineBundle.data])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const timer = window.setInterval(() => setCacheRefresh((value) => value + 1), 6 * 60 * 60 * 1000)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); window.clearInterval(timer) }
  }, [])

  const saveForOffline = useCallback(async (shouldContinue: () => boolean) => {
    if (!user || !org || !id || !liveHome || !work.data || !inspections.data) return
    setOfflineMessage('Saving this home on your device…')
    try {
      const itemIds = homeWork.map((item) => item.id)
    let events: Array<Record<string, unknown>> = []
    let comments: Array<Record<string, unknown>> = []
    let attachments: Array<Record<string, unknown>> = []
    if (itemIds.length) {
      const client = requireSupabase()
      const [eventResult, commentResult, attachmentResult] = await Promise.all([
        client.from('work_events').select('*').eq('organization_id', org).in('work_item_id', itemIds).order('server_at', { ascending: false }),
        client.from('comments').select('id,work_item_id,author_id,visibility,body,created_at').eq('organization_id', org).in('work_item_id', itemIds).order('created_at'),
        client.from('attachments').select('id,work_item_id,original_name,mime_type,byte_size,status,visibility,purpose,correction_attempt_id,created_at').eq('organization_id', org).in('work_item_id', itemIds).order('created_at')
      ])
      if (eventResult.error) throw eventResult.error
      if (commentResult.error) throw commentResult.error
      if (attachmentResult.error) throw attachmentResult.error
      events = (eventResult.data ?? []) as Array<Record<string, unknown>>
      comments = (commentResult.data ?? []) as Array<Record<string, unknown>>
      attachments = (attachmentResult.data ?? []) as Array<Record<string, unknown>>
    }
    const workDetails = Object.fromEntries(homeWork.map((item) => [item.id, {
      item,
      events: events.filter((row) => row.work_item_id === item.id),
      comments: comments.filter((row) => row.work_item_id === item.id),
      attachments: attachments.filter((row) => row.work_item_id === item.id)
    }]))
    const inspectionIds = homeInspections.map((inspection) => inspection.id)
    let inspectionDetails: OfflineHomeBundle['inspectionDetails'] = {}
    if (inspectionIds.length) {
      const client = requireSupabase()
      const inspectionResult = await client.from('inspections').select('*').eq('organization_id', org).in('id', inspectionIds)
      if (inspectionResult.error) throw inspectionResult.error
      const fullInspections = (inspectionResult.data ?? []) as Array<Record<string, unknown>>
      const versionIds = [...new Set(fullInspections.map((inspection) => String(inspection.template_version_id)))]
      const [questionResult, responseResult, observationResult] = await Promise.all([
        client.from('checklist_questions').select('*').eq('organization_id', org).in('version_id', versionIds).order('ordinal'),
        client.from('inspection_responses').select('id,inspection_id,question_id,result,explanation,finding_work_item_id').eq('organization_id', org).in('inspection_id', inspectionIds),
        (client as unknown as import('@supabase/supabase-js').SupabaseClient).from('inspection_observations').select('*').eq('organization_id', org).in('inspection_id', inspectionIds)
      ])
      if (questionResult.error) throw questionResult.error
      if (responseResult.error) throw responseResult.error
      if (observationResult.error) throw observationResult.error
      const questions = (questionResult.data ?? []) as Array<Record<string, unknown>>
      const responses = (responseResult.data ?? []) as Array<Record<string, unknown>>
      inspectionDetails = Object.fromEntries(fullInspections.map((inspection) => [String(inspection.id), {
        inspection: { ...inspection, lot_code: liveHome.lot_code, address_line1: liveHome.address_line1 },
        questions: questions.filter((question) => question.version_id === inspection.template_version_id),
        responses: responses.filter((response) => response.inspection_id === inspection.id),
        observations: (observationResult.data ?? []).filter((observation) => observation.inspection_id === inspection.id)
      }]))
    }
    const { data: locations, error: locationsError } = await requireSupabase().from('home_locations').select('*').eq('organization_id', org).eq('home_id', id).order('name')
    if (locationsError) throw locationsError
    const { data: identity, error: identityError } = await requireSupabase().auth.getUser()
    if (!shouldContinue() || !navigator.onLine) return
    if (identityError || identity.user?.id !== user.id) throw new Error('Sign in again to save this home.')
    await saveHomeOfflineBundle({
      userId: user.id,
      organizationId: org,
      homeId: id,
      serverVersion: liveHome.version,
      value: {
        home: liveHome,
        neighborhood: neighborhoods.data?.find((item) => item.id === liveHome.neighborhood_id),
        work: homeWork,
        inspections: homeInspections,
        workDetails,
        inspectionDetails,
        locations
      }
    })
      if (!shouldContinue()) return
      await refetchOfflineBundle()
      const evidence = await cacheHomeEvidence(user.id, org, id, attachments, shouldContinue)
      if (shouldContinue()) setOfflineMessage(evidence.failed ? 'Home saved. Some evidence files could not be saved on this device.' : 'Saved on this device for up to 24 hours.')
    } catch (error) {
      if (shouldContinue()) setOfflineMessage(error instanceof Error ? `Could not save this home on this device: ${error.message}` : 'Could not save this home on this device.')
    }
  }, [homeInspections, homeWork, id, inspections.data, liveHome, neighborhoods.data, refetchOfflineBundle, org, user, work.data])
  useEffect(() => {
    if (!online || !user || !org || !id || !liveHome || !work.data || !inspections.data) return
    let current = true
    const cancel = () => { current = false }
    window.addEventListener('buildtrack:logout-start', cancel)
    const timer = window.setTimeout(() => { void saveForOffline(() => current) }, 300)
    return () => { current = false; window.clearTimeout(timer); window.removeEventListener('buildtrack:logout-start', cancel) }
  }, [online, user, org, id, liveHome, work.data, inspections.data, saveForOffline, cacheRefresh])

  if (!home && (homes.isLoading || work.isLoading || inspections.isLoading || offlineBundle.isLoading)) return <LoadingState label="Loading home record" />
  if (!home && (homes.isError || work.isError || inspections.isError)) return <ErrorState message={homes.error?.message ?? work.error?.message ?? inspections.error?.message ?? 'Unable to load home'} />
  if (!home) return <ErrorState message={online ? 'This home was not found or is outside your authorized scope.' : 'This home is not saved on this device yet. Open it while connected to use it offline.'} />

  const address = [home.address_line1, home.city, home.state_code, home.postal_code].filter(Boolean).join(', ')

  async function approveMilestone() {
    if (!org || !id || !user) return
    setApprovalBusy(true)
    setApprovalMessage('')
    try {
      const response = await runCommand<Record<string, unknown>, { id: string }>('approve_milestone', newCommand({ home_id: id, milestone_code: 'operational_readiness' }), { organizationId: org, userId: user.id, aggregateId: id })
      if ('queued' in response) throw new Error('Milestone approval requires a live connection.')
      if (!response.ok) throw new Error(response.error.message)
      setApprovalMessage('Operational readiness milestone approved and recorded in the audit trail.')
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['homes', org] }), queryClient.invalidateQueries({ queryKey: ['home', org, id] })])
    } catch (error) { setApprovalMessage(error instanceof Error ? error.message : 'Milestone approval failed.') }
    finally { setApprovalBusy(false) }
  }



  return <div className="stack-xl home-workspace">
    <nav className="property-breadcrumbs" aria-label="Breadcrumb">{can('structure.manage') && <><Link to={`/org/${org}/properties/homes`}>Homes</Link><span aria-hidden="true">/</span></>}<Link to={`/org/${org}/${can('structure.manage') ? 'properties/' : ''}neighborhoods/${home.neighborhood_id}`}>{neighborhoods.data?.find((item) => item.id === home.neighborhood_id)?.name ?? 'Neighborhood'}</Link><span aria-hidden="true">/</span><span aria-current="page">Lot {home.lot_code}</span></nav>
    <Link className="text-button" to={`/org/${org}/messages?new=1&neighborhood=${home.neighborhood_id}&home=${home.id}`}>Message the home team →</Link>
    <PageHeader eyebrow="HOME" title={`Lot ${home.lot_code}`} description={address || 'Address pending'} actions={tab === 'work' && can('work.create') ? <Link className="button primary" to={`/org/${org}/work/new?neighborhood=${home.neighborhood_id}&home=${home.id}`}><Plus />Add work</Link> : undefined} />
    {org && <PropertyRepairReadiness org={org} homeId={home.id} />}
    <nav className="home-section-nav" aria-label="Home sections">{tabs.map((item) => <Link key={item.key} to={`?tab=${item.key}`} aria-current={tab === item.key ? 'page' : undefined}>{item.label}</Link>)}</nav>
    {!online && offlineBundle.data && <div className="notice warning"><AlertCircle />Showing the saved home package. Server readiness may have changed.</div>}
    {tab === 'details' && <Suspense fallback={<LoadingState label="Loading home details" />}><HomeDetails kind="homes" embedded /></Suspense>}
    {tab === 'milestones' && <section className="stack-lg"><nav className="home-milestone-nav" aria-label="Milestone sections">{can('structure.manage') && <Link to="?tab=milestones&view=milestones" aria-current={milestoneKind === 'milestones' ? 'page' : undefined}>Planned milestones</Link>}{can('config.manage') && <Link to="?tab=milestones&view=requirements" aria-current={milestoneKind === 'requirements' ? 'page' : undefined}>Required inspections</Link>}</nav><Suspense fallback={<LoadingState label="Loading milestones" />}><HomeConfiguration key={`${home.id}-${milestoneKind}`} kind={milestoneKind} homeContext={home.id} /></Suspense></section>}
    {tab === 'work' && <>
      <section className={`readiness-hero readiness-${home.readiness}`}><div className="readiness-icon">{home.readiness === 'ready_for_review' ? <CheckCircle2 /> : home.readiness === 'not_ready' ? <AlertCircle /> : <Clock3 />}</div><div><p className="eyebrow">OPERATIONAL READINESS</p><h2>{home.readiness.replaceAll('_', ' ')}</h2><p>Calculated from current required inspections and active work. Final milestone approval is a separate human decision.</p></div>{can('milestone.approve') && <button className="button secondary" disabled={home.readiness !== 'ready_for_review' || approvalBusy} onClick={() => void approveMilestone()}><ShieldCheck />{approvalBusy ? 'Approving…' : 'Approve milestone'}</button>}</section>
      {approvalMessage && <div className="notice" role="status">{approvalMessage}</div>}
      <div className="detail-layout wide-main"><div className="stack-lg">
        {work.isLoading && <LoadingState label="Loading home work" />}{work.error && online && <ErrorState message={work.error.message} retry={() => void work.refetch()} />}
        <section className="panel"><div className="section-heading"><h2>Work items</h2><span>{homeWork.filter((item) => !['verified', 'cancelled', 'draft'].includes(item.state)).length} open</span></div>{!homeWork.length && !work.isLoading && !work.isError ? <EmptyState title="No work recorded" description="No authorized work items are attached to this home." /> : <div className="work-list compact">{homeWork.map((item) => <Link className="work-row" key={item.id} to={`/org/${org}/work/${item.id}`}><div className="work-priority-line" data-priority={item.priority} /><div className="work-main"><strong>{item.title}</strong><p>{item.assigned_party_name ?? 'Unassigned'}</p></div><PriorityBadge priority={item.priority} /><StateBadge state={item.state} /><ArrowUpRight /></Link>)}</div>}</section>
      </div><aside className="stack-lg"><section className="panel detail-card"><div className="section-heading"><h2><HomeIcon />Home summary</h2></div><dl className="side-details"><div><dt>Address</dt><dd>{address || 'Pending'}</dd></div><div><dt><MapPin />Neighborhood</dt><dd>{neighborhoods.data?.find((item) => item.id === home.neighborhood_id)?.name ?? offlineBundle.data?.neighborhood?.name ?? 'Neighborhood unavailable'}</dd></div><div><dt>Updated</dt><dd>{formatDateTime(home.updated_at)}</dd></div></dl></section><section className="panel form-panel stack-lg"><h2>Offline access</h2><p>Homes you open are saved automatically on this device. Saved changes sync when you reconnect while the app is open.</p><div className="notice" role="status">{!online ? offlineBundle.data ? "Using the saved copy on this device." : "This home has not been saved on this device yet." : offlineMessage || (offlineBundle.data ? "Saved on this device." : "Preparing this home for offline use…")}</div><p className="fine-print">Saved copies are available for up to 24 hours. Readiness updates after changes sync.</p></section></aside></div>
    </>}
    {tab === 'inspections' && <Suspense fallback={<LoadingState label="Loading home inspections" />}><HomeInspections key={home.id} homeContext={home.id} /></Suspense>}
  </div>
}
