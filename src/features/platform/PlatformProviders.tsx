import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '../../components/Ui'
import { qualityClient } from '../inspections/qualityData'
import { humanize } from '../../lib/utils'

interface Provider { id: string; name: string; status: string; contact_email: string | null; phone_number: string | null; categories: string[]; external_vendor_reference: string | null; member_count: number; coverage_count: number }
interface ProviderDetail { company: Provider & { physical_address: string | null; owner_scope_kind: string; owner_label: string }; member_total: number; coverage_total: number;
  members: Array<{ user_id: string; display_name: string; email: string; phone_number: string | null; kind: string; status: string; roles: Array<{ label: string; scope: string; effective: boolean }> }>;
  coverage: Array<{ id: string; scope: string; label: string }>
}
export function PlatformProviders({ organizationId, companyId }: { organizationId: string; companyId?: string }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [memberPage, setMemberPage] = useState(0)
  const [coveragePage, setCoveragePage] = useState(0)
  const base = `/platform/organizations/${organizationId}`
  const list = useQuery({ queryKey: ['platform-providers', organizationId, search, page], enabled: !companyId, queryFn: async () => {
    const { data, error } = await qualityClient().rpc('platform_list_providers', { p_org: organizationId, p_search: search, p_page: page })
    if (error) throw error
    return data as { rows: Provider[]; total: number }
  } })
  const detail = useQuery({ queryKey: ['platform-provider', organizationId, companyId, memberPage, coveragePage], enabled: Boolean(companyId), queryFn: async () => {
    const { data, error } = await qualityClient().rpc('platform_get_provider', { p_org: organizationId, p_company: companyId, p_member_page: memberPage, p_coverage_page: coveragePage })
    if (error) throw error
    return data as ProviderDetail
  } })
  if (companyId) return <div className="stack-lg"><Link className="text-button" to={`${base}/providers`}>← Providers</Link>{detail.isLoading && <LoadingState label="Loading provider information" />}{detail.error && <ErrorState message={detail.error.message} retry={() => void detail.refetch()} />}{detail.data && <>
    <section className="panel form-panel stack-lg"><div className="section-heading"><div><h2>{detail.data.company.name}</h2><p>{detail.data.company.categories.map(humanize).join(' · ') || 'No categories selected'}</p></div><span className="state-badge">{humanize(detail.data.company.status)}</span></div><dl className="detail-grid"><div><dt>Contact email</dt><dd>{detail.data.company.contact_email ?? 'Not supplied'}</dd></div><div><dt>Phone</dt><dd>{detail.data.company.phone_number ?? 'Not supplied'}</dd></div><div><dt>Company address</dt><dd>{detail.data.company.physical_address ?? 'Not supplied'}</dd></div><div><dt>Vendor reference</dt><dd>{detail.data.company.external_vendor_reference ?? 'Not supplied'}</dd></div><div><dt>Managed at</dt><dd>{humanize(detail.data.company.owner_scope_kind)} · {detail.data.company.owner_label}</dd></div></dl></section>
    <section className="panel form-panel stack-lg"><h2>Provider users</h2>{!detail.data.members.length ? <p>No company memberships.</p> : <div className="member-list">{detail.data.members.map((m) => <article key={m.user_id}><div><strong>{m.display_name}</strong><p>{m.email} · {m.kind === 'manager' ? 'Primary contact' : 'Secondary contact'}</p><small>{humanize(m.status)} · {m.roles.map((r) => `${r.label}${r.effective ? '' : ' (unavailable)'}`).join(', ') || 'No active roles'}</small></div><Link className="button secondary" to={`${base}/people?search=${encodeURIComponent(m.email)}`}>Manage user access</Link></article>)}</div>}<Pagination page={memberPage} total={detail.data.member_total} setPage={setMemberPage} label="users" /></section>
    <section className="panel form-panel stack-lg"><h2>Approved coverage</h2>{detail.data.coverage.map((c) => <div className="platform-coverage-row" key={c.id}><strong>{c.label}</strong><span>{humanize(c.scope)}</span></div>)}{!detail.data.coverage.length && <p>No active coverage grants.</p>}<Pagination page={coveragePage} total={detail.data.coverage_total} setPage={setCoveragePage} label="coverage areas" /></section>
  </>}</div>
  return <section className="panel form-panel stack-lg"><div><h2>Organization providers</h2><p>Provider profiles, company users, role assignments, and approved coverage.</p></div><label className="field">Search providers<input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="Company, contact email, or vendor reference" /></label>
    {list.isLoading && <LoadingState label="Loading providers" />}{list.error && <ErrorState message={list.error.message} retry={() => void list.refetch()} />}
    {list.data && (!list.data.rows.length ? <EmptyState title="No matching providers" description="Change your search or ask the organization administrator to onboard a provider." /> : <div className="platform-provider-list">{list.data.rows.map((p) => <Link className="platform-provider-row" key={p.id} to={`${base}/providers/${p.id}`}><span><strong>{p.name}</strong><small>{p.contact_email ?? 'Contact email not supplied'}</small><small>{p.categories.map(humanize).join(' · ')}</small></span><span>{humanize(p.status)} · {p.member_count} users · {p.coverage_count} coverage areas</span></Link>)}</div>)}
    {list.data && <Pagination page={page} total={list.data.total} setPage={setPage} label="providers" />}
  </section>
}
function Pagination({ page, total, setPage, label }: { page: number; total: number; setPage: (value: number) => void; label: string }) {
  return <footer className="property-pagination"><span>{total ? `${page * 25 + 1}–${Math.min(page * 25 + 25, total)}` : '0'} of {total} {label}</span><div className="button-row"><button className="button ghost" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><button className="button ghost" disabled={(page + 1) * 25 >= total} onClick={() => setPage(page + 1)}>Next</button></div></footer>
}
