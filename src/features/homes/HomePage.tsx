import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, ArrowUpRight, CheckCircle2, ClipboardCheck, Clock3, Download, Home as HomeIcon, MapPin, Plus, ShieldCheck } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader, PriorityBadge, StateBadge } from '../../components/Ui'
import { useHomes, useInspections, useNeighborhoods, useWorkItems } from '../../lib/data'
import { formatDateTime } from '../../lib/utils'
import { newCommand, runCommand } from '../../lib/commands'
import { useAuth } from '../auth/AuthProvider'
import { readHomeOfflineBundle, saveHomeOfflineBundle } from '../../lib/offline'
import type { HomeRow, InspectionRow } from '../../lib/data'
import type { WorkItemSummary } from '../../types/domain'
import { requireSupabase } from '../../lib/supabase'

interface OfflineHomeBundle {
  home: HomeRow
  work: WorkItemSummary[]
  inspections: InspectionRow[]
  neighborhood?: { id: string; name: string }
  workDetails?: Record<string, { item: WorkItemSummary; events: Array<Record<string, unknown>>; comments: Array<Record<string, unknown>>; attachments: Array<Record<string, unknown>> }>
  inspectionDetails?: Record<string, { inspection: Record<string, unknown>; questions: Array<Record<string, unknown>>; responses: Array<Record<string, unknown>> }>
}

