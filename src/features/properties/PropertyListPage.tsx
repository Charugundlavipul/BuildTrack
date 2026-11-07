import { useState } from 'react'
import { managesScope, useAdministrationContext } from '../admin/hierarchy'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader, StateBadge } from '../../components/Ui'
import { isArchived, recordName, usePropertyDirectory, type PropertyKind, type PropertyRecord } from './propertyData'
import { PropertyBreadcrumbs, PropertyNavigation } from './PropertyShared'
import { propertyLabels } from './propertyConfig'

const pageSize = 20

export function PropertyListPage({ kind }: { kind: PropertyKind }) {
  const { org } = useParams()
  const [params, setParams] = useSearchParams()
  const directory = usePropertyDirectory(org)
  const authority = useAdministrationContext(org)
  const canAdd = kind === 'divisions' ? managesScope(authority.data, 'organization') : kind === 'neighborhoods' ? managesScope(authority.data, 'organization') || authority.data?.grants.some((grant) => grant.scope_kind === 'division' && (!grant.permissions || grant.permissions.includes('structure.manage'))) === true : Boolean(authority.data?.grants.some((grant) => ['organization', 'division', 'neighborhood'].includes(grant.scope_kind) && (!grant.permissions || grant.permissions.includes('structure.manage'))))
  const [page, setPage] = useState(0)
  const query = params.get('q') ?? ''
  const status = params.get('status') ?? 'active'
  const divisionId = params.get('division') ?? ''
  const neighborhoodId = params.get('neighborhood') ?? ''
  const labels = propertyLabels[kind]
  const base = `/org/${org}/properties`
  const update = (key: string, value: string) => {
    setParams((previous) => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true })
    setPage(0)
  }
  const records: PropertyRecord[] = directory.data?.[kind] ?? []
  const filtered = records.filter((record) => {
    const archived = isArchived(record)
    if (status === 'active' && archived || status === 'archived' && !archived) return false
    if (kind === 'neighborhoods' && divisionId && (!('division_id' in record) || (divisionId === 'unassigned' ? record.division_id !== null : record.division_id !== divisionId))) return false
    if (kind === 'homes' && neighborhoodId && (!('neighborhood_id' in record) || record.neighborhood_id !== neighborhoodId)) return false
    const text = 'lot_code' in record ? `${record.lot_code} ${record.address_line1 ?? ''} ${record.city ?? ''} ${record.external_reference ?? ''}` : `${record.name} ${'code' in record ? record.code : ''}`
    return text.toLowerCase().includes(query.toLowerCase().trim())
  })
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1))
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const activeCount = records.filter((record) => !isArchived(record)).length
  const childQuery = kind === 'neighborhoods' && divisionId && divisionId !== 'unassigned' ? `?division=${encodeURIComponent(divisionId)}` : kind === 'homes' && neighborhoodId ? `?neighborhood=${encodeURIComponent(neighborhoodId)}` : ''

  return <div className="stack-xl property-page">
    <PropertyBreadcrumbs />
    <PageHeader eyebrow="PROPERTY MANAGEMENT" title={labels.title} description={labels.description} actions={canAdd ? <Link className="button primary" to={`${base}/${kind}/new${childQuery}`}><Plus />Add {labels.singular}</Link> : undefined} />
    <PropertyNavigation />
    {directory.isLoading ? <LoadingState label={`Loading ${labels.title.toLowerCase()}`} /> : directory.isError ? <ErrorState message={directory.error.message} retry={() => void directory.refetch()} /> : <>
      <div className="property-directory-summary"><strong>{records.length} {kind === 'homes' ? 'homes & lots' : kind}</strong><span>{activeCount} active</span><span>{records.length - activeCount} archived / inactive</span></div>
      <section className="panel">
        <div className="property-filters">
          <label className="search-box"><Search /><span className="sr-only">Search {labels.title.toLowerCase()}</span><input value={query} onChange={(event) => update('q', event.target.value)} placeholder={kind === 'homes' ? 'Search lot, address, or reference' : `Search ${labels.title.toLowerCase()}`} /></label>
          {kind === 'neighborhoods' && <label className="field"><span className="sr-only">Filter by division</span><select aria-label="Filter by division" value={divisionId} onChange={(event) => update('division', event.target.value)}><option value="">All divisions</option><option value="unassigned">No division</option>{directory.data?.divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select></label>}
          {kind === 'homes' && <label className="field"><span className="sr-only">Filter by neighborhood</span><select aria-label="Filter by neighborhood" value={neighborhoodId} onChange={(event) => update('neighborhood', event.target.value)}><option value="">All neighborhoods</option>{directory.data?.neighborhoods.map((neighborhood) => <option key={neighborhood.id} value={neighborhood.id}>{neighborhood.name}</option>)}</select></label>}
          <label className="field"><span className="sr-only">Record status</span><select aria-label="Record status" value={status} onChange={(event) => update('status', event.target.value)}><option value="active">Active records</option><option value="archived">Archived / inactive</option><option value="all">All records</option></select></label>
        </div>
        {!visible.length ? <EmptyState title={records.length ? 'No matching records' : `No ${labels.title.toLowerCase()} yet`} description={records.length ? 'Try another search or change the filters.' : `Add a ${labels.singular} to start building your property directory.`} action={records.length ? <button className="button secondary" onClick={() => { setParams({}); setPage(0) }}>Reset filters</button> : canAdd ? <Link className="button secondary" to={`${base}/${kind}/new${childQuery}`}>Add {labels.singular}</Link> : undefined} /> : <>
          <div className="property-table-scroll"><table className="property-table"><thead><tr><th scope="col">{kind === 'homes' ? 'Home / lot' : labels.singular}</th><th scope="col">{kind === 'divisions' ? 'Neighborhoods' : kind === 'neighborhoods' ? 'Division' : 'Neighborhood'}</th><th scope="col">{kind === 'homes' ? 'Floor plan' : 'Homes'}</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Manage record</span></th></tr></thead><tbody>{visible.map((record) => {
            const childNeighborhoods = kind === 'divisions' ? directory.data?.neighborhoods.filter((item) => item.division_id === record.id) ?? [] : []
            const parentDivision = 'division_id' in record ? directory.data?.divisions.find((item) => item.id === record.division_id) : undefined
            const parentNeighborhood = 'neighborhood_id' in record ? directory.data?.neighborhoods.find((item) => item.id === record.neighborhood_id) : undefined
            const homeCount = directory.data?.homes.filter((item) => kind === 'divisions' ? childNeighborhoods.some((neighborhood) => neighborhood.id === item.neighborhood_id) : item.neighborhood_id === record.id).length ?? 0
            return <tr key={record.id}><td><Link className="property-record-title" to={kind === 'homes' ? `/org/${org}/homes/${record.id}` : `${base}/${kind}/${record.id}`}>{recordName(record)}</Link><small>{'lot_code' in record ? record.address_line1 ?? 'Address not set' : 'code' in record ? record.code : 'Operating area'}</small></td>
              <td data-label={kind === 'divisions' ? 'Neighborhoods' : kind === 'neighborhoods' ? 'Division' : 'Neighborhood'}>{kind === 'divisions' ? <Link className="text-button" to={`${base}/neighborhoods?division=${record.id}`}>{childNeighborhoods.length} neighborhoods</Link> : parentDivision ? <Link className="property-parent-link" to={`${base}/divisions/${parentDivision.id}`}>{parentDivision.name}</Link> : parentNeighborhood ? <Link className="property-parent-link" to={`${base}/neighborhoods/${parentNeighborhood.id}`}>{parentNeighborhood.name}</Link> : kind === 'homes' ? 'Neighborhood unavailable' : 'No division assigned'}</td>
              <td data-label={kind === 'homes' ? 'Floor plan' : 'Homes'}>{'lot_code' in record ? record.master_plan_name ?? 'No standard plan' : `${homeCount} homes`}</td><td data-label="Status"><StateBadge state={'status' in record ? record.status : isArchived(record) ? 'archived' : 'active'} /></td><td><Link className="button secondary" aria-label={`${kind === 'homes' ? 'Open' : 'Manage'} ${recordName(record)}`} to={kind === 'homes' ? `/org/${org}/homes/${record.id}` : `${base}/${kind}/${record.id}`}>{kind === 'homes' ? 'Open' : 'Manage'}<ChevronRight /></Link></td></tr>
          })}</tbody></table></div>
          <footer className="property-pagination"><span>{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, filtered.length)} of {filtered.length} records</span><div><button className="icon-button" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></button><button className="icon-button" aria-label="Next page" disabled={(currentPage + 1) * pageSize >= filtered.length} onClick={() => setPage(currentPage + 1)}><ChevronRight /></button></div></footer>
        </>}
      </section>
    </>}
  </div>
}
