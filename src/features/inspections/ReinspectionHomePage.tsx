import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { useAuth } from '../auth/AuthProvider'
import { useHomes } from '../../lib/data'
import { listFieldContexts, listHomeOfflineBundles, saveFieldContext } from '../../lib/offline'
import { useHomeLocations } from '../properties/propertyData'
import { useObservations } from './qualityData'
import { ReinspectionItem } from './ObservationPanels'

export function ReinspectionHomePage() {
  const { org, homeId } = useParams()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const observations = useObservations(org, undefined, user?.id)
  const locations = useHomeLocations(org, homeId)
  const homes = useHomes(org)
  const offline = useQuery({ queryKey: ['offline-home-list', user?.id, org], enabled: Boolean(user && org), queryFn: () => listHomeOfflineBundles(user!.id, org!) })
  const fieldCache = useQuery({ queryKey: ['offline-field-list', user?.id, org], enabled: Boolean(user && org), queryFn: () => listFieldContexts(user!.id, org!) })
  const [completed, setCompleted] = useState(params.get('status') === 'completed')
  const [space, setSpace] = useState('all')
  const home = homes.data?.find((h) => h.id === homeId) ?? offline.data?.find((b) => b.home.id === homeId)?.home ?? fieldCache.data?.find((b) => b.home.id === homeId)?.home
  const rows = (observations.data ?? []).filter((w) => w.home_id === homeId && (completed ? w.reinspection_status === 'completed' : w.reinspection_status === 'pending' && w.state === 'ready_for_verification'))
  useEffect(() => {
    if (!navigator.onLine || !user || !org || !homeId || !home || !locations.data || !observations.data) return
    void saveFieldContext(user.id, org, `reinspection:${homeId}`, { home: home as import('../../lib/offline').OfflineFieldContext['home'], locations: locations.data, observations: observations.data.filter((w) => w.home_id === homeId) as unknown as Array<Record<string, unknown>> }).catch(() => undefined)
  }, [home, homeId, locations.data, observations.data, org, user])
  // Derive the available rooms from assigned observations, never from the whole
  // lot layout. A completed decision removes that item from the pending view.
  const roomIds = [...new Set(rows.map((w) => w.location_id ?? 'whole-home'))]
  const selected = roomIds.includes(space) ? space : 'all'
  const label = (id: string) => id === 'whole-home' ? 'Whole home' : locations.data?.find((l) => l.id === id)?.name ?? 'Room unavailable'
  const groups = roomIds.filter((id) => selected === 'all' || selected === id).sort((a, b) => label(a).localeCompare(label(b)))
  const pending = observations.isLoading || homes.isLoading && offline.isLoading
  if (!org || !homeId) return null
  return <div className="stack-xl"><Link className="text-button" to={`/org/${org}/inspections?view=reinspections`}>← Re-inspections</Link>
    <PageHeader eyebrow="TARGETED FIELD REVIEW" title={`Lot ${home?.lot_code ?? '—'} · Re-inspection`} description={String(home?.address_line1 ?? 'Only observations assigned to you are shown.')} />
    <section className="panel form-panel stack-lg" aria-label="Reinspection rooms"><div className="section-heading"><div><h2>{rows.length} {rows.length === 1 ? 'observation' : 'observations'} {completed ? 'reviewed' : 'to check'}</h2><p>Open each thread to review its repair evidence and history.</p></div><label className="check-row"><input type="checkbox" checked={completed} onChange={(e) => { setCompleted(e.target.checked); setSpace('all') }} />Show completed</label></div>
      <div className="segmented reinspection-room-tabs" role="group" aria-label="Filter reinspection by room"><button className={selected === 'all' ? 'active' : ''} aria-pressed={selected === 'all'} onClick={() => setSpace('all')}>All assigned rooms ({rows.length})</button>{roomIds.map((id) => <button key={id} className={selected === id ? 'active' : ''} aria-pressed={selected === id} onClick={() => setSpace(id)}>{label(id)} ({rows.filter((w) => (w.location_id ?? 'whole-home') === id).length})</button>)}</div>
    </section>
    {pending && <LoadingState label="Loading assigned reinspection observations" />}
    {observations.error && navigator.onLine && <ErrorState message={observations.error.message} retry={() => void observations.refetch()} />}
    {locations.error && navigator.onLine && <ErrorState message={locations.error.message} retry={() => void locations.refetch()} />}
    {!pending && !observations.error && !rows.length && <EmptyState title={completed ? 'No completed observations here' : 'No remaining observations to inspect'} description={completed ? 'Completed decisions appear here after synchronization.' : 'Your assigned observations for this home have been checked or reassigned.'} />}
    {groups.map((id) => <section className="panel form-panel stack-lg" aria-label={`${label(id)} reinspection observations`} key={id}><h2>{label(id)}</h2>{rows.filter((w) => (w.location_id ?? 'whole-home') === id).map((w) => <ReinspectionItem key={`${w.id}-${w.version}`} org={org} item={w} completed={completed} />)}</section>)}
  </div>
}
