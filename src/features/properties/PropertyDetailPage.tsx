import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Archive, ArrowUpRight, ChevronRight, Plus, RotateCcw, Save } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader, StateBadge } from '../../components/Ui'
import { requireSupabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/utils'
import { useAuth } from '../auth/AuthProvider'
import { HomePlanPanel } from './HomePlanPanel'
import { usePlans, qualityClient } from '../inspections/qualityData'
import { HomeLayoutFields } from './HomeLayoutFields'
import { HomeLocationsPanel } from './HomeLocationsPanel'
import { isArchived, recordName, refreshProperties, sqlNull, usePropertyDirectory, type PropertyDirectory, type PropertyHome, type PropertyKind, type PropertyRecord, type Neighborhood } from './propertyData'
import { PropertyBreadcrumbs, PropertyNavigation, PropertySecurityNotice } from './PropertyShared'
import { propertyLabels, usePropertySecurity } from './propertyConfig'
import { managesScope, useAdministrationContext } from '../admin/hierarchy'

export function PropertyDetailPage({ kind, creating = false, embedded = false }: { kind: PropertyKind; creating?: boolean; embedded?: boolean }) {
  const { org, id } = useParams()
  const directory = usePropertyDirectory(org)
  const security = usePropertySecurity()
  const record = creating ? undefined : directory.data?.[kind].find((item) => item.id === id)
  if (directory.isLoading) return <LoadingState label="Loading property record" />
  if (directory.isError) return <ErrorState message={directory.error.message} retry={() => void directory.refetch()} />
  if (!directory.data || !org) return null
  if (!creating && !record) return <div className="stack-lg"><Link className="text-button" to={`/org/${org}/properties/${kind}`}>← Back to {propertyLabels[kind].title.toLowerCase()}</Link><ErrorState message="This record was not found or is outside your access." /></div>
  return <PropertyRecordPage key={`${org}-${kind}-${id ?? 'new'}`} embedded={embedded} kind={kind} record={record} directory={directory.data} verified={security.data === true} securityLoading={security.isLoading} securityError={security.error} />
}

function PropertyRecordPage({ kind, record, directory, verified, securityLoading, securityError, embedded }: { kind: PropertyKind; record?: PropertyRecord; directory: PropertyDirectory; verified: boolean; securityLoading: boolean; securityError: Error | null; embedded: boolean }) {
  const { org } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeOrganization } = useAuth()
  const authority = useAdministrationContext(org)
  const plans = usePlans(org)
  const [layoutMode, setLayoutMode] = useState('')
  const [manualSpaces, setManualSpaces] = useState<Array<{ type: string; name: string }>>([])
  const [onboardingRequest] = useState(() => crypto.randomUUID())
  const [selectedNeighborhood, setSelectedNeighborhood] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirmArchive, setConfirmArchive] = useState(false)
  const labels = propertyLabels[kind]
  const base = `/org/${org}/properties`
  const home = kind === 'homes' ? record as PropertyHome | undefined : undefined
  const neighborhood = kind === 'neighborhoods' ? record as Neighborhood | undefined : undefined
  const parentNeighborhood = home ? directory.neighborhoods.find((item) => item.id === home.neighborhood_id) : undefined
  const parentDivision = directory.divisions.find((item) => item.id === (neighborhood?.division_id ?? parentNeighborhood?.division_id))
  const archived = record ? isArchived(record) : false
  const requestedDivision = params.get('division')
  const requestedNeighborhood = params.get('neighborhood')
  const initialDivision = neighborhood?.division_id ?? directory.divisions.find((item) => item.id === requestedDivision && item.status === 'active')?.id ?? ''
  const initialNeighborhood = home?.neighborhood_id ?? directory.neighborhoods.find((item) => item.id === requestedNeighborhood && item.status === 'active')?.id ?? ''
  const unavailableParent = !record && (kind === 'neighborhoods' && requestedDivision && !initialDivision || kind === 'homes' && requestedNeighborhood && !initialNeighborhood)
  const canEdit = kind === 'divisions' ? record ? managesScope(authority.data, 'division', record.id) : managesScope(authority.data, 'organization')
    : kind === 'neighborhoods' ? record ? managesScope(authority.data, 'neighborhood', neighborhood?.division_id, record.id) : managesScope(authority.data, 'organization') || authority.data?.grants.some((grant) => grant.scope_kind === 'division' && (!grant.permissions || grant.permissions.includes('structure.manage'))) === true
      : home ? managesScope(authority.data, 'home', parentNeighborhood?.division_id, home.neighborhood_id) : authority.data?.grants.some((grant) => ['organization', 'division', 'neighborhood'].includes(grant.scope_kind)) === true
  const disabled = busy || !verified || !canEdit
  const title = record ? recordName(record) : `Add ${labels.singular}`
  const location = home ? [home.address_line1, home.city, home.state_code, home.postal_code].filter(Boolean).join(', ') : undefined

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!org || disabled) return
    const form = new FormData(event.currentTarget)
    const value = (name: string) => String(form.get(name) ?? '').trim()
    const optional = (name: string) => value(name) || sqlNull
    setBusy(true); setError(''); setMessage('')
    try {
      const client = requireSupabase()
      let saved: PropertyRecord | null = null
      if (kind === 'divisions') {
        const result = await client.rpc('admin_save_division', { p_organization_id: org, p_id: record?.id ?? sqlNull, p_name: value('name'), p_status: record && 'status' in record ? record.status : 'active' })
        if (result.error) throw result.error
        saved = result.data
      } else if (kind === 'neighborhoods') {
        const result = await client.rpc('admin_save_neighborhood', { p_organization_id: org, p_id: record?.id ?? sqlNull, p_division_id: form.has('division_id') ? optional('division_id') : neighborhood?.division_id ?? sqlNull, p_code: value('code'), p_name: value('name'), p_timezone: optional('timezone'), p_status: neighborhood?.status ?? 'active', p_supervisor_user_id: neighborhood?.supervisor_user_id ?? sqlNull })
        if (result.error) throw result.error
        saved = result.data
      } else {
        const result = !record ? await qualityClient().rpc('onboard_home_layout', {
          p_org: org, p_request: onboardingRequest, p_mode: layoutMode, p_plan: layoutMode === 'plan' ? form.get('master_plan_id') : null, p_spaces: layoutMode === 'manual' ? manualSpaces : [],
          p_details: Object.fromEntries(['neighborhood_id','lot_code','address_line1','address_line2','city','state_code','postal_code','external_reference'].map((name) => [name, value(name) || null]))
        }) : await client.rpc('admin_save_home', { p_organization_id: org, p_id: record.id, p_neighborhood_id: value('neighborhood_id'), p_lot_code: value('lot_code'), p_address_line1: optional('address_line1'), p_address_line2: optional('address_line2'), p_city: optional('city'), p_state_code: optional('state_code'), p_postal_code: optional('postal_code'), p_phase: home?.phase ?? 'planned', p_external_reference: optional('external_reference'), p_primary_supervisor_user_id: home?.primary_supervisor_user_id ?? sqlNull, p_archived: archived })
        if (result.error) throw result.error
        saved = result.data
      }
      if (!saved?.id) throw new Error('The record could not be confirmed. Refresh the directory before trying again.')
      await refreshProperties(queryClient, org)
      if (!record) navigate(kind === 'homes' ? `/org/${org}/homes/${saved.id}?tab=details` : `${base}/${kind}/${saved.id}`, { replace: true, state: { created: true } })
      else setMessage(`${recordName(saved)} updated.`)
    } catch (caught) { setError((caught as { message?: string }).message ?? 'Unable to save this record.') }
    finally { setBusy(false) }
  }

  async function changeStatus() {
    if (!org || !record || disabled) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { error: changeError } = await requireSupabase().rpc('admin_set_catalog_status', { p_organization_id: org, p_entity: kind === 'divisions' ? 'division' : kind === 'neighborhoods' ? 'neighborhood' : 'home', p_id: record.id, p_active: archived })
      if (changeError) throw changeError
      await refreshProperties(queryClient, org)
      setMessage(`${title} ${archived ? 'restored' : 'archived'}.`); setConfirmArchive(false)
    } catch (caught) { setError((caught as { message?: string }).message ?? 'Unable to change this record’s status.') }
    finally { setBusy(false) }
  }

  return <div className="stack-xl property-page">
    {!embedded && <><PropertyBreadcrumbs><ChevronRight /><Link to={`${base}/${kind}`}>{labels.title}</Link><ChevronRight /><span aria-current="page">{title}</span></PropertyBreadcrumbs>
    <PageHeader eyebrow={record ? `MANAGE ${labels.singular.toUpperCase()}` : 'NEW PROPERTY RECORD'} title={title} description={location ?? (record ? kind === 'divisions' ? 'Division details and its neighborhood portfolio.' : 'Community details and its home inventory.' : `Create a ${labels.singular} in your organization.`)} actions={record && kind !== 'divisions' ? <Link className="button secondary" to={`/org/${org}/${kind}/${record.id}`}><ArrowUpRight />View neighborhood homes</Link> : undefined} />
    <PropertyNavigation /></>}
    <PropertySecurityNotice loading={securityLoading} verified={verified} error={securityError} />
    {unavailableParent && <div className="notice warning">The selected parent record is unavailable or inactive. Choose an active parent before saving.</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {error && <ErrorState message={error} />}
    <div className={embedded ? 'stack-xl' : 'property-detail-layout'}>
      <div className="stack-xl">
        <form key={`${record?.id ?? 'new'}-${record?.version ?? 0}`} className="panel form-panel stack-lg" onSubmit={save}>
          <div className="section-heading"><div><h2>{kind === 'homes' ? 'Home & lot details' : `${kind === 'divisions' ? 'Division' : 'Neighborhood'} details`}</h2><p>{record ? 'Update this record, then save your changes.' : 'Fields marked * are required.'}</p></div>{record && <StateBadge state={'status' in record ? record.status : archived ? 'archived' : 'active'} />}</div>
          <fieldset className="property-fieldset form-grid two" disabled={disabled}>
            {kind === 'divisions' && <label className="field full-span">Division name *<input name="name" defaultValue={record && 'name' in record ? record.name : ''} required maxLength={120} placeholder="e.g. Triangle region" /></label>}
            {kind === 'neighborhoods' && <>
              <label className="field full-span">Neighborhood name *<input name="name" defaultValue={neighborhood?.name ?? ''} required maxLength={160} placeholder="e.g. Cedar Grove" /></label>
              <label className="field">Neighborhood code *<input name="code" defaultValue={neighborhood?.code ?? ''} required maxLength={40} placeholder="e.g. CG" /></label>
              <label className="field">Division<select name="division_id" defaultValue={initialDivision} required={!authority.data?.organization_admin || Boolean(requestedDivision)} disabled={Boolean(record && !managesScope(authority.data, 'division', neighborhood?.division_id))}><option value="">No division assigned</option>{directory.divisions.filter((item) => (item.status === 'active' && managesScope(authority.data, 'division', item.id)) || item.id === neighborhood?.division_id).map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'active' ? ' (inactive)' : ''}</option>)}</select></label>
              <label className="field full-span">Timezone<input name="timezone" defaultValue={neighborhood?.timezone ?? ''} placeholder={activeOrganization?.timezone ?? 'America/New_York'} /><small className="muted">Leave blank to use the organization timezone.</small></label>
            </>}
            {kind === 'homes' && <>
              <label className="field">Lot code *<input name="lot_code" defaultValue={home?.lot_code ?? ''} required maxLength={80} placeholder="e.g. 104" /></label>
              <label className="field">Neighborhood *<select name="neighborhood_id" required value={selectedNeighborhood || initialNeighborhood} onChange={(event) => { setSelectedNeighborhood(event.target.value); setLayoutMode(''); setManualSpaces([]) }}><option value="">Select neighborhood</option>{directory.neighborhoods.filter((item) => (item.status === 'active' && managesScope(authority.data, 'neighborhood', item.division_id, item.id)) || item.id === home?.neighborhood_id).map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'active' ? ' (inactive)' : ''}</option>)}</select></label>
              {!record && <HomeLayoutFields mode={layoutMode} setMode={setLayoutMode} spaces={manualSpaces} setSpaces={setManualSpaces} plans={plans.data?.filter((plan) => plan.active && plan.division_id === directory.neighborhoods.find((area) => area.id === (selectedNeighborhood || initialNeighborhood))?.division_id) ?? []} /> }
              <label className="field full-span">Street address<input name="address_line1" defaultValue={home?.address_line1 ?? ''} autoComplete="address-line1" maxLength={240} placeholder="104 Cedar Grove Boulevard" /></label>
              <label className="field full-span">Address line 2<input name="address_line2" defaultValue={home?.address_line2 ?? ''} autoComplete="address-line2" maxLength={240} /></label>
              <label className="field">City<input name="city" defaultValue={home?.city ?? ''} autoComplete="address-level2" maxLength={120} /></label>
              <div className="form-grid two"><label className="field">State<input name="state_code" defaultValue={home?.state_code ?? ''} autoComplete="address-level1" maxLength={2} /></label><label className="field">Postal code<input name="postal_code" defaultValue={home?.postal_code ?? ''} autoComplete="postal-code" maxLength={20} /></label></div>
              <label className="field">External reference<input name="external_reference" defaultValue={home?.external_reference ?? ''} maxLength={160} placeholder="Optional reference in another system" /></label>
            </>}
          </fieldset>
          <div className="form-actions property-save-actions">{!embedded && <Link className="button ghost" to={`${base}/${kind}`}>Back to directory</Link>}<button className="button primary" disabled={disabled}><Save />{busy ? 'Saving…' : record ? 'Save changes' : `Create ${labels.singular}`}</button></div>
        </form>
        {record && kind !== 'homes' && <RelatedProperties kind={kind} record={record} directory={directory} canAdd={canEdit} />}
        {home && org && <HomePlanPanel org={org} homeId={home.id} disabled={disabled || archived} />}
        {home && org && <HomeLocationsPanel organizationId={org} homeId={home.id} disabled={disabled || archived} />}
      </div>
      <aside className="stack-lg">
        {!embedded && <section className="panel form-panel property-context"><h2>Property hierarchy</h2><ol><li><span className="property-hierarchy-label">Organization</span><strong>{activeOrganization?.name}</strong></li>
          {parentDivision && <li><span className="property-hierarchy-label">Division</span><Link to={`${base}/divisions/${parentDivision.id}`}>{parentDivision.name}</Link></li>}
          {parentNeighborhood && <li><span className="property-hierarchy-label">Neighborhood</span><Link to={`${base}/neighborhoods/${parentNeighborhood.id}`}>{parentNeighborhood.name}</Link></li>}
          <li><span className="property-hierarchy-label">{labels.singular}</span><strong>{title}</strong></li></ol>
          {record && <p className="property-updated">Last updated<br />{formatDateTime(record.updated_at)}</p>}
        </section>}
        {!record && <section className="property-help"><h2>{kind === 'divisions' ? 'Start with the operating area' : kind === 'neighborhoods' ? 'A community for your homes' : 'One record per lot'}</h2><p>{kind === 'divisions' ? 'After creating this division, add its neighborhoods from the division page.' : kind === 'neighborhoods' ? 'After creating this neighborhood, add its homes and lots from the neighborhood page.' : 'After creating this home, its work, inspections, details, and rooms are available together.'}</p></section>}
        {record && canEdit && <section className="panel form-panel property-lifecycle"><h2>{archived ? 'Restore record' : 'Archive record'}</h2><p>{archived ? 'Make this record active again in the property directory.' : 'Move this record out of the active directory. Its history stays available.'}{!archived && kind === 'divisions' && ' Neighborhoods and homes retain their own status.'}</p>
          {confirmArchive ? <div className="stack-lg"><p><strong>{archived ? 'Restore' : 'Archive'} {title}?</strong>{!archived && kind !== 'divisions' && ' Open work must be resolved first.'}</p><div className="button-row"><button className="button ghost" disabled={busy} onClick={() => setConfirmArchive(false)}>Cancel</button><button className={`button ${archived ? 'primary' : 'danger'}`} disabled={disabled} onClick={() => void changeStatus()}>{busy ? 'Updating…' : archived ? 'Confirm restore' : 'Confirm archive'}</button></div></div> : <button className="button secondary" disabled={disabled} onClick={() => setConfirmArchive(true)}>{archived ? <RotateCcw /> : <Archive />}{archived ? 'Restore' : 'Archive'} {labels.singular}</button>}
        </section>}
      </aside>
    </div>
  </div>
}

