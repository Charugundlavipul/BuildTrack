import { Link, useLocation, useParams } from 'react-router-dom'
import { Building2, ChevronRight, ListChecks, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { vendorRoute } from './vendorData'

export function VendorNavigation() {
  const { org } = useParams()
  const { can } = useAuth()
  const { pathname } = useLocation()
  return <nav className="property-navigation" aria-label="Vendor management">{([
    ['vendors', 'Vendors', Building2], ['rosters', 'Neighborhood rosters', ListChecks]
  ] as const).filter(([kind]) => kind === 'vendors' || can('roster.manage')).map(([kind, label, Icon]) => {
    const active = kind === 'vendors' ? !pathname.includes('/vendors/rosters') : pathname.includes(`/vendors/${kind}`)
    return <Link key={kind} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} to={vendorRoute(org!, kind)}><Icon />{label}</Link>
  })}</nav>
}

export function VendorBreadcrumbs({ children }: { children?: ReactNode }) {
  const { org } = useParams()
  return <nav className="property-breadcrumbs" aria-label="Breadcrumb"><Link to={`/org/${org}/admin`}>Administration</Link><ChevronRight /><Link to={vendorRoute(org!, 'vendors')}>Vendor management</Link>{children}</nav>
}

export function VendorManagementLink() {
  const { org } = useParams()
  const { can } = useAuth()
  if (!can('roster.manage')) return null
  return <Link className="property-entry vendor-entry" to={vendorRoute(org!, 'vendors')}><span className="icon-tile"><Wrench /></span><div className="property-entry-content"><strong>Vendor management</strong><p>Manage categorized companies, neighborhood eligibility, and vendor teams.</p><b>Open vendor directory →</b></div><ChevronRight /></Link>
}

