import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LockKeyhole, Plus, Trash2 } from 'lucide-react'
import { ErrorState, LoadingState } from '../../components/Ui'
import { requireSupabase, rpcNull } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { scopeLabels, type AccessScope } from '../admin/accessCatalogs'
import { managesScope, ownershipScopes, useAdministrationContext } from '../admin/hierarchy'
import { refreshVendors, useVendorAccess, type VendorDirectory } from './vendorData'

export function VendorCoveragePanel({ organizationId, vendorId, directory, verified }: { organizationId: string; vendorId: string; directory: VendorDirectory; verified: boolean }) {
  const access = useVendorAccess(organizationId, vendorId)
  const authority = useAdministrationContext(organizationId)
  const { can } = useAuth()
  const cache = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [scope, setScope] = useState<AccessScope>('division')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const options = ownershipScopes(authority.data)
  const selectedScope = options.includes(scope) ? scope : options[0] ?? 'neighborhood'
  const companyActive = directory.vendors.find((vendor) => vendor.id === vendorId)?.status === 'active'
  async function change(event?: FormEvent<HTMLFormElement>, grantId?: string) {
    event?.preventDefault()
    if (!verified || busy) return
    const form = event ? new FormData(event.currentTarget) : null
    setBusy(true); setError('')
    try {
      const { error } = await requireSupabase().rpc('admin_set_vendor_coverage', {
        p_organization_id: organizationId, p_company_id: vendorId,
        p_scope: selectedScope, p_division_id: selectedScope === 'division' ? String(form?.get('division_id') ?? '') || rpcNull : rpcNull,
        p_neighborhood_id: selectedScope === 'neighborhood' ? String(form?.get('neighborhood_id') ?? '') || rpcNull : rpcNull,
        p_grant_id: grantId ?? rpcNull, p_active: !grantId
      })
      if (error) throw error
      await refreshVendors(cache, organizationId)
      setAdding(false); setConfirmRemove(null)
    } catch (caught) { setError((caught as { message?: string }).message ?? 'Could not update vendor coverage.') }
    finally { setBusy(false) }
  }
  return <section className="panel form-panel stack-lg" aria-labelledby="vendor-coverage-heading">
    <div className="section-heading"><div><h2 id="vendor-coverage-heading">Approved coverage</h2><p>{access.data ? `Onboarded under ${access.data.owner_label}. Organization admins control coverage; local admins control neighborhood eligibility.` : 'Locations where this vendor may work.'}</p></div>{can('roster.manage') && access.data?.can_manage_coverage && options.length > 0 && companyActive && <button className="button secondary" disabled={!verified || busy} onClick={() => setAdding(!adding)}><Plus />Add coverage</button>}</div>
    {access.isLoading && <LoadingState label="Loading vendor coverage" />}
    {access.error && <ErrorState message={access.error.message} retry={() => void access.refetch()} />}
    {error && <ErrorState message={error} />}
    <div className="vendor-roster-list">{access.data?.coverage.map((grant) => <article key={grant.id}><span><strong>{grant.label}</strong><small>{scopeLabels[grant.scope_kind]}{!grant.can_remove ? ' · Protected access' : ''}</small></span>{grant.can_remove && can('roster.manage') ? confirmRemove === grant.id ? <span className="button-row"><button className="button ghost" disabled={busy} onClick={() => setConfirmRemove(null)}>Cancel</button><button className="button danger" disabled={!verified || busy} onClick={() => void change(undefined, grant.id)}>Confirm removal</button></span> : <button className="button ghost" disabled={!verified || busy} onClick={() => setConfirmRemove(grant.id)}><Trash2 />Remove coverage</button> : <span className="muted"><LockKeyhole size={16} />Protected</span>}</article>)}</div>
    {adding && <form onSubmit={(event) => void change(event)} className="stack-lg access-editor"><h3>Add a location</h3><fieldset disabled={!verified || busy} className="property-fieldset form-grid two">
      <label className="field">Coverage level<select value={selectedScope} onChange={(event) => setScope(event.target.value as AccessScope)}>{options.map((value) => <option key={value} value={value}>{scopeLabels[value]}</option>)}</select></label>
      {selectedScope === 'division' && <label className="field">Division<select name="division_id" required defaultValue=""><option value="">Select division</option>{directory.divisions.filter((division) => division.status === 'active' && managesScope(authority.data, 'division', division.id, null, 'roster.manage')).map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select></label>}
      {selectedScope === 'neighborhood' && <label className="field">Neighborhood<select name="neighborhood_id" required defaultValue=""><option value="">Select neighborhood</option>{directory.neighborhoods.filter((area) => area.status === 'active' && managesScope(authority.data, 'neighborhood', area.division_id, area.id, 'roster.manage')).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>}
    </fieldset><div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={() => setAdding(false)}>Cancel</button><button className="button primary" disabled={!verified || busy}>{busy ? 'Saving…' : 'Save coverage'}</button></div></form>}
  </section>
}
