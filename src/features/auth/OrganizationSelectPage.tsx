import { Building2, ChevronRight } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'

export function OrganizationSelectPage() {
  const { organizations, activeOrganization, setActiveOrganization } = useAuth()
  const navigate = useNavigate()
  if (organizations.length === 1 && activeOrganization) return <Navigate replace to={`/org/${activeOrganization.id}/my-work`} />
  return (
    <main className="centered-page">
      <section className="select-card">
        <p className="eyebrow">WORKSPACE</p>
        <h1>Select an organization</h1>
        <p className="muted">Your available actions are recalculated for each tenant and scope.</p>
        <div className="organization-list">
          {organizations.map((organization) => (
            <button key={organization.id} className="organization-option" onClick={() => {
              setActiveOrganization(organization)
              navigate(`/org/${organization.id}/my-work`)
            }}>
              <span className="icon-tile"><Building2 /></span>
              <span><strong>{organization.name}</strong><small>{organization.timezone}</small></span>
              <ChevronRight />
            </button>
          ))}
          {!organizations.length && <div className="empty-state"><Building2 /><h2>No active membership</h2><p>An invitation must be accepted before organization data is available.</p></div>}
        </div>
      </section>
    </main>
  )
}
