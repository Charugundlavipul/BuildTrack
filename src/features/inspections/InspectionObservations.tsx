import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { ErrorState } from '../../components/Ui'
import { useAuth } from '../auth/AuthProvider'
import { useHomeLocations } from '../properties/propertyData'
import { useParticipants, useRosterCompanies } from '../../lib/data'
import { newCommand, runCommand } from '../../lib/commands'
import { offlineDb } from '../../lib/offline'
import { humanize } from '../../lib/utils'
import { qualityClient, type InspectionObservation } from './qualityData'

import { InspectionItemMedia } from './InspectionItemMedia'

export function ObservationCapture({ org, inspectionId, questionId, questionLabel, homeId, editable, observations, onAdded, onEditingChange }: { org: string; inspectionId: string; questionId?: string; questionLabel?: string; homeId: string; editable: boolean; observations: InspectionObservation[]; onAdded?: () => void; onEditingChange?: (editing: boolean) => void }) {
  const { user } = useAuth()
  const cache = useQueryClient()
  const locations = useHomeLocations(org, homeId)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const pending = useQuery({ queryKey: ['pending-observations', user?.id, org, inspectionId], networkMode: 'always', enabled: Boolean(user), queryFn: async () => {
    const operations = await offlineDb.operations.where('[user_id+organization_id]').equals([user!.id, org]).filter((operation) => operation.command_name === 'record_inspection_observation' && operation.envelope.payload.inspection_id === inspectionId && !['synced', 'access_revoked'].includes(operation.state)).toArray()
    return operations.map((operation) => ({ ...operation.envelope.payload, queued: true })) as unknown as InspectionObservation[]
  } })
  const rows = [...observations, ...(pending.data ?? []).filter((row) => !observations.some((saved) => saved.id === row.id))].filter((row) => (row.question_id ?? null) === (questionId ?? null))
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!user || busy) return
    const form = new FormData(event.currentTarget)
    const id = crypto.randomUUID()
    setBusy(true); setError('')
    try {
      const result = await runCommand('record_inspection_observation', newCommand({ id, organization_id: org, inspection_id: inspectionId, question_id: questionId ?? null, location_id: String(form.get('location_id') ?? '') || null, title: String(form.get('title')).trim(), description: String(form.get('description')).trim(), priority: String(form.get('priority')), safety_flag: form.get('safety') === 'on' }), { organizationId: org, userId: user.id, aggregateId: id, allowOffline: true })
      if (!('queued' in result) && !result.ok) throw new Error(result.error.message)
      const refreshes = [cache.invalidateQueries({ queryKey: ['inspection', org, inspectionId] }), cache.invalidateQueries({ queryKey: ['inspection-observations', org, inspectionId] })]
      if ('queued' in result) { await pending.refetch(); void Promise.all(refreshes) }
      else await Promise.all([...refreshes, pending.refetch()])
      setAdding(false); onEditingChange?.(false); setMessage('Observation saved for report review.'); onAdded?.()
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  return <section className="stack-lg" aria-label={questionId ? `Observations for ${questionLabel}` : 'Additional observations'}>
    {!questionId && <div><h2>Additional observations</h2><p>Record anything else at this property that needs fixing.</p></div>}
    {rows.map((row) => <div className="inspection-observation-note" key={row.id}><strong>{row.title}</strong><p>{row.description}</p><small>{row.space_name ?? 'Saved on this device'} · {row.status ? humanize(row.status) : 'Awaiting sync'}</small></div>)}
    {editable && !adding && <div><button type="button" className="button secondary" aria-label={questionId ? `Add observation for ${questionLabel}` : 'Add additional observation'} onClick={() => { setAdding(true); onEditingChange?.(true); setMessage('') }}><Plus />{questionId ? 'Add observation' : 'Add additional observation'}</button></div>}
    {adding && <form className="stack-lg" aria-label={questionId ? `Record observation for ${questionLabel}` : 'Record additional observation'} onSubmit={save}><fieldset disabled={busy} className="property-fieldset stack-lg">
      {!questionId && <label className="field">Room or area<select name="location_id" defaultValue=""><option value="">Whole property</option>{locations.data?.filter((room) => room.active).map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>}
      <label className="field">Observation title<input name="title" required minLength={2} maxLength={160} /></label>
      <label className="field">What needs fixing?<textarea name="description" required minLength={2} maxLength={10000} /></label>
      <label className="field">Priority<select name="priority" defaultValue="normal">{['low', 'normal', 'high', 'critical'].map((priority) => <option key={priority} value={priority}>{humanize(priority)}</option>)}</select></label>
      <label className="check-row"><input name="safety" type="checkbox" />Safety-sensitive issue</label>
    </fieldset><div className="button-row"><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save observation'}</button><button type="button" className="button ghost" disabled={busy} onClick={() => { setAdding(false); onEditingChange?.(false) }}>Cancel</button></div></form>}
    {error && <ErrorState message={error} />}{message && <p className="notice" role="status">{message}</p>}
  </section>
}

export function InspectionObservationReview({ org, inspectionId, homeId, neighborhoodId }: { org: string; inspectionId: string; homeId: string; neighborhoodId: string }) {
  const observations = useQuery({ queryKey: ['inspection-observations', org, inspectionId], queryFn: async () => {
    const { data, error } = await qualityClient().from('inspection_observations').select('*,work_items(id,title,state,version,home_id,observation_id,reinspection_status)').eq('organization_id', org).eq('inspection_id', inspectionId).order('created_at')
    if (error) throw error
    return data as InspectionObservation[]
  } })
  return <section className="panel form-panel stack-lg" aria-label="Observation repair planning"><div><h2>Observations & repair tasks</h2><p>Review what needs fixing. Create one or more assigned repair tasks for each observation, or record why no work is needed.</p></div>{observations.error && <ErrorState message={observations.error.message} />}{observations.data?.length === 0 && <p>No new observations were recorded.</p>}{observations.data?.map((observation) => <ObservationRepairPlan key={`${observation.id}-${observation.version}`} org={org} observation={observation} homeId={homeId} neighborhoodId={neighborhoodId} />)}</section>
}

type Task = { title: string; description: string; party: string; assignee: string; due: string }
function ObservationRepairPlan({ org, observation, neighborhoodId }: { org: string; observation: InspectionObservation; homeId: string; neighborhoodId: string }) {
  const { user, can } = useAuth()
  const cache = useQueryClient()
  const participants = useParticipants(org, neighborhoodId)
  const companies = useRosterCompanies(org, neighborhoodId)
  const [tasks, setTasks] = useState<Task[]>([])
  const [disregarding, setDisregarding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const repairs = observation.work_items ?? []
  const update = (index: number, change: Partial<Task>) => setTasks((all) => all.map((task, i) => i === index ? { ...task, ...change } : task))
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!user || busy) return
    const form = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      const result = await runCommand(disregarding ? 'disregard_inspection_observation' : 'create_observation_work', newCommand({ organization_id: org, observation_id: observation.id, reason: form.get('reason'), tasks: tasks.map((task) => ({ title: task.title.trim(), description: task.description.trim(), priority: observation.priority, assignment: { accountable_internal_user_id: task.party === 'internal' ? task.assignee : null, company_id: task.party === 'company' ? task.assignee : null, due_at: new Date(task.due).toISOString() } })) }, observation.version), { organizationId: org, userId: user.id, aggregateId: observation.id })
      if ('queued' in result) throw new Error('Repair planning requires a connection.')
      if (!result.ok) throw new Error(result.error.message)
      await Promise.all(['inspection-observations', 'inspection', 'property-repair-readiness', 'work-items', 'home'].map((key) => cache.invalidateQueries({ queryKey: [key, org] })))
      setTasks([]); setDisregarding(false)
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  return <article className="inspection-repair-plan stack-lg"><div className="section-heading"><div><small>{observation.space_name}{observation.question_id ? ' · Checklist observation' : ' · Additional observation'}</small><h3>{observation.title}</h3></div><span className="state-badge">{humanize(observation.status)}</span></div><p>{observation.description}</p><div className="report-finding-flags"><span>{humanize(observation.priority)} priority</span>{observation.safety_flag && <span className="report-result result-fail">Safety-sensitive</span>}<span>{repairs.filter((repair) => repair.state === 'verified').length}/{repairs.filter((repair) => repair.state !== 'cancelled').length} repairs closed</span></div>{observation.question_id && <InspectionItemMedia org={org} inspectionId={observation.inspection_id} questionId={observation.question_id} label={observation.title} editable={false} />}{observation.review_notes && <p>Review notes: {observation.review_notes}</p>}
    {repairs.map((repair) => <div className="stack-lg inspection-repair-task" key={repair.id}><Link to={`/org/${org}/work/${repair.id}`}><strong>{repair.title}</strong> · {repair.reinspection_status === 'pending' ? 'Reinspection requested' : repair.state === 'ready_for_verification' ? 'Awaiting supervisor review' : repair.state === 'verified' ? 'Closed' : humanize(repair.state)}</Link>{repair.state === 'ready_for_verification' && repair.reinspection_status !== 'pending' && can('work.verify') && <Link className="button secondary" to={`/org/${org}/work/${repair.id}?tab=review`}>Review completion</Link>}</div>)}
    {observation.status !== 'disregarded' && <><div className="button-row">{can('work.create') && can('work.assign') && <button type="button" className="button secondary" disabled={busy || tasks.length >= 25} onClick={() => { setDisregarding(false); setTasks((all) => [...all, { title: all.length ? '' : observation.title, description: observation.description, party: 'internal', assignee: '', due: '' }]) }}><Plus />Add repair task</button>}{!repairs.some((repair) => repair.state !== 'cancelled') && <button type="button" className="button ghost" disabled={busy} onClick={() => { setTasks([]); setDisregarding(true) }}>No repair needed</button>}</div>
      {(tasks.length > 0 || disregarding) && <form onSubmit={save} className="stack-lg"><fieldset className="property-fieldset stack-lg" disabled={busy}>{disregarding ? <label className="field">Reason no repair is needed<textarea name="reason" required minLength={2} maxLength={2000} /></label> : tasks.map((task, index) => <fieldset key={index} className="stack-lg escalation-step"><legend>Repair task {index + 1}</legend><label className="field">Task title<input value={task.title} required maxLength={160} onChange={(event) => update(index, { title: event.target.value })} /></label><label className="field">Repair instructions<textarea value={task.description} required maxLength={10000} onChange={(event) => update(index, { description: event.target.value })} /></label><div className="form-grid two"><label className="field">Assign task to<select value={task.party} onChange={(event) => update(index, { party: event.target.value, assignee: '' })}><option value="internal">Internal team member</option><option value="company">Vendor company</option></select></label><label className="field">Assignee<select required value={task.assignee} onChange={(event) => update(index, { assignee: event.target.value })}><option value="">Choose assignee</option>{task.party === 'internal' ? participants.data?.map((person) => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>) : companies.data?.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label className="field">Due date<input type="datetime-local" value={task.due} required onChange={(event) => update(index, { due: event.target.value })} /></label></div><button type="button" className="button ghost" onClick={() => setTasks((all) => all.filter((_, i) => i !== index))}><Trash2 />Remove task {index + 1}</button></fieldset>)}</fieldset><div className="button-row"><button className="button primary" disabled={busy}>{busy ? 'Saving…' : disregarding ? 'Disregard observation' : `Create and assign ${tasks.length} repair ${tasks.length === 1 ? 'task' : 'tasks'}`}</button><button type="button" className="button ghost" disabled={busy} onClick={() => { setTasks([]); setDisregarding(false) }}>Cancel</button></div></form>}
    </>}{(error || participants.error || companies.error) && <ErrorState message={error || (participants.error ?? companies.error)!.message} />}
  </article>
}

type RepairReadiness = { home_id: string; lot_code: string; address_line1: string | null; observation_count: number; unreviewed_count: number; repair_count: number; incomplete_count: number; ready_for_reinspection: boolean }
export function PropertyRepairReadiness({ org, homeId }: { org: string; homeId?: string }) {
  const { can } = useAuth()
  const readiness = useQuery({ queryKey: ['property-repair-readiness', org, homeId], enabled: can('inspection.manage') && navigator.onLine, refetchInterval: 30000, queryFn: async () => {
    const { data, error } = await qualityClient().rpc('inspection_repair_readiness', { p_org: org, p_home: homeId ?? null })
    if (error) throw error
    return data as RepairReadiness[]
  } })
  if (!can('inspection.manage')) return null
  const rows = (readiness.data ?? []).filter((row) => homeId ? row.observation_count > 0 : row.ready_for_reinspection)
  return <>{readiness.error && <ErrorState message={readiness.error.message} />}{rows.map((row) => <section className={`notice ${row.ready_for_reinspection ? 'success' : ''} stack-lg`} key={row.home_id} aria-label={`Repair readiness for Lot ${row.lot_code}`}><div><strong>{row.ready_for_reinspection ? `Lot ${row.lot_code} has completions ready for supervisor review` : `Lot ${row.lot_code} · Repair progress`}</strong><p>{row.unreviewed_count} observations awaiting review · {row.repair_count} repair tasks · {row.incomplete_count} unfinished property tasks</p></div>{row.ready_for_reinspection && <Link className="button secondary" to={`/org/${org}/homes/${row.home_id}?tab=inspections`}>Review property repairs</Link>}</section>)}</>
}
