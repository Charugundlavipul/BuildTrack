import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Archive, ChevronRight, RotateCcw, Save } from 'lucide-react'
import { ErrorState, LoadingState, PageHeader, StateBadge } from '../../components/Ui'
import { requireSupabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/utils'
import { localDateTime } from '../admin/accessCatalogs'
import { SessionSecurityNotice } from '../admin/SessionSecurityNotice'
import { useAdminSession } from '../admin/sessionSecurity'
import { VendorBreadcrumbs, VendorNavigation } from './VendorShared'
import { VendorRosterPanel, VendorTeamPanel, VendorWorkPanel } from './VendorPanels'
import { refreshVendors, rosterEligibility, sqlNull, useVendorDirectory, useVendorAccess, vendorRecordActive, vendorRecordName, vendorRoute, vendorTitles, type Roster, type Vendor, type VendorDirectory, type VendorKind, type VendorRecord } from './vendorData'
import { CompanyProfileFields, CompanyProfilePanel } from './CompanyProfilePanel'
import { companyCategoryLabel, companyProfileData } from './companyProfileData'
import { qualityClient } from '../inspections/qualityData'
import { VendorCoveragePanel } from './VendorCoveragePanel'
import { useAuth } from '../auth/AuthProvider'
import { managesScope, ownershipScopes, useAdministrationContext } from '../admin/hierarchy'
import { scopeLabels, type AccessScope } from '../admin/accessCatalogs'

export function VendorRecordPage({ kind = 'vendors', creating = false }: { kind?: VendorKind; creating?: boolean }) {
  const { org, id } = useParams()
  const directory = useVendorDirectory(org)
  const security = useAdminSession()
  if (directory.isLoading) return <LoadingState label="Loading vendor record" />
  if (directory.isError) return <ErrorState message={directory.error.message} retry={() => void directory.refetch()} />
  if (!directory.data || !org) return null
  const row = creating ? undefined : directory.data[kind].find((item) => item.id === id)
  if (!creating && !row) return <div className="stack-lg"><Link className="text-button" to={vendorRoute(org, kind)}>← Back to directory</Link><ErrorState message="This vendor record was not found or is outside your access." /></div>
  return <VendorRecordEditor key={`${org}-${kind}-${id ?? 'new'}`} kind={kind} record={row} directory={directory.data} verified={security.data === true} securityLoading={security.isLoading} securityError={security.error} />
}

function VendorRecordEditor({ kind, record, directory, verified, securityLoading, securityError }: { kind: VendorKind; record?: VendorRecord; directory: VendorDirectory; verified: boolean; securityLoading: boolean; securityError: Error | null }) {
  const { org } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAuth()
  const authority = useAdministrationContext(org)
  const access = useVendorAccess(org, kind === 'vendors' ? record?.id : undefined)
  const [ownerScope, setOwnerScope] = useState<AccessScope>('organization')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirmStatus, setConfirmStatus] = useState(false)
  const vendor = kind === 'vendors' ? record as Vendor | undefined : undefined
  const roster = kind === 'rosters' ? record as Roster | undefined : undefined
  const [startsAt, setStartsAt] = useState(() => localDateTime(roster?.active_from ?? new Date().toISOString()))
  const active = record ? vendorRecordActive(record) : true
  const ownerScopes = ownershipScopes(authority.data)
  const selectedOwnerScope = ownerScopes.includes(ownerScope) ? ownerScope : ownerScopes[0] ?? 'neighborhood'
  const rosterArea = directory.neighborhoods.find((area) => area.id === roster?.neighborhood_id)
  const rosterLevel = managesScope(authority.data, 'organization', null, null, 'roster.manage') ? 1 : authority.data?.grants.some((grant) => grant.scope_kind === 'division' && grant.division_id === rosterArea?.division_id) ? 2 : 3
  const canCreateVendor = can('roster.manage') && (authority.data?.organization_admin === true || authority.data?.grants.some((grant) => grant.scope_kind === 'division'))
  const canEdit = kind === 'vendors' ? record ? access.data?.can_edit_company_details === true : canCreateVendor : can('roster.manage') && (!roster || managesScope(authority.data, 'neighborhood', rosterArea?.division_id, roster.neighborhood_id, 'roster.manage'))
  const canChangeStatus = kind === 'vendors' ? access.data?.can_deactivate === true : canEdit && (!roster || rosterLevel <= roster.authority_level)
  const disabled = busy || !verified || !canEdit
  const singular = kind === 'vendors' ? 'vendor' : 'eligibility'
  const title = record ? kind === 'rosters' ? 'Manage eligibility' : vendorRecordName(kind, record, directory) : `Add ${singular}`
  const initialCompany = roster?.company_id ?? directory.vendors.find((item) => item.id === params.get('company') && item.status === 'active')?.id ?? ''

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!org || disabled) return
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    setBusy(true); setError(''); setMessage('')
    try {
      const client = requireSupabase()
      let result
      if (kind === 'vendors') result = record ? await client.rpc('admin_save_company', { p_organization_id: org, p_id: record.id, p_name: text('name'), p_external_vendor_reference: text('reference') || sqlNull, p_status: vendor?.status ?? 'active' }) : await qualityClient().rpc('onboard_vendor_with_profile', {
        p_org: org, p_profile: companyProfileData(form), p_name: text('name'), p_reference: text('reference') || sqlNull, p_scope: selectedOwnerScope,
        p_division: selectedOwnerScope === 'division' ? text('owner_division_id') : sqlNull,
        p_neighborhood: selectedOwnerScope === 'neighborhood' ? text('owner_neighborhood_id') : sqlNull
      })
      else {
        const start = new Date(text('active_from')).toISOString()
        const end = text('active_to') ? new Date(text('active_to')).toISOString() : null
        if (end && new Date(end).getTime() <= new Date(start).getTime()) throw new Error('The end date must be later than the start date.')
        result = await client.rpc('admin_save_roster', { p_organization_id: org, p_id: record?.id ?? sqlNull, p_company_id: text('company_id'), p_neighborhood_id: text('neighborhood_id'), p_status: roster?.status ?? 'active', p_active_from: start, p_active_to: end ?? sqlNull })
      }
      if (result.error) throw result.error
      if (!result.data?.id) throw new Error('The saved record could not be confirmed. Refresh before trying again.')
      await refreshVendors(queryClient, org)
      if (!record) navigate(vendorRoute(org, kind, result.data.id), { replace: true })
      else setMessage(`${kind === 'rosters' ? 'Eligibility' : 'Vendor'} updated.`)
    } catch (caught) { setError((caught as { message?: string }).message ?? 'Unable to save this record.') }
    finally { setBusy(false) }
  }

  async function changeStatus() {
    if (!org || !record || disabled || !canChangeStatus) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { error: changeError } = await requireSupabase().rpc('admin_set_catalog_status', { p_organization_id: org, p_id: record.id, p_entity: kind === 'vendors' ? 'company' : 'roster', p_active: !active })
      if (changeError) throw changeError
      await refreshVendors(queryClient, org)
      setConfirmStatus(false); setMessage(`${singular[0].toUpperCase() + singular.slice(1)} ${active ? 'deactivated' : 'restored'}.`)
    } catch (caught) { setError((caught as { message?: string }).message ?? 'Unable to change this record’s status.') }
    finally { setBusy(false) }
  }

  return <div className="stack-xl vendor-page"><VendorBreadcrumbs><ChevronRight /><Link to={vendorRoute(org!, kind)}>{vendorTitles[kind]}</Link><ChevronRight /><span aria-current="page">{title}</span></VendorBreadcrumbs>
    <PageHeader eyebrow="VENDOR MANAGEMENT" title={title} description={roster ? vendorRecordName(kind, roster, directory) : 'Company details, categories, neighborhood eligibility, team, and assigned work.'} />
    <VendorNavigation />
    <SessionSecurityNotice loading={securityLoading} verified={verified} error={securityError} />
    {message && <div className="notice" role="status">{message}</div>}{error && <ErrorState message={error} />}
    {access.error && <ErrorState message={access.error.message} retry={() => void access.refetch()} />}
    {vendor && record && !canEdit && !access.isLoading && !authority.isLoading && <div className="notice">Company name, reference, approved coverage, and lifecycle are controlled by an organization administrator. Your permitted contact, team, and neighborhood actions appear below.</div>}
    <div className="property-detail-layout"><div className="stack-xl">
      <form key={`${record?.id ?? 'new'}-${record?.version ?? 0}`} className="panel form-panel stack-lg" onSubmit={save}>
        <div className="section-heading"><div><h2>{kind === 'vendors' ? 'Company details' : 'Eligibility details'}</h2><p>{record ? kind === 'vendors' && !canEdit ? 'Organization-controlled identity details.' : 'Edit the record and save your changes.' : 'Fields marked * are required.'}</p></div>{record && <StateBadge state={roster ? rosterEligibility(roster, directory) : active ? 'active' : 'inactive'} />}</div>
        <fieldset className="property-fieldset form-grid two" disabled={disabled}>
          {kind !== 'rosters' ? <><label className="field full-span">Vendor name *<input name="name" defaultValue={vendor?.name ?? ''} maxLength={160} required placeholder="e.g. Cedar Finish Carpentry" /></label>
            {kind === 'vendors' && !record && <><label className="field">Onboard under<select value={selectedOwnerScope} onChange={(event) => setOwnerScope(event.target.value as AccessScope)}>{ownerScopes.map((scope) => <option key={scope} value={scope}>{scopeLabels[scope]}</option>)}</select></label>
              {selectedOwnerScope === 'division' && <label className="field">Division *<select name="owner_division_id" required defaultValue=""><option value="">Select division</option>{directory.divisions.filter((division) => division.status === 'active' && managesScope(authority.data, 'division', division.id, null, 'roster.manage')).map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select></label>}
              {selectedOwnerScope === 'neighborhood' && <label className="field">Neighborhood *<select name="owner_neighborhood_id" required defaultValue=""><option value="">Select neighborhood</option>{directory.neighborhoods.filter((area) => area.status === 'active' && managesScope(authority.data, 'neighborhood', area.division_id, area.id, 'roster.manage')).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>}
            </>}
            <label className="field full-span">Vendor reference<input name="reference" defaultValue={vendor?.external_vendor_reference ?? ''} maxLength={160} placeholder="Optional reference in your vendor system" /></label></> : <>
            <label className="field full-span">Vendor *<select name="company_id" required defaultValue={initialCompany}><option value="">Select vendor</option>{directory.vendors.filter((item) => item.status === 'active' || item.id === roster?.company_id).map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'active' ? ' (inactive)' : ''}</option>)}</select></label>
            <label className="field">Neighborhood *<select name="neighborhood_id" required defaultValue={roster?.neighborhood_id ?? ''}><option value="">Select neighborhood</option>{directory.neighborhoods.filter((item) => item.status === 'active' || item.id === roster?.neighborhood_id).map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'active' ? ' (inactive)' : ''}</option>)}</select></label>
            <label className="field">Active from *<input name="active_from" type="datetime-local" value={startsAt} required onChange={(event) => setStartsAt(event.target.value)} /></label>
            <label className="field">Active until<input name="active_to" type="datetime-local" min={startsAt} defaultValue={localDateTime(roster?.active_to)} /><small className="muted">Leave blank for no end date.</small></label>
          </>}
          {kind === 'vendors' && !record && <CompanyProfileFields canEditEin={authority.data?.organization_admin === true} />}
        </fieldset>
        <div className="form-actions property-save-actions"><Link className="button ghost" to={vendorRoute(org!, kind)}>Back to directory</Link>{canEdit && <button className="button primary" disabled={disabled}><Save />{busy ? 'Saving…' : record ? 'Save changes' : `Create ${singular}`}</button>}</div>
      </form>
      {vendor && <CompanyProfilePanel org={org!} company={vendor} verified={verified} />}
      {vendor && <VendorCoveragePanel organizationId={org!} vendorId={vendor.id} directory={directory} verified={verified} />}
      {vendor && <VendorRosterPanel directory={directory} vendorId={vendor.id} disabled={busy || !verified || !can('roster.manage') || !active || access.data?.can_manage_eligibility !== true} />}
      {vendor && <><VendorTeamPanel vendorId={vendor.id} directory={directory} /><VendorWorkPanel vendorId={vendor.id} /></>}
    </div><aside className="stack-lg">
      <section className="panel form-panel property-context"><h2>Assignment eligibility</h2><p className="vendor-help-text">Company categories describe the vendor. Approved coverage and a current neighborhood eligibility entry control assignments.</p>{roster && <dl className="side-details"><div><dt>Vendor</dt><dd><Link to={vendorRoute(org!, 'vendors', roster.company_id)}>{directory.vendors.find((item) => item.id === roster.company_id)?.name ?? 'Unavailable'}</Link></dd></div><div><dt>Company categories</dt><dd>{directory.vendors.find((item) => item.id === roster.company_id)?.categories.map(companyCategoryLabel).join(', ') || 'None'}</dd></div><div><dt>Neighborhood</dt><dd>{directory.neighborhoods.find((item) => item.id === roster.neighborhood_id)?.name ?? 'Unavailable'}</dd></div></dl>}{record && <p className="property-updated">Last updated<br />{formatDateTime(record.updated_at)}</p>}</section>
      {record && canChangeStatus && <section className="panel form-panel property-lifecycle"><h2>{active ? 'Deactivate' : 'Restore'} {singular}</h2><p>{active ? kind === 'vendors' ? 'Active assignments must be resolved or reassigned before this vendor can be deactivated.' : 'Remove this record from active assignment eligibility. Existing history stays available.' : 'Make this record available again. Eligibility also depends on its related records and date window.'}</p>{confirmStatus ? <div className="stack-lg"><strong>{active ? 'Deactivate' : 'Restore'} this {singular}?</strong><div className="button-row"><button className="button ghost" disabled={busy} onClick={() => setConfirmStatus(false)}>Cancel</button><button className={`button ${active ? 'danger' : 'primary'}`} disabled={disabled} onClick={() => void changeStatus()}>{busy ? 'Updating…' : active ? 'Confirm deactivate' : 'Confirm restore'}</button></div></div> : <button className="button secondary" disabled={disabled} onClick={() => setConfirmStatus(true)}>{active ? <Archive /> : <RotateCcw />}{active ? 'Deactivate' : 'Restore'} {singular}</button>}</section>}
    </aside></div>
  </div>
}
