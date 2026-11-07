import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Link } from 'react-router-dom'
import { useParticipants, useRosterCompanies } from '../../lib/data'
import { newCommand, runCommand } from '../../lib/commands'
import { requireSupabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

type Finding = { id: string; title: string; description: string; priority: string; status: string; version: number; work_items?: { id: string; title: string; state: string }[] }

export function InspectionRepairPlanning({ org, id, neighborhoodId, editable }: { org: string; id: string; neighborhoodId: string; editable: boolean }) {
  const { can } = useAuth()
  const findings = useQuery({ queryKey: ['inspection-observations', org, id], enabled: can('inspection.manage'), queryFn: async () => {
    const client = requireSupabase() as unknown as SupabaseClient
    const { data, error } = await client.from('inspection_observations').select('*,work_items(id,title,state)').eq('organization_id', org).eq('inspection_id', id).order('created_at')
    if (error) throw error
    return data as Finding[]
  } })
  if (!can('inspection.manage')) return null
  return <section className="panel form-panel stack-lg" aria-label="Inspection repair planning">
    <div><h2>Findings and repair work</h2><p>Review each finding and assign repairs to your team or a vendor.</p></div>
    {!editable && <p className="notice">This inspection is being edited. Submit the updated inspection before creating new repair work.</p>}
    {findings.error && <p className="danger-text" role="alert">{findings.error.message}</p>}
    {findings.isLoading && <p role="status">Loading findings…</p>}
    {findings.data?.length === 0 && <p>No separate findings were recorded for this inspection.</p>}
    {findings.data?.map((finding) => <RepairFinding key={`${finding.id}-${finding.version}`} org={org} neighborhoodId={neighborhoodId} finding={finding} editable={editable} />)}
  </section>
}

function RepairFinding({ org, neighborhoodId, finding, editable }: { org: string; neighborhoodId: string; finding: Finding; editable: boolean }) {
  const { user, can } = useAuth()
  const cache = useQueryClient()
  const people = useParticipants(org, neighborhoodId)
  const companies = useRosterCompanies(org, neighborhoodId)
  const [open, setOpen] = useState(false)
  const [party, setParty] = useState('internal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || busy || !navigator.onLine) return
    const form = new FormData(event.currentTarget)
    const assignee = String(form.get('assignee') ?? '')
    setBusy(true); setError('')
    try {
      const payload = { organization_id: org, observation_id: finding.id, tasks: [{ title: String(form.get('title') ?? '').trim(), description: String(form.get('description') ?? '').trim(), priority: finding.priority, assignment: { accountable_internal_user_id: party === 'internal' ? assignee : null, company_id: party === 'company' ? assignee : null, due_at: new Date(String(form.get('due'))).toISOString() } }] }
      const result = await runCommand('create_observation_work', newCommand(payload, finding.version), { organizationId: org, userId: user.id, aggregateId: finding.id })
      if ('queued' in result || !result.ok) throw new Error('queued' in result ? 'Connect to assign repair work.' : result.error.message)
      await Promise.all(['inspection-observations', 'inspection', 'work-items', 'home'].map((key) => cache.invalidateQueries({ queryKey: [key] })))
      setOpen(false)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to create repair work.') } finally { setBusy(false) }
  }
  return <article className="panel form-panel stack-lg">
    <div><h3>{finding.title}</h3><p>{finding.description}</p></div>
    {(finding.work_items ?? []).map((work) => <Link key={work.id} className="text-button" to={`/org/${org}/work/${work.id}`}>{work.title} · {work.state.replaceAll('_', ' ')} →</Link>)}
    {editable && finding.status !== 'disregarded' && can('work.create') && can('work.assign') && !open && <div><button type="button" className="button secondary" onClick={() => setOpen(true)}>Add work item</button></div>}
    {open && <form className="stack-lg" onSubmit={create}>
      <label className="field">Work item title<input name="title" required maxLength={160} defaultValue={finding.title} /></label>
      <label className="field">Repair instructions<textarea name="description" required maxLength={10000} defaultValue={finding.description} /></label>
      <div className="form-grid two"><label className="field">Assign to<select value={party} onChange={(event) => setParty(event.target.value)}><option value="internal">Internal team member</option><option value="company">Vendor company</option></select></label>
      <label className="field">Assignee<select name="assignee" key={party} required defaultValue=""><option value="">Choose assignee</option>{party === 'internal' ? people.data?.map((person) => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>) : companies.data?.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
      <label className="field">Due date<input name="due" type="datetime-local" required /></label></div>
      {(people.error || companies.error || error) && <p className="danger-text" role="alert">{error || (people.error ?? companies.error)?.message}</p>}
      <div className="button-row"><button type="button" className="button ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className="button primary" disabled={busy || !navigator.onLine}>{busy ? 'Creating…' : 'Create and assign'}</button></div>
    </form>}
  </article>
}
