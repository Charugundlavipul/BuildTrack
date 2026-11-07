import { ChevronRight } from 'lucide-react'
import { Link, NavLink, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { PropertyKind } from './propertyData'
import { propertyLabels } from './propertyConfig'

export function PropertyNavigation() {
  const { org } = useParams()
  return <nav className="property-navigation" aria-label="Property management">{(Object.keys(propertyLabels) as PropertyKind[]).map((kind) => {
    const { title, icon: Icon } = propertyLabels[kind]
    return <NavLink key={kind} to={`/org/${org}/properties/${kind}`} className={({ isActive }) => isActive ? 'active' : ''}><Icon />{title}</NavLink>
  })}</nav>
}

export function PropertyManagementLinks() {
  const { org } = useParams()
  const { can } = useAuth()
  if (!can('structure.manage')) return null
  return <section className="stack-lg"><div><h2>Property management</h2><p className="muted">Open a directory to manage existing records or add to your portfolio.</p></div><div className="property-entry-grid">{(Object.keys(propertyLabels) as PropertyKind[]).map((kind) => {
    const { title, description, icon: Icon } = propertyLabels[kind]
    return <Link className="property-entry" key={kind} to={`/org/${org}/properties/${kind}`}><span className="icon-tile"><Icon /></span><div className="property-entry-content"><strong>{title}</strong><p>{description}</p><b>Manage {title.toLowerCase()} →</b></div></Link>
  })}</div></section>
}

export function PropertyBreadcrumbs({ children }: { children?: ReactNode }) {
  const { org } = useParams()
  return <nav className="property-breadcrumbs" aria-label="Breadcrumb"><Link to={`/org/${org}/admin`}>Administration</Link><ChevronRight /><Link to={`/org/${org}/properties/divisions`}>Property management</Link>{children}</nav>
}

export { SessionSecurityNotice as PropertySecurityNotice } from '../admin/SessionSecurityNotice'