function RelatedProperties({ kind, record, directory, canAdd }: { kind: PropertyKind; record: PropertyRecord; directory: PropertyDirectory; canAdd: boolean }) {
  const { org } = useParams()
  const [search, setSearch] = useState('')
  const childKind = kind === 'divisions' ? 'neighborhoods' : 'homes'
  const items = childKind === 'neighborhoods' ? directory.neighborhoods.filter((item) => item.division_id === record.id) : directory.homes.filter((item) => item.neighborhood_id === record.id)
  const filtered = items.filter((item) => `${recordName(item)} ${'address_line1' in item ? item.address_line1 ?? '' : item.code}`.toLowerCase().includes(search.toLowerCase()))
  const parentParam = kind === 'divisions' ? 'division' : 'neighborhood'
  const base = `/org/${org}/properties/${childKind}`
  return <section className="panel"><div className="section-heading"><div><h2>{childKind === 'homes' ? 'Homes & lots' : 'Neighborhoods'} <span className="property-count">{items.length}</span></h2><p>{kind === 'divisions' ? 'Communities assigned to this division.' : 'Home records assigned to this neighborhood.'}</p></div>{!canAdd ? null : isArchived(record) ? <button className="button secondary" disabled title="Restore this record before adding child records"><Plus />Add {propertyLabels[childKind].singular}</button> : <Link className="button secondary" to={`${base}/new?${parentParam}=${record.id}`}><Plus />Add {propertyLabels[childKind].singular}</Link>}</div>
    {!!items.length && <div className="property-child-search"><label className="field"><span className="sr-only">Search within this {propertyLabels[kind].singular}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${childKind}`} /></label></div>}
    {!filtered.length && <EmptyState title={items.length ? 'No matching records' : `No ${childKind} yet`} description={items.length ? 'Try another search.' : `Add a ${propertyLabels[childKind].singular} to ${recordName(record)}.`} />}
    <div className="property-child-list">{filtered.slice(0, 20).map((item) => <Link key={item.id} to={childKind === 'homes' ? `/org/${org}/homes/${item.id}` : `${base}/${item.id}`}><span><strong>{recordName(item)}</strong><small>{'address_line1' in item ? item.address_line1 ?? 'Address not set' : item.code}</small></span><StateBadge state={isArchived(item) ? 'archived' : 'active'} /><ChevronRight /></Link>)}</div>
    {!!items.length && <div className="property-list-footer"><Link className="text-button" to={`${base}?${parentParam}=${record.id}&status=all`}>View all {items.length} {childKind}<ArrowUpRight /></Link></div>}
  </section>
}
