import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader, StateBadge } from '../../components/Ui'
import { formatDateTime } from '../../lib/utils'
import { VendorBreadcrumbs, VendorNavigation } from './VendorShared'
import { rosterEligibility, useVendorDirectory, vendorRecordActive, vendorRecordName, vendorRoute, vendorTitles, type VendorKind, type VendorRecord } from './vendorData'
import { useAdministrationContext } from '../admin/hierarchy'
import { companyCategoryLabel } from './companyProfileData'

export function VendorDirectoryPage({ kind = 'vendors' }: { kind?: VendorKind }) {
  const { org } = useParams()
  const directory = useVendorDirectory(org)
  const authority = useAdministrationContext(org)
  const { can } = useAuth()
  const canAdd = can('roster.manage') && (kind === 'rosters' || authority.data?.organization_admin === true || authority.data?.grants.some((grant) => grant.scope_kind === 'division'))
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(0)
  const query = params.get('q') ?? ''
  const status = params.get('status') ?? (kind === 'rosters' ? 'all' : 'active')
  const companyId = params.get('company') ?? ''
  const neighborhoodId = params.get('neighborhood') ?? ''
  const update = (key: string, value: string) => { setPage(0); setParams((previous) => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true }) }
  const data = directory.data
  const records: VendorRecord[] = data?.[kind] ?? []
  const filtered = records.filter((row) => {
    if (!data) return false
    if (kind === 'rosters' && 'company_id' in row) {
      if (status !== 'all' && rosterEligibility(row, data) !== status) return false
      if (companyId && row.company_id !== companyId || neighborhoodId && row.neighborhood_id !== neighborhoodId) return false
    } else {
      if (status === 'active' && !vendorRecordActive(row) || status === 'inactive' && vendorRecordActive(row)) return false
      if (kind === 'vendors' && neighborhoodId && !data.rosters.some((roster) => roster.company_id === row.id && roster.neighborhood_id === neighborhoodId)) return false
    }
    const vendor = 'company_id' in row ? data.vendors.find((item) => item.id === row.company_id) : row
    const search = `${vendorRecordName(kind, row, data)} ${vendor && 'external_vendor_reference' in vendor ? vendor.external_vendor_reference ?? '' : ''} ${vendor && 'categories' in vendor ? vendor.categories.join(' ') : ''}`
    return search.toLowerCase().includes(query.toLowerCase().trim())
  })
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 20) - 1))
  const visible = filtered.slice(currentPage * 20, currentPage * 20 + 20)
  const newLabel = kind === 'vendors' ? 'Add vendor' : 'Add eligibility'

  return <div className="stack-xl vendor-page"><VendorBreadcrumbs />
    <PageHeader eyebrow="VENDOR MANAGEMENT" title={vendorTitles[kind]} description={kind === 'vendors' ? 'Manage categorized trade partners, their teams, and where they can receive assignments.' : 'Control which vendors can work in each neighborhood and during which dates.'} actions={canAdd ? <Link className="button primary" to={`${vendorRoute(org!, kind, 'new')}${kind === 'rosters' && companyId ? `?company=${companyId}` : ''}`}><Plus />{newLabel}</Link> : undefined} />
    <VendorNavigation />
    {directory.isLoading && <LoadingState label="Loading vendor directory" />}
    {directory.isError && <ErrorState message={directory.error.message} retry={() => void directory.refetch()} />}
    {data && <><div className="property-directory-summary"><strong>{records.length} records</strong><span>{kind === 'rosters' ? `${data.rosters.filter((row) => rosterEligibility(row, data) === 'eligible').length} currently eligible` : `${records.filter(vendorRecordActive).length} active`}</span></div>
      <section className="panel"><div className="property-filters">
        <label className="search-box"><Search /><span className="sr-only">Search {vendorTitles[kind].toLowerCase()}</span><input value={query} onChange={(event) => update('q', event.target.value)} placeholder={kind === 'vendors' ? 'Search vendor, reference, or category' : 'Search vendor or neighborhood'} /></label>
        {kind === 'rosters' && <label className="field"><span className="sr-only">Filter by vendor</span><select aria-label="Filter by vendor" value={companyId} onChange={(event) => update('company', event.target.value)}><option value="">All vendors</option>{data.vendors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <label className="field"><span className="sr-only">Filter by neighborhood</span><select aria-label="Filter by neighborhood" value={neighborhoodId} onChange={(event) => update('neighborhood', event.target.value)}><option value="">All neighborhoods</option>{data.neighborhoods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span className="sr-only">Record status</span><select aria-label="Record status" value={status} onChange={(event) => update('status', event.target.value)}>{(kind === 'rosters' ? [['all', 'All eligibility states'], ['eligible', 'Currently eligible'], ['scheduled', 'Scheduled'], ['expired', 'Expired'], ['inactive', 'Inactive']] : [['active', 'Active records'], ['inactive', 'Inactive / archived'], ['all', 'All records']]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {!visible.length ? <EmptyState title={records.length ? 'No matching records' : `No ${vendorTitles[kind].toLowerCase()} yet`} description={records.length ? 'Try another search or change the filters.' : 'Add a record to start managing this directory.'} action={records.length ? <button className="button secondary" onClick={() => { setParams({}); setPage(0) }}>Reset filters</button> : canAdd ? <Link className="button secondary" to={vendorRoute(org!, kind, 'new')}>{newLabel}</Link> : undefined} /> : <div className="property-table-scroll"><table className="property-table vendor-table"><thead><tr><th scope="col">Vendor</th><th scope="col">{kind === 'vendors' ? 'Eligible neighborhoods' : 'Neighborhood'}</th><th scope="col">{kind === 'vendors' ? 'Team' : 'Active window'}</th><th scope="col">{kind === 'rosters' ? 'Eligibility' : 'Status'}</th><th scope="col"><span className="sr-only">Manage record</span></th></tr></thead><tbody>{visible.map((row) => {
        const related = data.rosters.filter((roster) => roster.company_id === row.id && rosterEligibility(roster, data) === 'eligible')
        const memberships = data.memberships.filter((item) => item.company_id === row.id && !item.revoked_at && new Date(item.active_from).getTime() <= data.checkedAt && (!item.active_to || new Date(item.active_to).getTime() > data.checkedAt))
        const vendor = 'company_id' in row ? data.vendors.find((item) => item.id === row.company_id) : row
        return <tr key={row.id}><td><Link className="property-record-title" to={vendorRoute(org!, kind, row.id)}>{'company_id' in row ? vendor?.name ?? 'Vendor' : vendorRecordName(kind, row, data)}</Link><small>{vendor && 'categories' in vendor && vendor.categories.length ? vendor.categories.map(companyCategoryLabel).join(', ') : 'No company category'}</small></td>
          <td data-label={kind === 'vendors' ? 'Eligible neighborhoods' : 'Neighborhood'}>{'neighborhood_id' in row ? data.neighborhoods.find((item) => item.id === row.neighborhood_id)?.name ?? 'Unavailable' : new Set(related.map((roster) => roster.neighborhood_id)).size}</td>
          <td data-label={kind === 'vendors' ? 'Team' : 'Active window'}>{'active_from' in row ? <span className="vendor-date-window">{formatDateTime(row.active_from)}<small>Until {row.active_to ? formatDateTime(row.active_to) : 'no end date'}</small></span> : `${memberships.length} members`}</td>
          <td data-label={kind === 'rosters' ? 'Eligibility' : 'Status'}><StateBadge state={'neighborhood_id' in row ? rosterEligibility(row, data) : row.status} /></td><td><Link className="button secondary" aria-label={`Manage ${vendorRecordName(kind, row, data)}`} to={vendorRoute(org!, kind, row.id)}>Manage<ChevronRight /></Link></td></tr>
      })}</tbody></table></div>}
      {!!visible.length && <footer className="property-pagination"><span>{currentPage * 20 + 1}–{Math.min(currentPage * 20 + 20, filtered.length)} of {filtered.length} records</span><div><button className="icon-button" aria-label="Previous page" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></button><button className="icon-button" aria-label="Next page" disabled={(currentPage + 1) * 20 >= filtered.length} onClick={() => setPage(currentPage + 1)}><ChevronRight /></button></div></footer>}
      </section>
    </>}
  </div>
}
