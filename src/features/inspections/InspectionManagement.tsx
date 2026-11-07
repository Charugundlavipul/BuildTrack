import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorState } from '../../components/Ui'
import { useAuth } from '../auth/AuthProvider'
import { qualityClient } from './qualityData'
import { newCommand, runCommand } from '../../lib/commands'
import type { InspectionRow } from '../../lib/data'
import { InspectionObservationReview } from './InspectionObservations'
import { ObservationReview } from './ObservationPanels'
import { InspectionRepairPlanning } from './InspectionRepairPlanning'

export function InspectionManagement({ org, inspection, refresh }: { org: string; inspection: InspectionRow; refresh: () => Promise<unknown> }) {
  const { user, can } = useAuth()
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const options = useQuery({ queryKey: ['inspection-allocation', org, inspection.id, inspection.version], enabled: Boolean(inspection.company_id && (can('company.users.manage') || can('inspection.manage'))), queryFn: async () => {
    const { data, error } = await qualityClient().rpc('inspection_allocation_options', { p_organization_id: org, p_inspection_id: inspection.id })
    if (error) throw error
    return data as Array<{ user_id: string; display_name: string }>
  } })
  async function command(name: string, payload: Record<string, unknown>) {
    if (!user || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await runCommand(name, newCommand({ organization_id: org, inspection_id: inspection.id, ...payload }, inspection.version), { organizationId: org, userId: user.id, aggregateId: inspection.id })
      if ('queued' in result) throw new Error('Inspection management requires a connection.')
      if (!result.ok) throw new Error(result.error.message)
      await Promise.all([refresh(), cache.invalidateQueries({ queryKey: ['inspections', org] })]); setMessage('Inspection updated.')
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  function allocate(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); void command('allocate_inspection', { inspector_user_id: form.get('inspector'), reason: form.get('reason') }) }
  return <div className="stack-lg">{error && <ErrorState message={error} />}{message && <div className="notice" role="status">{message}</div>}
    {inspection.company_id && !inspection.lead_inspector_user_id && <div className="notice warning">This inspection is assigned to a company. Its manager must select an Inspector before field work can begin.</div>}
    {inspection.company_id && options.data && ['draft', 'in_progress', 'amended'].includes(inspection.status) && <form className="panel form-panel stack-lg" onSubmit={allocate} aria-label="Assign company Inspector"><h2>Assign a company Inspector</h2><div className="form-grid two"><label className="field">Inspector<select name="inspector" required defaultValue={inspection.lead_inspector_user_id ?? ''}><option value="">Choose eligible company Inspector</option>{options.data.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></label><label className="field">Assignment / reassignment reason<input name="reason" maxLength={1000} required /></label></div>{!options.data.length && <p className="muted">Invite a company member with the Inspector role, or add Inspector to an existing member.</p>}<div><button className="button primary" disabled={busy || !options.data.length}>Save Inspector assignment</button></div></form>}
    {options.error && <ErrorState message={options.error.message} />}
    {inspection.status === 'amended' && can('inspection.manage') && <InspectionRepairPlanning org={org} id={inspection.id} neighborhoodId={inspection.neighborhood_id} editable={false} />}
    {inspection.status === 'submitted' && can('inspection.manage') && <><InspectionObservationReview org={org} inspectionId={inspection.id} homeId={inspection.home_id} neighborhoodId={inspection.neighborhood_id} />{!inspection.reviewed_at && <ObservationReview hideWhenEmpty org={org} inspectionId={inspection.id} homeId={inspection.home_id} neighborhoodId={inspection.neighborhood_id} />}<section className="panel form-panel stack-lg"><h2>Report review</h2>{inspection.reviewed_at && <p className="notice">This report has been reviewed. Repair and reinspection decisions remain on each observation.</p>}{inspection.escalated_at && !inspection.escalation_resolved_at && <div className="notice warning"><strong>Area manager review requested</strong><p>{inspection.escalation_reason}</p><button className="button secondary" disabled={busy} onClick={() => void command('review_inspection', { action: 'resolve' })}>Resolve area manager review</button></div>}<details open={!inspection.reviewed_at}><summary>{inspection.reviewed_at ? 'Request another area manager review' : 'Record report review'}</summary><form className="stack-lg" onSubmit={(event) => { event.preventDefault(); void command('review_inspection', { action: 'escalate', reason: new FormData(event.currentTarget).get('reason') }) }}><label className="field">Reason for area manager review<textarea name="reason" required maxLength={2000} /></label><div className="button-row"><button className="button secondary" disabled={busy}>Request area manager review</button>{!inspection.reviewed_at && <button type="button" className="button primary" disabled={busy || Boolean(inspection.escalated_at && !inspection.escalation_resolved_at)} onClick={() => void command('review_inspection', { action: 'complete' })}>Complete report review</button>}</div></form></details></section></>}
  </div>
}
