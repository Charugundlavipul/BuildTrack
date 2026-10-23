import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, ArrowUpRight, CheckCircle2, ClipboardCheck, Clock3, Download, Home as HomeIcon, MapPin, Plus, ShieldCheck } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader, PriorityBadge, StateBadge } from '../../components/Ui'
import { useHomes, useInspections, useWorkItems } from '../../lib/data'
import { formatDateTime } from '../../lib/utils'
import { newCommand, runCommand } from '../../lib/commands'
import { useAuth } from '../auth/AuthProvider'
import { readHomeOfflineBundle, saveHomeOfflineBundle } from '../../lib/offline'
import type { HomeRow, InspectionRow } from '../../lib/data'
import type { WorkItemSummary } from '../../types/domain'

interface OfflineHomeBundle {
  home: HomeRow
  work: WorkItemSummary[]
  inspections: InspectionRow[]
}

export function HomePage() {
  const { org, id } = useParams()
  const homes = useHomes(org)
  const work = useWorkItems(org)
  const inspections = useInspections(org)
  const { user } = useAuth()
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
    await saveHomeOfflineBundle({
      userId: user.id,
      organizationId: org,
      homeId: id,
      serverVersion: liveHome.version,
      value: { home: liveHome, work: homeWork, inspections: homeInspections }
    })
    await offlineBundle.refetch()
    setOfflineMessage('Home package saved on this device for 24 hours.')
  }

  return <div className="stack-xl">
    <PageHeader eyebrow={`LOT ${home.lot_code}`} title={address || 'Address pending'} description={`${home.phase.replaceAll('_', ' ')} · Updated ${formatDateTime(home.updated_at)}`} actions={<div className="button-row"><button className="button secondary" disabled={!navigator.onLine || !liveHome} onClick={() => void downloadForOffline()}><Download />Download home</button><Link className="button primary" to={`/org/${org}/work/new`}><Plus />Add work</Link></div>} />
    {offlineMessage && <div className="notice" role="status">{offlineMessage}</div>}
    {!navigator.onLine && offlineBundle.data && <div className="notice warning"><AlertCircle />Showing the saved home package. Server readiness may have changed.</div>}
    <section className={`readiness-hero readiness-${home.readiness}`}><div className="readiness-icon">{home.readiness === 'ready_for_review' ? <CheckCircle2 /> : home.readiness === 'not_ready' ? <AlertCircle /> : <Clock3 />}</div><div><p className="eyebrow">OPERATIONAL READINESS</p><h2>{home.readiness.replaceAll('_', ' ')}</h2><p>Calculated from current required inspections and active work. Final milestone approval is a separate human decision.</p></div><button className="button secondary" disabled={home.readiness !== 'ready_for_review' || approvalBusy} onClick={() => void approveMilestone()}><ShieldCheck />{approvalBusy ? 'Approving…' : 'Approve milestone'}</button></section>
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
