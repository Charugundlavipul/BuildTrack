import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronRight, LogOut, MailPlus, Plus, Save, UserRound } from 'lucide-react'
import { ErrorState, LoadingState, PageHeader, EmptyState } from '../../components/Ui'
import { useAuth } from '../auth/AuthProvider'
import { requireSupabase, rpcNull } from '../../lib/supabase'
import { functionErrorMessage } from '../../lib/functionError'
import { formatDateTime, humanize } from '../../lib/utils'
import { PlatformProviders } from './PlatformProviders'
import { PlatformConfiguration } from './PlatformConfiguration'
import { OrganizationOperations } from './OrganizationOperations'
import { Brand } from '../../components/Brand'
import { usePlatformAccess, type OrganizationDetail, type PlatformOrganization, useWorkspaceDefaults } from './platformData'

export function PlatformPage({ mode = 'organizations', creating = false }: { mode?: 'organizations' | 'organization' | 'settings'; creating?: boolean }) {
  const access = usePlatformAccess()
  const { user, organizations, signOut } = useAuth()
  const { organizationId, providerId } = useParams()
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && menuRef.current) { menuRef.current.open = false; menuRef.current.querySelector<HTMLElement>('summary')?.focus(); setMenu(false) } }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [])
  if (access.isLoading) return <main className="centered-page"><LoadingState label="Checking platform access" /></main>
  if (access.error) return <main className="centered-page"><ErrorState message={access.error.message} retry={() => void access.refetch()} /></main>
  if (!access.data?.administrator) return <main className="centered-page"><section className="panel form-panel stack-lg"><h1>Platform access not granted</h1><p>This portal is restricted to Super Admins. Organization roles do not grant platform access.</p><Link className="button secondary" to="/organizations/select">Organization workspaces</Link></section></main>
  const navigation = <><NavLink to="/platform/organizations" onClick={() => { if (menuRef.current) menuRef.current.open = false }}><Building2 />Organizations</NavLink><NavLink to="/platform/settings" onClick={() => { if (menuRef.current) menuRef.current.open = false }}>Global settings & catalogs</NavLink></>
  return <div className="platform-shell">
    <header className="platform-header"><Link className="platform-brand" to="/platform/organizations"><Brand subtitle="Super Admin" /></Link><nav className="platform-desktop-nav" aria-label="Platform navigation">{navigation}</nav><details className="platform-mobile-nav" ref={menuRef} onToggle={(event) => setMenu(event.currentTarget.open)}><summary aria-label="Platform navigation" aria-expanded={menu}>Menu</summary><nav aria-label="Mobile platform navigation">{navigation}<NavLink to="/account" onClick={() => { if (menuRef.current) menuRef.current.open = false }}><UserRound />My profile</NavLink></nav></details><div className="platform-user"><Link to="/account" aria-label="My profile">{user?.email}</Link><button className="icon-button" aria-label="Sign out of platform administration" onClick={() => void signOut()}><LogOut /></button></div></header>
    <main className="platform-content">{organizations.length > 0 && <Link className="text-button" to="/organizations/select" state={{ explicit: true }}>Organization workspaces <ChevronRight /></Link>}
      {mode === 'settings' ? <PlatformConfiguration /> : mode === 'organization' && organizationId ? <OrganizationRecord id={organizationId} providerId={providerId} /> : creating ? <OrganizationForm /> : <OrganizationDirectory />}
    </main>
  </div>
}

function OrganizationDirectory() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const records = useQuery({ queryKey: ['platform-organizations', search, status, page], queryFn: async () => {
    const { data, error } = await requireSupabase().rpc('platform_list_organizations', { p_search: search, p_status: status, p_page: page })
    if (error) throw error
    return data as unknown as { rows: PlatformOrganization[]; total: number }
  } })
  return <div className="stack-xl"><PageHeader eyebrow="INTERNAL OPERATIONS" title="Organizations" description="Onboard organizations, manage their lifecycle, and oversee workspace operations." actions={<Link className="button primary" to="/platform/organizations/new"><Plus />Onboard organization</Link>} /><section className="panel form-panel stack-lg"><div className="form-grid two"><label className="field">Search organizations<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} /></label><label className="field">Organization status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}><option value="">All statuses</option>{['active', 'suspended', 'archived'].map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label></div>
    {records.isLoading && <LoadingState label="Loading organizations" />}{records.error && <ErrorState message={records.error.message} retry={() => void records.refetch()} />}
    {records.data && (!records.data.rows.length ? <EmptyState title="No matching organizations" description="Change the filters or onboard an organization." /> : <><div className="platform-org-directory">{records.data.rows.map((organization) => <Link key={organization.id} to={`/platform/organizations/${organization.id}`} className="platform-org-row"><span className="icon-tile"><Building2 /></span><span><strong>{organization.name}</strong><small>{organization.timezone} · {organization.administrator_email ?? 'Existing organization'}</small></span><span className="state-badge">{humanize(organization.status)}</span><span>{organization.onboarding_status === 'ready' ? `${organization.member_count ?? 0} active members` : 'Awaiting administrator'}</span><ChevronRight /></Link>)}</div><footer className="property-pagination"><span>{page * 25 + 1}–{Math.min(page * 25 + 25, records.data.total)} of {records.data.total} organizations</span><div className="button-row"><button className="button ghost" disabled={!page || records.isFetching} onClick={() => setPage(page - 1)}>Previous</button><button className="button ghost" disabled={(page + 1) * 25 >= records.data.total || records.isFetching} onClick={() => setPage(page + 1)}>Next</button></div></footer></>)}
    </section></div>
}

