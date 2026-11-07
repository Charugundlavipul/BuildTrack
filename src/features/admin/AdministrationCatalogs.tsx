import { Link } from 'react-router-dom'
import { PropertyManagementLinks } from '../properties/PropertyShared'
import { VendorManagementLink } from '../vendors/VendorShared'
import { useAuth } from '../auth/AuthProvider'
import { configuration, type ConfigurationKind } from '../settings/configurationData'

export function AdministrationCatalogs({ organizationId }: { organizationId: string; aal: string }) {
  const { can, access } = useAuth()
  const isOrgAdmin = Boolean(access?.roles.some((role) => role.scope_kind === 'organization') && can('access.manage'))
  return (
    <div className="stack-xl">
      <PropertyManagementLinks />
      <VendorManagementLink />
      <section className="panel form-panel stack-lg">
        <h2>Operational configuration</h2>
        <p>Find existing records, manage their details, and review their current status.</p>
        <div className="configuration-records">
          {isOrgAdmin && (
            <Link className="configuration-row" to={`/org/${organizationId}/roles`}>
              <span>
                <strong>Role catalog</strong>
                <small>Manage enabled workspace roles and create custom organization roles.</small>
              </span>
              <span>Manage →</span>
            </Link>
          )}
          {(Object.keys(configuration) as ConfigurationKind[])
            .filter((kind) => {
              if (configuration[kind].orgAdminOnly && !isOrgAdmin) return false
              return can(configuration[kind].permission)
            })
            .map((kind) => (
              <Link className="configuration-row" key={kind} to={`/org/${organizationId}/settings/${kind}`}>
                <span>
                  <strong>{configuration[kind].title}</strong>
                  <small>{configuration[kind].description}</small>
                </span>
                <span>Manage →</span>
              </Link>
            ))}
        </div>
      </section>
    </div>
  )
}