export function HomePage() {
  const { org, id } = useParams()
  const homes = useHomes(org)
  const work = useWorkItems(org)
  const inspections = useInspections(org)
  const neighborhoods = useNeighborhoods(org)
  const { user, can } = useAuth()
  const queryClient = useQueryClient()
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [approvalMessage, setApprovalMessage] = useState('')
  const [offlineMessage, setOfflineMessage] = useState('')
  const offlineBundle = useQuery({
    queryKey: ['offline-home', user?.id, org, id],
    enabled: Boolean(user && org && id),
    queryFn: async () => (await readHomeOfflineBundle(user!.id, org!, id!))?.value as OfflineHomeBundle | undefined
  })
  const liveHome = homes.data?.find((item) => item.id === id)
  const home = liveHome ?? offlineBundle.data?.home
  const homeWork = useMemo(() => work.data?.filter((item) => item.home_id === id) ?? offlineBundle.data?.work ?? [], [work.data, id, offlineBundle.data])
  const homeInspections = useMemo(() => inspections.data?.filter((item) => item.home_id === id) ?? offlineBundle.data?.inspections ?? [], [inspections.data, id, offlineBundle.data])

  if (!home && (homes.isLoading || work.isLoading || inspections.isLoading || offlineBundle.isLoading)) return <LoadingState label="Loading home record" />
  if (!home && (homes.isError || work.isError || inspections.isError)) return <ErrorState message={homes.error?.message ?? work.error?.message ?? inspections.error?.message ?? 'Unable to load home'} />
  if (!home) return <ErrorState message="This home was not found or is outside your authorized scope." />

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
      await queryClient.invalidateQueries({ queryKey: ['homes', org] })
    } catch (error) { setApprovalMessage(error instanceof Error ? error.message : 'Milestone approval failed.') }
    finally { setApprovalBusy(false) }
  }

  async function downloadForOffline() {
    if (!user || !org || !id || !liveHome || !work.data || !inspections.data) return
    setOfflineMessage('Preparing the authorized offline package…')
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
        client.from('attachments').select('id,work_item_id,original_name,mime_type,byte_size,status,visibility,created_at').eq('organization_id', org).in('work_item_id', itemIds).order('created_at')
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
      const [questionResult, responseResult] = await Promise.all([
        client.from('checklist_questions').select('*').eq('organization_id', org).in('version_id', versionIds).order('ordinal'),
        client.from('inspection_responses').select('id,inspection_id,question_id,result,explanation,finding_work_item_id').eq('organization_id', org).in('inspection_id', inspectionIds)
      ])
      if (questionResult.error) throw questionResult.error
      if (responseResult.error) throw responseResult.error
      const questions = (questionResult.data ?? []) as Array<Record<string, unknown>>
      const responses = (responseResult.data ?? []) as Array<Record<string, unknown>>
      inspectionDetails = Object.fromEntries(fullInspections.map((inspection) => [String(inspection.id), {
        inspection,
        questions: questions.filter((question) => question.version_id === inspection.template_version_id),
        responses: responses.filter((response) => response.inspection_id === inspection.id)
      }]))
    }
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
        inspectionDetails
      }
    })
      await offlineBundle.refetch()
      setOfflineMessage('Home package saved on this device for 24 hours.')
    } catch (error) {
      setOfflineMessage(error instanceof Error ? `Offline download failed: ${error.message}` : 'Offline download failed.')
    }
  }

  return <div className="stack-xl">
    <PageHeader eyebrow={`LOT ${home.lot_code}`} title={address || 'Address pending'} description={`${home.phase.replaceAll('_', ' ')} · Updated ${formatDateTime(home.updated_at)}`} actions={<div className="button-row"><button className="button secondary" disabled={!navigator.onLine || !liveHome} onClick={() => void downloadForOffline()}><Download />Download home</button>{can('work.create') && <Link className="button primary" to={`/org/${org}/work/new?neighborhood=${home.neighborhood_id}&home=${home.id}`}><Plus />Add work</Link>}</div>} />
    {offlineMessage && <div className="notice" role="status">{offlineMessage}</div>}
    {!navigator.onLine && offlineBundle.data && <div className="notice warning"><AlertCircle />Showing the saved home package. Server readiness may have changed.</div>}
    <section className={`readiness-hero readiness-${home.readiness}`}><div className="readiness-icon">{home.readiness === 'ready_for_review' ? <CheckCircle2 /> : home.readiness === 'not_ready' ? <AlertCircle /> : <Clock3 />}</div><div><p className="eyebrow">OPERATIONAL READINESS</p><h2>{home.readiness.replaceAll('_', ' ')}</h2><p>Calculated from current required inspections and active work. Final milestone approval is a separate human decision.</p></div>{can('milestone.approve') && <button className="button secondary" disabled={home.readiness !== 'ready_for_review' || approvalBusy} onClick={() => void approveMilestone()}><ShieldCheck />{approvalBusy ? 'Approving…' : 'Approve milestone'}</button>}</section>
    {approvalMessage && <div className="notice" role="status">{approvalMessage}</div>}
    <div className="detail-layout wide-main">
      <div className="stack-lg">
        <section className="panel"><div className="section-heading"><h2>Active work</h2><span>{homeWork.filter((item) => !['verified', 'cancelled', 'draft'].includes(item.state)).length} open</span></div>{!homeWork.length ? <EmptyState title="No work recorded" description="No authorized work items are attached to this home." /> : <div className="work-list compact">{homeWork.map((item) => <Link className="work-row" key={item.id} to={`/org/${org}/work/${item.id}`}><div className="work-priority-line" data-priority={item.priority} /><div className="work-main"><strong>{item.title}</strong><p>{item.assigned_party_name ?? 'Unassigned'}</p></div><PriorityBadge priority={item.priority} /><StateBadge state={item.state} /><ArrowUpRight /></Link>)}</div>}</section>
        <section className="panel"><div className="section-heading"><h2><ClipboardCheck />Inspections</h2><span>{homeInspections.length} records</span></div>{!homeInspections.length ? <EmptyState title="No inspections" description="Schedule a checklist-based inspection when the home is ready." /> : <div className="inspection-list">{homeInspections.map((inspection) => <Link to={`/org/${org}/inspections/${inspection.id}`} key={inspection.id} className="inspection-row"><span className="icon-tile"><ClipboardCheck /></span><span><strong>{inspection.type.replaceAll('_', ' ')}</strong><small>{formatDateTime(inspection.scheduled_at)}</small></span><span className={`state-badge state-${inspection.status}`}><span />{inspection.status}</span><ArrowUpRight /></Link>)}</div>}</section>
      </div>
      <aside className="stack-lg"><section className="panel detail-card"><div className="section-heading"><h2><HomeIcon />Home record</h2></div><dl className="side-details"><div><dt>Lot</dt><dd>{home.lot_code}</dd></div><div><dt>Address</dt><dd>{address || 'Pending'}</dd></div><div><dt>Phase</dt><dd>{home.phase.replaceAll('_', ' ')}</dd></div><div><dt><MapPin />Neighborhood</dt><dd>{home.neighborhood_id.slice(0, 8)}</dd></div></dl></section><section className="caveat-card"><AlertCircle /><div><strong>Offline caveat</strong><p>Unsynchronized field observations cannot affect server readiness until the device reconnects.</p></div></section></aside>
    </div>
  </div>
}