function OrganizationRecord({ id, providerId }: { id: string; providerId?: string }) {
  const location = useLocation()
  const section = location.pathname.includes(`/organizations/${id}/providers`) ? 'providers' : location.pathname.endsWith('/people') ? 'people' : location.pathname.endsWith('/pricing') ? 'pricing' : location.pathname.endsWith('/access') ? 'access' : location.pathname.endsWith('/activity') ? 'activity' : 'details'
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const record = useQuery({ queryKey: ['platform-organization', id], refetchOnWindowFocus: false, queryFn: async () => {
    const { data, error } = await requireSupabase().rpc('platform_get_organization', { p_id: id })
    if (error) throw error
    return data as unknown as OrganizationDetail
  } })
  async function invite() {
    setBusy(true); setError(''); setMessage('')
    try {
      const { data, error } = await requireSupabase().functions.invoke('platform-invite', { body: { organization_id: id } })
      if (error) throw error
      if (!data?.invitation_id) throw new Error('Delivery was not confirmed. Check invitation history before retrying.')
      setMessage('Administrator invitation sent. It expires in seven days.'); setConfirm(false)
    } catch (caught) { setError(await functionErrorMessage(caught, 'Invitation delivery failed. The organization remains available here for retry.')) }
    finally { await cache.invalidateQueries({ queryKey: ['platform-organization', id] }); setBusy(false) }
  }
  if (record.isLoading) return <LoadingState label="Loading organization" />
  if (record.error) return <ErrorState message={record.error.message} retry={() => void record.refetch()} />
  if (!record.data) return null
  const { organization, onboarding, invitations, activity } = record.data
  const base = `/platform/organizations/${id}`
  return <div className="stack-xl"><Link className="text-button" to="/platform/organizations">← Organizations</Link><PageHeader eyebrow={organization.onboarding_status === 'ready' ? 'ORGANIZATION' : 'ONBOARDING · AWAITING ADMINISTRATOR'} title={organization.name} description={`${organization.timezone} · ${humanize(organization.status)}`} />
    <nav className="home-section-nav platform-organization-nav" aria-label="Organization administration"><Link to={base} aria-current={section === 'details' ? 'page' : undefined}>Details & onboarding</Link><Link to={`${base}/people`} aria-current={section === 'people' ? 'page' : undefined}>People & invitations</Link><Link to={`${base}/providers`} aria-current={section === 'providers' ? 'page' : undefined}>Providers</Link><Link to={`${base}/pricing`} aria-current={section === 'pricing' ? 'page' : undefined}>Pricing</Link><Link to={`${base}/access`} aria-current={section === 'access' ? 'page' : undefined}>Access & lifecycle</Link><Link to={`${base}/activity`} aria-current={section === 'activity' ? 'page' : undefined}>Activity</Link></nav>
    {section === 'providers' ? <PlatformProviders key={`${id}-${providerId ?? 'list'}`} organizationId={id} companyId={providerId} /> : section === 'people' || section === 'pricing' || section === 'access' ? <OrganizationOperations key={`${id}-${section}`} organization={organization} section={section} /> : section === 'activity' ? <section className="panel form-panel"><h2>Recent platform activity</h2><p className="fine-print">Latest 20 platform events for this organization.</p>{!activity.length ? <p>No platform events yet.</p> : <ol className="timeline">{activity.map((event, index) => <li key={index}><span className="timeline-dot" /><div><strong>{humanize(event.action.replaceAll('.', ' '))}</strong><time>{formatDateTime(event.created_at)}</time></div></li>)}</ol>}</section> : <>
      {organization.onboarding_status !== 'ready' && onboarding && <section className="panel form-panel stack-lg"><h2>Invite the first administrator</h2><p>{onboarding.administrator_email} will receive an invitation to claim this organization. No membership is granted until the invitation is accepted with the matching verified email.</p>{confirm ? <div className="notice warning stack-lg"><p>Send an administrator invitation to {onboarding.administrator_email}? Any earlier pending onboarding link for this email will stop working.</p><div className="button-row"><button className="button primary" disabled={busy || organization.status !== 'active'} onClick={() => void invite()}>{busy ? 'Sending…' : 'Confirm and send invitation'}</button><button className="button ghost" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></div></div> : <button className="button primary" disabled={organization.status !== 'active'} onClick={() => setConfirm(true)}><MailPlus />{invitations.length ? 'Send replacement invitation' : 'Send administrator invitation'}</button>}{message && <div className="notice" role="status">{message}</div>}{error && <div className="notice danger" role="alert">{error}</div>}</section>}
      <OrganizationForm key={id} record={organization} onboarding={onboarding} />
      <section className="panel form-panel stack-lg"><h2>Administrator invitation history</h2><p className="fine-print">Latest 20 invitations. Delivery failure does not remove the organization.</p>{!invitations.length ? <p>No invitations sent yet.</p> : <div className="member-list">{invitations.map((invitation) => <div key={invitation.id}><span><strong>{invitation.normalized_email}</strong><small>{invitation.status === 'pending' && new Date(invitation.expires_at).getTime() < record.dataUpdatedAt ? 'Expired' : humanize(invitation.status)} · expires {formatDateTime(invitation.expires_at)}</small>{invitation.delivery_error && <small className="danger-text">{invitation.delivery_error}</small>}</span></div>)}</div>}</section>
    </>}
  </div>
}

