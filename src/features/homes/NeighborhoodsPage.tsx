import { Link, useParams } from 'react-router-dom'
import { ArrowUpRight, Home, MapPinned } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { useHomes, useNeighborhoods } from '../../lib/data'

export function NeighborhoodsPage() {
  const { org } = useParams()
  const neighborhoods = useNeighborhoods(org)
  return <div className="stack-xl"><PageHeader eyebrow="AUTHORIZED PORTFOLIO" title="Neighborhoods" description="Your scope controls which communities, homes, and work details appear here." />
    {neighborhoods.isLoading && <LoadingState label="Loading neighborhoods" />}
    {neighborhoods.isError && <ErrorState message={neighborhoods.error.message} retry={() => void neighborhoods.refetch()} />}
    {!neighborhoods.isLoading && !neighborhoods.data?.length && <EmptyState title="No neighborhoods in scope" description="Ask an administrator to review your role assignments." />}
    <section className="card-grid">{neighborhoods.data?.map((item) => <Link className="neighborhood-card" to={`/org/${org}/neighborhoods/${item.id}`} key={item.id}><div className="card-top"><span className="icon-tile"><MapPinned /></span><span className="state-badge state-active"><span />{item.status}</span></div><h2>{item.name}</h2><p>{item.code} · {item.timezone ?? 'Organization timezone'}</p><dl className="compact-stats"><div><dt>Homes</dt><dd>{item.home_count ?? 0}</dd></div><div><dt>Open</dt><dd>{item.open_count ?? 0}</dd></div><div><dt>Overdue</dt><dd className="danger-text">{item.overdue_count ?? 0}</dd></div></dl><span className="card-link">Open neighborhood <ArrowUpRight /></span></Link>)}</section>
  </div>
}

export function NeighborhoodDetailPage() {
  const { org, id } = useParams()
  const neighborhoods = useNeighborhoods(org)
  const current = neighborhoods.data?.find((item) => item.id === id)
  const homes = useHomes(org, id)
  return <div className="stack-xl"><PageHeader eyebrow={current?.code ?? 'NEIGHBORHOOD'} title={current?.name ?? 'Neighborhood'} description="Readiness reflects current inspections and work; it is not a municipal or closing approval." />
    {homes.isLoading && <LoadingState label="Loading homes" />}
    {homes.isError && <ErrorState message={homes.error.message} retry={() => void homes.refetch()} />}
    <section className="panel"><div className="section-heading"><h2><Home />Homes</h2><span>{homes.data?.length ?? 0} in scope</span></div><div className="home-list">{homes.data?.map((home) => <Link to={`/org/${org}/homes/${home.id}`} className="home-row" key={home.id}><span className="lot-tile">{home.lot_code}</span><span><strong>{home.address_line1 ?? 'Address pending'}</strong><small>{home.phase.replaceAll('_', ' ')}</small></span><span className={`readiness readiness-${home.readiness}`}>{home.readiness.replaceAll('_', ' ')}</span><span><strong>{home.open_count ?? 0}</strong><small>open items</small></span><ArrowUpRight /></Link>)}</div></section>
  </div>
}
