import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, Save, ShieldCheck } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { requireSupabase, rpcNull } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useAdminSession } from '../admin/sessionSecurity'
import { SessionSecurityNotice } from '../admin/SessionSecurityNotice'
import { scopeLabels, type AccessScope } from '../admin/accessCatalogs'
import { useAdministrationContext } from '../admin/hierarchy'
import { useRoleCatalog, type CatalogPermission, type CatalogRole } from './platformData'

const administrative = ['structure.manage', 'access.manage', 'roster.manage', 'config.manage']
const scopes: AccessScope[] = ['organization', 'division', 'neighborhood', 'home', 'company']

export function OrganizationRolePage({ creating = false }: { creating?: boolean }) {
  const { org, roleCode } = useParams()
  const security = useAdminSession()
  const authority = useAdministrationContext(org)
  if (authority.isLoading) return <LoadingState label="Checking organization administrator access" />
  if (authority.error) return <ErrorState message={authority.error.message} retry={() => void authority.refetch()} />
  if (!authority.data?.organization_admin) {
    return (
      <section className="panel empty-state" role="alert">
        <h1>Access not granted</h1>
        <p>Role catalog management is restricted to Org Admins. Ask an Org Admin to review role definitions or availability.</p>
      </section>
    )
  }
  return <div className="stack-xl"><Link className="text-button" to={`/org/${org}/admin`}>← Administration</Link><SessionSecurityNotice loading={security.isLoading} error={security.error} verified={security.data} /><RoleCatalogPage organizationId={org} basePath={`/org/${org}/roles`} roleCode={roleCode} creating={creating} verified={security.data === true} /></div>
}