function OrganizationForm({ record, onboarding }: { record?: PlatformOrganization; onboarding?: OrganizationDetail['onboarding'] }) {
  const defaults = useWorkspaceDefaults()
  const [timezone, setTimezone] = useState<string | null>(null)
  const pending = !record || record.onboarding_status === 'pending_admin'
  const cache = useQueryClient()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const status = record?.status ?? 'active'
  const [administratorRole, setAdministratorRole] = useState(onboarding?.administrator_role_code ?? '')
  const [requestId] = useState(() => {
    if (record) return crypto.randomUUID()
    const existing = sessionStorage.getItem('buildtrack.platform.organization-request')
    const id = existing ?? crypto.randomUUID()
    sessionStorage.setItem('buildtrack.platform.organization-request', id)
    return id
  })
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    const form = new FormData(event.currentTarget)
    setBusy(true); setError(''); setMessage('')
    try {
      const { data, error } = await requireSupabase().rpc('platform_save_organization', { p_id: record?.id ?? rpcNull, p_name: String(form.get('name')).trim(), p_timezone: String(form.get('timezone')).trim(), p_status: status, p_administrator_email: String(form.get('email') ?? ''), p_administrator_role_code: String(form.get('administrator_role') ?? ''), p_request_id: requestId, p_expected_version: record?.version })
      if (error) throw new Error(error.message)
      const saved = data as unknown as OrganizationDetail
      await Promise.all([cache.invalidateQueries({ queryKey: ['platform-organizations'] }), cache.invalidateQueries({ queryKey: ['platform-organization'] })])
      if (!record) { sessionStorage.removeItem('buildtrack.platform.organization-request'); navigate(`/platform/organizations/${saved.organization.id}`, { replace: true }) }
      else { setMessage('Organization updated.') }
    } catch (caught) { setError((caught as Error).message) }
    finally { setBusy(false) }
  }
  const administrators = onboarding?.administrator_role_code && onboarding.administrator_role_code !== 'org_admin'
    ? [{ code: 'org_admin', label: 'Org Admin' }, { code: onboarding.administrator_role_code, label: humanize(onboarding.administrator_role_code) }]
    : [{ code: 'org_admin', label: 'Org Admin' }]
  return <div className="stack-xl">{!record && <><Link className="text-button" to="/platform/organizations">← Organizations</Link><PageHeader eyebrow="ONBOARDING" title="Onboard organization" description="Create the workspace and invite its first Org Admin." /></>}
    <form className="panel form-panel stack-lg platform-organization-form" onSubmit={save}><h2>{record ? 'Organization details' : 'Workspace and administrator'}</h2><fieldset disabled={busy} className="configuration-fields stack-lg"><div className="form-grid two"><label className="field">Organization name<input name="name" required minLength={2} maxLength={160} defaultValue={record?.name ?? ''} /></label><label className="field">Timezone<input name="timezone" required value={timezone ?? record?.timezone ?? defaults.data?.default_timezone ?? 'America/New_York'} onChange={(event) => setTimezone(event.target.value)} /><small>IANA timezone, for example America/New_York.</small></label></div>{pending && <><label className="field">First administrator email<input type="email" name="email" required defaultValue={onboarding?.administrator_email ?? ''} /></label><label className="field">First administrator role<select name="administrator_role" required value={administratorRole} onChange={(event) => setAdministratorRole(event.target.value)}><option value="" disabled>Choose administrator role</option>{administrators.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}</select></label><section className="platform-defaults"><h3>Role catalog management</h3><p className="fine-print">Standard workspace roles are enabled automatically at creation. Once onboarded, the Org Admin manages the organization’s role catalog, custom roles, and role availability inside the workspace.</p></section>{record && <p className="fine-print">Changing the initial administrator revokes pending onboarding links. Send a replacement invitation after saving.</p>}</>}</fieldset>
    {error && <div className="notice danger" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}<div className="form-actions"><button className="button primary" disabled={busy}><Save />{busy ? 'Saving…' : record ? 'Save organization' : 'Create organization'}</button></div></form>
  </div>
}
