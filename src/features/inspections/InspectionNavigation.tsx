import { NavLink, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export function InspectionNavigation() {
  const { org } = useParams()
  const { can } = useAuth()

  return <nav className="home-section-nav inspection-section-nav" aria-label="Inspection sections">
    <NavLink to={`/org/${org}/inspections`}>Inspections</NavLink>
    {can('config.manage') && <NavLink to={`/org/${org}/settings/checklists`}>Checklist creation</NavLink>}
  </nav>
}