export function RoleCatalogPage({ organizationId, basePath, roleCode, creating = false, verified, embedded = false }: { organizationId?: string; basePath: string; roleCode?: string; creating?: boolean; verified: boolean; embedded?: boolean }) {
  const catalog = useRoleCatalog(organizationId)
  const { refreshAccess } = useAuth()
  const cache = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('enabled')
  const [confirmation, setConfirmation] = useState<CatalogRole | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const role = catalog.data?.roles.find((item) => item.code === roleCode)
  const draft = (location.state as { copyRole?: CatalogRole } | null)?.copyRole
  const editable = !role || role.organization_id === (organizationId ?? null)
  const title = creating ? 'Create role' : roleCode ? role?.label ?? 'Role' : 'Organization roles'
  const actions = !roleCode && !creating ? <Link className="button primary" to={`${basePath}/new`}><Plus />Create role</Link> : role && <button className="button secondary" onClick={() => navigate(`${basePath}/new`, { state: { copyRole: role } })}><Copy />{organizationId && !editable ? 'Copy as organization role' : 'Copy role'}</button>
  const rows = (catalog.data?.roles ?? []).filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase().trim()) && (filter === 'all' || filter === 'enabled' && item.enabled && item.active || filter === 'removed' && item.release_state !== 'planned' && (!item.enabled || !item.active) || filter === 'planned' && item.release_state === 'planned' || filter === 'private' && item.organization_id === organizationId))
  async function refresh() {
    await Promise.all([cache.invalidateQueries({ queryKey: ['role-catalog'] }), cache.invalidateQueries({ queryKey: ['admin-access-catalogs'] })])
    await refreshAccess()
  }
  async function changeAvailability() {
    if (!confirmation || !organizationId || !verified) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { error } = await requireSupabase().rpc('set_organization_role', { p_organization_id: organizationId, p_role_code: confirmation.code, p_enabled: !confirmation.enabled })
      if (error) throw new Error(error.message)
      await refresh(); setMessage(`${confirmation.label} ${confirmation.enabled ? 'removed from' : 'enabled for'} this organization.`); setConfirmation(null)
    } catch (caught) { setError((caught as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="stack-xl">
    {(roleCode || creating) && <Link className="text-button" to={basePath}>← Organization roles</Link>}
    {embedded ? <div className="section-heading"><div><h2>{title}</h2><p>Manage the roles available to this organization.</p></div>{actions}</div> : <PageHeader eyebrow="ORGANIZATION ACCESS" title={title} description="Enable standard role templates or create custom roles that belong to this organization." actions={actions} />}
    {catalog.isLoading && <LoadingState label="Loading role catalog" />}{catalog.error && <ErrorState message={catalog.error.message} retry={() => void catalog.refetch()} />}
    {message && <div className="notice" role="status">{message}</div>}{error && <div className="notice danger" role="alert">{error}</div>}
    {confirmation && <section className="panel form-panel stack-lg" aria-label="Confirm role availability"><h2>{confirmation.enabled ? 'Remove' : 'Enable'} {confirmation.label}?</h2><p>{confirmation.enabled ? 'Existing grants stop providing this role’s permissions. Their history remains, and enabling the role again restores eligible grants.' : 'This role becomes assignable here. Existing eligible grants for this role become effective again.'} {confirmation.assignment_count} current grants are affected.</p><div className="button-row"><button className="button primary" disabled={busy || !verified} onClick={() => void changeAvailability()}>Confirm {confirmation.enabled ? 'removal' : 'enablement'}</button><button className="button ghost" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button></div></section>}
    {catalog.data && (roleCode || creating ? !creating && !role ? <ErrorState message="This role is not in this catalog." /> : <RoleEditor key={`${roleCode ?? 'new'}-${role?.version ?? 0}-${location.key}`} organizationId={organizationId} role={role} copy={creating ? draft : undefined} permissions={catalog.data.permissions} editable={editable} verified={verified} onSaved={async (code) => { await refresh(); setMessage('Role saved.'); navigate(`${basePath}/${code}`, { replace: true, state: null }) }} /> : <section className="panel form-panel stack-lg"><div className="form-grid two"><label className="field">Search roles<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="field">Show<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All roles</option><option value="planned">Planned role</option><option value="enabled">Enabled here</option><option value="removed">Removed or unavailable</option>{organizationId && <option value="private">Organization-specific roles</option>}</select></label></div>{!rows.length ? <EmptyState title="No matching roles" description="Change the filters or create a role." /> : <div className="role-directory">{rows.map((item) => <article className="role-directory-row" key={item.code}><div><Link className="property-record-title" to={`${basePath}/${item.code}`}>{item.label}</Link><p>{item.description || `${item.permissions.length} permissions · ${item.allowed_scope_kinds.map((scope) => scopeLabels[scope]).join(', ')}`}</p><div className="role-meta"><span>{item.organization_id ? 'Organization role' : 'Standard template'}</span><span>{item.release_state === 'planned' ? 'Planned role' : !item.active ? 'Retired' : item.enabled ? 'Enabled' : 'Unavailable'}</span><span>{item.assignment_count} current grants</span></div></div><div className="button-row"><Link className="button secondary" to={`${basePath}/${item.code}`}>{organizationId && !item.organization_id ? 'View role' : 'Edit role'}</Link>{organizationId && <button className="button ghost" disabled={!verified || busy || item.release_state === 'planned' || !item.active && !item.enabled} onClick={() => { setError(''); setConfirmation(item) }}>{item.enabled ? 'Remove from organization' : 'Enable role'}</button>}</div></article>)}</div>}</section>)}
  </div>
}

function RoleEditor({ organizationId, role, copy, permissions, editable, verified, onSaved }: { organizationId?: string; role?: CatalogRole; copy?: CatalogRole; permissions: CatalogPermission[]; editable: boolean; verified: boolean; onSaved: (code: string) => Promise<void> }) {
  const source = role ?? copy
  const [selected, setSelected] = useState(source?.permissions ?? [])
  const [allowed, setAllowed] = useState<AccessScope[]>(source?.allowed_scope_kinds ?? ['neighborhood', 'home'])
  const [company, setCompany] = useState(source?.requires_company ?? false)
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState(false)
  const [error, setError] = useState('')
  const admin = selected.some((permission) => administrative.includes(permission))
  const configAdmin = selected.includes('config.manage')
  const companyAdmin = selected.includes('company.users.manage') && !admin
  const scopeSupported = (scope: AccessScope) => configAdmin ? scope === 'organization' : admin ? ['organization', 'division', 'neighborhood'].includes(scope) : companyAdmin ? scope === 'company' : true
  const groups = [...new Set(permissions.map((permission) => permission.code.split('.')[0]))]
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editable || !verified || busy) return
    if (!selected.length || !allowed.length) { setError('Choose at least one permission and one allowed scope.'); return }
    if (role && !review) { setReview(true); return }
    const data = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      const { data: result, error } = await requireSupabase().rpc('save_role_definition', {
        p_organization_id: organizationId ?? rpcNull, p_code: role?.code ?? rpcNull, p_label: String(data.get('label')).trim(), p_description: String(data.get('description')).trim(),
        p_scopes: allowed, p_permissions: selected, p_active: data.get('active') === 'on', p_default: false, p_requires_company: company, p_expected_version: role?.version
      })
      if (error) throw new Error(error.message)
      await onSaved((result as { code: string }).code)
    } catch (caught) { setError((caught as Error).message); setReview(false) }
    finally { setBusy(false) }
  }
  return <form className="panel form-panel stack-lg catalog-role-editor" onSubmit={save}>
    {!editable && <div className="notice"><ShieldCheck />This standard role template provides built-in workspace permissions. Copy it to create an independently editable organization role.</div>}
    {role?.release_state === 'planned' && <p className="notice">Planned role — this role is not available for invitations or assignments.</p>}
    <fieldset className="configuration-fields stack-lg" disabled={!editable || !verified || busy} onChange={() => setReview(false)}>
      <div className="form-grid two"><label className="field">Role name<input name="label" required minLength={2} maxLength={120} defaultValue={role?.label ?? (copy ? `${copy.label} copy` : '')} /></label><label className="field">Description<input name="description" maxLength={2000} defaultValue={source?.description ?? ''} /></label></div>
      <fieldset><legend>Allowed assignment scopes</legend><div className="weekday-options">{scopes.map((scope) => <label key={scope} className="check-row"><input type="checkbox" checked={allowed.includes(scope)} disabled={!scopeSupported(scope)} onChange={(event) => setAllowed((current) => event.target.checked ? [...current, scope] : current.filter((value) => value !== scope))} /><span>{scopeLabels[scope]}</span></label>)}</div>{admin && <p className="fine-print">Administration stays inside the selected organization, division, or neighborhood. Organization-wide configuration requires organization scope.</p>}</fieldset>
      <label className="check-row"><input type="checkbox" checked={company} disabled={admin || companyAdmin} onChange={(event) => setCompany(event.target.checked)} /><span>Require company membership for every scope</span></label>
      <section className="stack-lg"><h2>Permissions <span className="muted">{selected.length} selected</span></h2><div className="permission-groups">{groups.map((group) => <fieldset key={group}><legend>{({ plan: 'Floor plans', company: 'Company users', structure: 'Properties', access: 'People and roles', roster: 'Vendors', work: 'Work', inspection: 'Inspections', comment: 'Comments', evidence: 'Evidence', report: 'Reports', audit: 'Audit', config: 'Configuration', milestone: 'Milestones' } as Record<string, string>)[group] ?? group}</legend>{permissions.filter((permission) => permission.code.startsWith(`${group}.`)).map((permission) => <label className="check-row" key={permission.code}><input type="checkbox" checked={selected.includes(permission.code)} onChange={(event) => { setSelected((current) => event.target.checked ? [...current, permission.code] : current.filter((code) => code !== permission.code)); if (event.target.checked && permission.code === 'config.manage') { setAllowed(['organization']); setCompany(false) } else if (event.target.checked && administrative.includes(permission.code)) { setAllowed((current) => { const next = current.filter((scope) => ['organization', 'division', 'neighborhood'].includes(scope)); return next.length ? next : ['organization'] }); setCompany(false) } else if (event.target.checked && permission.code === 'company.users.manage' && !admin) { setAllowed(['company']); setCompany(true) } }} /><span>{permission.description}</span></label>)}</fieldset>)}</div></section>
      <label className="check-row"><input type="checkbox" name="active" defaultChecked={source?.active ?? true} disabled={role?.release_state === 'planned'} /><span>Role is active</span></label>
    </fieldset>
    {error && <div className="notice danger" role="alert">{error}</div>}
    {review && <div className="notice warning" role="status">Saving changes affects {role?.assignment_count ?? 0} current grants. Removing permissions or retiring this role changes their access immediately.</div>}
    {editable && <div className="form-actions"><button className="button primary" disabled={!verified || busy}><Save />{busy ? 'Saving…' : review ? 'Confirm role changes' : role ? 'Review changes' : 'Create role'}</button></div>}
  </form>
}
