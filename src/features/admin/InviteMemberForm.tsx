import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MailPlus, X } from 'lucide-react'
import { ErrorState, LoadingState } from '../../components/Ui'
import { requireSupabase } from '../../lib/supabase'
import type { HomeRow, NeighborhoodRow } from '../../lib/data'
import { localDateTime, scopeLabels, useAccessCatalogs, type AccessScope } from './accessCatalogs'

export function InviteMemberForm({ organizationId, neighborhoods, homes, onClose, initialCompanyId }: { organizationId: string; neighborhoods: NeighborhoodRow[]; homes: HomeRow[]; onClose: () => void; initialCompanyId?: string }) {
  const catalogs = useAccessCatalogs(organizationId)
  const queryClient = useQueryClient()
  const [role, setRole] = useState(initialCompanyId ? 'vendor_admin' : 'internal_contributor')
  const [scope, setScope] = useState<AccessScope>('neighborhood')
  const [neighborhoodId, setNeighborhoodId] = useState('')
  const [divisionId, setDivisionId] = useState('')
  const [companyId, setCompanyId] = useState(initialCompanyId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [includeInspector, setIncludeInspector] = useState(false)
  const selectedRole = catalogs.data?.roles.find((item) => item.code === role) ?? catalogs.data?.roles.find((item) => item.code === 'trade_technician') ?? catalogs.data?.roles[0]
  const allowedScopes = selectedRole?.allowed_scope_kinds ?? []
  const selectedScope = allowedScopes.includes(scope) ? scope : allowedScopes[0] ?? 'neighborhood'
  const selectedCode = selectedRole?.code ?? ''
  const tradeRole = selectedScope === 'company' || Boolean(selectedRole?.requires_company)
  const selectedCompany = tradeRole ? companyId || (catalogs.data?.companies.length === 1 ? catalogs.data.companies[0].id : '') : ''
  const inspectorAddon = ['internal_contributor', 'vendor_admin', 'trade_technician'].includes(selectedCode) && catalogs.data?.roles.some((item) => item.code === 'inspector' && item.allowed_scope_kinds.includes(selectedScope))
  const timedGrant = catalogs.data?.context.grants.length && catalogs.data.context.grants.every((grant) => grant.ends_at) ? catalogs.data.context.grants.map((grant) => grant.ends_at!).sort().at(-1) : undefined

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedRole || busy) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true); setError(''); setMessage('')
    try {
      const grant = { role_code: selectedCode, scope_kind: selectedScope, division_id: selectedScope === 'division' ? divisionId : null,
        neighborhood_id: ['neighborhood', 'home'].includes(selectedScope) ? neighborhoodId : null,
        home_id: selectedScope === 'home' ? String(form.get('home_id') ?? '') || null : null, company_id: selectedCompany || null,
        ends_at: form.get('ends_at') ? new Date(String(form.get('ends_at'))).toISOString() : null }
      const { data, error: inviteError } = await requireSupabase().functions.invoke('invite-user', { body: {
        organization_id: organizationId,
        email: String(form.get('email')).trim(), affiliation: String(form.get('affiliation')),
        grants: [grant, ...(includeInspector && inspectorAddon ? [{ ...grant, role_code: 'inspector' }] : [])],
        company_id: selectedCompany || null, company_kind: selectedCompany ? selectedCode === 'vendor_admin' ? 'manager' : selectedCode === 'trade_technician' ? 'technician' : String(form.get('company_kind') ?? 'technician') : null
      } })
      if (inviteError) throw inviteError
      if (!data?.invitation_id) throw new Error('Invitation delivery did not complete.')
      setMessage(`Invitation sent. It expires ${new Date(data.expires_at).toLocaleString()}.`)
      formElement.reset(); setRole(initialCompanyId ? 'vendor_admin' : 'internal_contributor'); setScope('neighborhood'); setNeighborhoodId(''); setDivisionId(''); setCompanyId(initialCompanyId ?? '')
      setIncludeInspector(false)
      await queryClient.invalidateQueries({ queryKey: ['admin-invitations', organizationId] })
    } catch (caught) { setError((caught as { message?: string }).message ?? 'Invitation failed.') }
    finally { setBusy(false) }
  }

  return <form className="panel form-panel stack-lg" onSubmit={invite} aria-labelledby="invite-member-heading">
    <div className="section-heading"><div><h2 id="invite-member-heading">Invite team member</h2><p>Choose their role and the places they can access.</p></div><button type="button" className="icon-button" aria-label="Close invitation form" disabled={busy} onClick={onClose}><X /></button></div>
    {catalogs.isLoading && <LoadingState label="Loading available roles" />}
    {catalogs.isError && <ErrorState message={catalogs.error.message} retry={() => void catalogs.refetch()} />}
    <fieldset disabled={busy || !catalogs.data} className="property-fieldset form-grid two">
      <label className="field">Email address<input type="email" name="email" required autoComplete="email" /></label>
      <label className="field">Affiliation<select key={tradeRole ? 'vendor' : 'staff'} name="affiliation" defaultValue={tradeRole ? 'external' : 'internal'}><option value="internal">Internal</option><option value="external">External</option></select></label>
      <label className="field">Role<select value={selectedCode} onChange={(event) => { const next = catalogs.data?.roles.find((item) => item.code === event.target.value); setRole(event.target.value); setScope(next?.allowed_scope_kinds[0] ?? 'neighborhood'); setNeighborhoodId('') }}>{catalogs.data?.roles.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
      <label className="field">Access scope<select value={selectedScope} onChange={(event) => { setScope(event.target.value as AccessScope); setNeighborhoodId('') }}>{allowedScopes.map((item) => <option key={item} value={item}>{scopeLabels[item]}</option>)}</select></label>
      {selectedScope === 'division' && <label className="field">Division<select required value={divisionId} onChange={(event) => setDivisionId(event.target.value)}><option value="">Select division</option>{catalogs.data?.divisions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
      {['neighborhood', 'home'].includes(selectedScope) && <label className="field">Neighborhood<select required value={neighborhoodId} onChange={(event) => setNeighborhoodId(event.target.value)}><option value="">Select neighborhood</option>{neighborhoods.filter((item) => item.status === 'active' && catalogs.data?.neighborhoods.some((area) => area.id === item.id)).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
      {selectedScope === 'home' && <label className="field" key={neighborhoodId}>Home<select name="home_id" required disabled={!neighborhoodId} defaultValue=""><option value="">Select home</option>{homes.filter((item) => item.neighborhood_id === neighborhoodId).map((item) => <option value={item.id} key={item.id}>Lot {item.lot_code}{item.address_line1 ? ` · ${item.address_line1}` : ''}</option>)}</select></label>}
      {tradeRole && <label className="field">Vendor company *<select required value={selectedCompany} onChange={(event) => setCompanyId(event.target.value)}><option value="">Select a company</option>{catalogs.data?.companies.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
      {tradeRole && !['vendor_admin', 'trade_technician'].includes(selectedCode) && <label className="field">Company member type<select name="company_kind" defaultValue="technician" required><option value="technician">Technician</option><option value="manager">Manager</option></select></label>}
      <label className="field">Access ends at{timedGrant ? ' *' : ' (optional)'}<input name="ends_at" type="datetime-local" defaultValue={localDateTime(timedGrant)} required={Boolean(timedGrant)} /><small>Access cannot last longer than the authority used to grant it.</small></label>
      {inspectorAddon && <label className="check-row full-span"><input type="checkbox" checked={includeInspector} onChange={(event) => setIncludeInspector(event.target.checked)} />Also assign Inspector</label>}
      {selectedCode === 'inspector' && <p className="scope-explanation full-span">Inspector can be added to an Internal contributor or a company member. Use Vendor company scope for company-provided inspectors.</p>}
    </fieldset>
    {selectedScope === 'organization' && <p className="scope-explanation">This role applies across the entire organization. No neighborhood or home selection is needed.</p>}
    {message && <div className="notice" role="status">{message}</div>}
    {error && <ErrorState message={error} />}
    <div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !selectedRole}><MailPlus />{busy ? 'Sending…' : 'Send invitation'}</button></div>
  </form>
}
