import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ErrorState, EmptyState } from '../../components/Ui'
import { useAuth } from '../auth/AuthProvider'
import { useParticipants, useRosterCompanies } from '../../lib/data'
import { newCommand, runCommand } from '../../lib/commands'
import { qualityClient, useObservations, type Observation } from './qualityData'
import { listFieldContexts, listHomeOfflineBundles, offlineDb } from '../../lib/offline'
import { humanize } from '../../lib/utils'

export function ObservationReview({ org, inspectionId, homeId, neighborhoodId, hideWhenEmpty = false }: { org: string; inspectionId?: string; homeId?: string; neighborhoodId?: string; hideWhenEmpty?: boolean }) {
  const observations = useObservations(org, inspectionId)
  const { user, can } = useAuth()
  const cache = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [action, setAction] = useState(can('work.assign') ? 'assign' : can('work.triage') ? 'disregard' : 'reinspect')
  const [party, setParty] = useState('company')
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const rows = (observations.data ?? []).filter((w) => (!homeId || w.home_id === homeId) && w.state !== 'verified' && w.state !== 'cancelled' && w.state !== 'draft')
  const first = rows.find((w) => selected.includes(w.id))
  const companies = useRosterCompanies(org, neighborhoodId ?? first?.neighborhood_id)
  const participants = useParticipants(org, neighborhoodId ?? first?.neighborhood_id)
  const inspectors = useQuery({ queryKey: ['inspection-leads', org, homeId ?? first?.home_id], enabled: Boolean(homeId ?? first?.home_id), queryFn: async () => {
    const { data, error } = await qualityClient().rpc('inspection_lead_options', { p_organization_id: org, p_home_id: homeId ?? first?.home_id })
    if (error) throw error
    return data as Array<{ user_id: string; display_name: string }>
  } })
  const technicians = useQuery({ queryKey: ['repair-technicians', org, company], enabled: Boolean(company), queryFn: async () => {
    const { data, error } = await qualityClient().rpc('repair_technician_options', { p_org: org, p_company: company, p_home: homeId ?? first?.home_id })
    if (error) throw error
    return data as Array<{ user_id: string; display_name: string }>
  } })
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!user || busy || !selected.length) return
    const form = new FormData(event.currentTarget)
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await runCommand('bulk_review_observations', newCommand({ organization_id: org, action, rows: rows.filter((w) => selected.includes(w.id)).map((w) => ({ item_id: w.id, expected_version: w.version })), reason: form.get('reason'),
        company_id: action === 'assign' && party === 'company' ? company : null, technician_id: form.get('technician_id') || null, accountable_internal_user_id: action === 'assign' && party === 'internal' ? form.get('internal_user_id') : null,
        inspector_user_id: form.get('inspector_user_id'), due_at: form.get('due_at') ? new Date(String(form.get('due_at'))).toISOString() : null }), { organizationId: org, userId: user.id, aggregateId: inspectionId ?? org })
      if ('queued' in result) throw new Error('Observation review requires a connection.')
      if (!result.ok) throw new Error(result.error.message)
      await Promise.all(['observations', 'work-items', 'work-item', 'inspections'].map((key) => cache.invalidateQueries({ queryKey: [key, org] })))
      setMessage(`${selected.length} observations updated.`); setSelected([])
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  if (hideWhenEmpty && !rows.length) return null
  if (!can('work.assign') && !can('work.triage') && !can('work.verify')) return null
  return <section className="panel form-panel stack-lg" aria-label="Review observations"><h2>Review observations</h2>{observations.error && <ErrorState message={observations.error.message} />}
    {!rows.length ? <EmptyState title="No observations to review" description="Submitted observations and repairs awaiting review appear here." /> : <form className="stack-lg" onSubmit={apply}><fieldset disabled={busy} className="property-fieldset stack-lg"><div className="observation-selection">{rows.map((w) => <label className="check-row" key={w.id}><input type="checkbox" checked={selected.includes(w.id)} onChange={(e) => setSelected((all) => e.target.checked ? [...all, w.id] : all.filter((id) => id !== w.id))} /><span><strong>{w.title}</strong><small>{w.reinspection_status === 'pending' ? 'Pending reinspection' : humanize(w.state)} · <Link to={`/org/${org}/work/${w.id}`}>Open thread</Link></small></span></label>)}</div>
      <div className="form-grid two"><label className="field">Action<select value={action} onChange={(e) => setAction(e.target.value)}>{can('work.assign') && <option value="assign">Assign repairs</option>}{can('work.triage') && <option value="disregard">Disregard observations</option>}{can('work.verify') && <option value="reinspect">Send for reinspection</option>}</select></label>
      {action === 'assign' && <><label className="field">Assign to<select value={party} onChange={(e) => setParty(e.target.value)}><option value="company">Vendor company</option><option value="internal">Internal team member</option></select></label>{party === 'company' ? <><label className="field">Vendor company<select value={company} onChange={(e) => setCompany(e.target.value)} required><option value="">Choose vendor</option>{companies.data?.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label className="field">Specific tradesman (optional)<select key={company} name="technician_id" defaultValue=""><option value="">Company chooses the tradesman</option>{technicians.data?.map((t) => <option key={t.user_id} value={t.user_id}>{t.display_name}</option>)}</select></label></> : <label className="field">Internal assignee<select name="internal_user_id" required><option value="">Choose team member</option>{participants.data?.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></label>}<label className="field">Repair due date<input name="due_at" type="datetime-local" required /></label></>}
      {action === 'reinspect' && <label className="field">Inspector<select name="inspector_user_id" aria-label="Inspector" required defaultValue=""><option value="">Choose independent Inspector</option>{inspectors.data?.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select><small>The Inspector must have access to every selected home and be independent of the repair company.</small></label>}
      <label className="field full-span">Reason<textarea name="reason" required maxLength={1000} /></label></div></fieldset>{error && <ErrorState message={error} />}<div className="form-actions"><span>{selected.length} selected</span><button className="button primary" disabled={busy || !selected.length}>{busy ? 'Applying…' : 'Apply to selected observations'}</button></div></form>}{message && <div className="notice" role="status">{message}</div>}
  </section>
}

export function ReinspectionInbox({ org }: { org: string }) {
  const { user } = useAuth()
  const observations = useObservations(org, undefined, user?.id)
  const [completed, setCompleted] = useState(false)
  const rows = (observations.data ?? []).filter((w) => completed ? w.reinspection_status === 'completed' : w.reinspection_status === 'pending' && w.state === 'ready_for_verification')
  const homes = useQuery({ queryKey: ['reinspection-homes', org], queryFn: async () => {
    if (!navigator.onLine && user) { const [fields, bundles] = await Promise.all([listFieldContexts(user.id, org), listHomeOfflineBundles(user.id, org)]); return [...fields.map((f) => f.home), ...bundles.map((b) => b.home)] as unknown as Array<{ id: string; lot_code: string; address_line1: string | null }> }
    const { data, error } = await qualityClient().from('homes').select('id,lot_code,address_line1').eq('organization_id', org)
    if (error) throw error
    return data as Array<{ id: string; lot_code: string; address_line1: string | null }>
  } })
  const groups = [...new Set(rows.map((w) => w.home_id))]
  return <section className="stack-lg" aria-label="Reinspection inbox"><div className="section-heading"><h2>Re-inspections</h2><label className="check-row"><input type="checkbox" checked={completed} onChange={(e) => setCompleted(e.target.checked)} />Show completed</label></div>{observations.error && <ErrorState message={observations.error.message} />}{!groups.length && <EmptyState title={completed ? 'No completed reinspections' : 'No pending reinspections'} description="Repairs assigned to you for an on-site check are grouped by home." />}{groups.map((id) => { const home = homes.data?.find((h) => h.id === id); return <Link className="panel form-panel reinspection-home-link" key={id} to={`/org/${org}/inspections/reinspections/${id}${completed ? '?status=completed' : ''}`}><span><strong>Lot {home?.lot_code ?? '—'} · {rows.filter((w) => w.home_id === id).length} {rows.filter((w) => w.home_id === id).length === 1 ? 'item' : 'items'} {completed ? 'checked' : 'to re-inspect'}</strong><small>{home?.address_line1 ?? 'Address pending'}</small></span><span>Open rooms →</span></Link> })}</section>
}

export function ReinspectionItem({ org, item, completed = false }: { org: string; item: Observation; completed?: boolean }) {
  const { user } = useAuth()
  const cache = useQueryClient()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [queued, setQueued] = useState(false)
  const pending = useQuery({ queryKey: ['pending-reinspection', org, user?.id, item.id], enabled: Boolean(user && !completed), queryFn: async () =>
    offlineDb.operations.where('[user_id+organization_id]').equals([user!.id, org]).filter((operation) => operation.command_name === 'decide_reinspection' && operation.envelope.payload.item_id === item.id && !['synced', 'access_revoked'].includes(operation.state)).first().then((operation) => operation ?? null)
  })
  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!user || busy || queued || pending.data || pending.isLoading || pending.isError) return
    const form = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      const result = await runCommand('decide_reinspection', newCommand({ organization_id: org, item_id: item.id, decision: form.get('decision'), notes: form.get('notes') }, item.version), { organizationId: org, userId: user.id, aggregateId: item.id, allowOffline: true })
      if (!('queued' in result) && !result.ok) throw new Error(result.error.message)
      if ('queued' in result) { setQueued(true); await pending.refetch(); return }
      await Promise.all(['observations', 'work-items', 'work-item', 'inspection', 'inspection-observations', 'property-repair-readiness', 'home'].map((key) => cache.invalidateQueries({ queryKey: [key, org] })))
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  return <article className="reinspection-item"><h3><Link to={`/org/${org}/work/${item.id}`}>{item.title}</Link></h3><p>{item.description}</p>{completed ? <p>{humanize(item.state)}</p> : queued || pending.data ? <div className="notice" role="status">{pending.data && (pending.data.state === 'conflict' || pending.data.state === 'failed' && pending.data.retryable === false) ? 'Your saved decision needs review in Sync center.' : 'Decision saved on this device. It will synchronize when connected.'} <Link to={`/org/${org}/sync`}>View saved changes</Link></div> : <form onSubmit={decide} className="stack-lg"><label className="field">Reinspection decision<select name="decision" required defaultValue=""><option value="">Choose decision</option><option value="accepted">Repair accepted — close observation</option><option value="rejected">Repair incomplete — return for rework</option></select></label><label className="field">On-site findings<textarea name="notes" required maxLength={4000} /></label><label className="check-row"><input type="checkbox" required />I inspected this repair on site.</label><div><button className="button primary" disabled={busy || pending.isLoading || pending.isError}>{busy ? 'Saving…' : 'Record reinspection'}</button></div></form>}{pending.error && <ErrorState message="Saved decisions could not be checked. Open Sync center before recording another decision." />}{error && <div className="notice" role="status">{error}</div>}</article>
}

export function AssignReinspection({ org, item }: { org: string; item: { id: string; home_id: string | null; version: number } }) {
  const { user } = useAuth()
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const options = useQuery({ queryKey: ['inspection-leads', org, item.home_id], enabled: Boolean(item.home_id), queryFn: async () => {
    const { data, error } = await qualityClient().rpc('inspection_lead_options', { p_organization_id: org, p_home_id: item.home_id })
    if (error) throw error
    return data as Array<{ user_id: string; display_name: string }>
  } })
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!user || busy) return
    const form = new FormData(event.currentTarget); setBusy(true); setError('')
    try {
      const result = await runCommand('bulk_review_observations', newCommand({ organization_id: org, action: 'reinspect', rows: [{ item_id: item.id, expected_version: item.version }], inspector_user_id: form.get('inspector'), reason: form.get('reason') }), { organizationId: org, userId: user.id, aggregateId: item.id })
      if ('queued' in result) throw new Error('Assigning a reinspection requires a connection.')
      if (!result.ok) throw new Error(result.error.message)
      await Promise.all(['work-item', 'work-items', 'observations', 'inspection', 'inspection-observations', 'property-repair-readiness', 'home'].map((key) => cache.invalidateQueries({ queryKey: [key, org] })))
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  if (!item.home_id) return null
  return <details className="command-disclosure"><summary>Request reinspection (optional)</summary><p>Supervisors can accept and close repairs directly. Request an independent Inspector’s on-site check when further inspection is needed. The repair will then wait for that Inspector’s decision.</p><form className="stack-lg" onSubmit={assign}><label className="field">Independent Inspector<select name="inspector" required defaultValue=""><option value="">Choose Inspector</option>{options.data?.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></label><label className="field">Reason for reinspection<input name="reason" required maxLength={1000} /></label>{(error || options.error) && <ErrorState message={error || options.error!.message} />}<div><button className="button secondary" disabled={busy}>{busy ? 'Assigning…' : 'Assign reinspection'}</button></div></form></details>
}
