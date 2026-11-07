import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MailX, Pencil, Plus, Save, Search, UserX, X } from 'lucide-react'
import { requireSupabase } from '../../lib/supabase'
import { scopeLabels, useAccessCatalogs, localDateTime, type AccessRoleOption, type AccessScope } from './accessCatalogs'
import { ErrorState, LoadingState } from '../../components/Ui'
import { useAuth } from '../auth/AuthProvider'
import { humanize } from '../../lib/utils'
import type { HomeRow, NeighborhoodRow } from '../../lib/data'

interface RoleAssignment {
  id?: string
  role_code: string
  role_label?: string
  scope_kind: AccessScope
  division_id?: string | null
  company_id?: string | null
  can_edit?: boolean
  neighborhood_id: string | null
  home_id: string | null
  starts_at?: string
  ends_at?: string | null
}

interface MemberRow {
  user_id: string
  email: string
  display_name: string
  affiliation: 'internal' | 'external'
  status: string
  joined_at: string | null
  can_suspend?: boolean
  can_remove_access?: boolean
  roles: RoleAssignment[]
  companies: Array<{ company_id: string; company_name: string; kind: 'manager' | 'technician'; can_edit?: boolean }>
}

interface InviteRow {
  id: string
  email: string
  status: string
  expires_at: string
  created_at: string
  delivery_error: string | null
  can_revoke?: boolean
}

const emptyAssignment = (role?: AccessRoleOption): RoleAssignment => ({ role_code: role?.code ?? 'internal_contributor', scope_kind: role?.allowed_scope_kinds[0] ?? 'neighborhood', division_id: null, neighborhood_id: null, home_id: null, company_id: null })

export function MembersPanel({ organizationId, aal, currentUserId, neighborhoods, homes, onSuspend, initialMemberId }: {
  organizationId: string
  aal: string
  currentUserId?: string
  initialMemberId?: string
  neighborhoods: NeighborhoodRow[]
  homes: HomeRow[]
  onSuspend: (userId: string, displayName: string) => Promise<void>
}) {
  const members = useQuery({
    queryKey: ['admin-members', organizationId],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('admin_list_members', { p_organization_id: organizationId })
      if (error) throw error
      return data as unknown as MemberRow[]
    }
  })
  const invitations = useQuery({
    queryKey: ['admin-invitations', organizationId],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('admin_list_invitations', { p_organization_id: organizationId })
      if (error) throw error
      return data as unknown as InviteRow[]
    }
  })
  const catalogs = useAccessCatalogs(organizationId)
  const { refreshAccess } = useAuth()
  const [companyId, setCompanyId] = useState('')
  const [companyKind, setCompanyKind] = useState('technician')
  const [search, setSearch] = useState(initialMemberId ?? '')
  const editor = useRef<HTMLFormElement>(null)
  const [editing, setEditing] = useState<MemberRow | null>(null)
  const [draftRoles, setDraftRoles] = useState<RoleAssignment[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [saveError, setSaveError] = useState('')

  const homesByNeighborhood = useMemo(() => new Map(neighborhoods.map((item) => [item.id, homes.filter((home) => home.neighborhood_id === item.id)])), [homes, neighborhoods])
  const filteredMembers = members.data?.filter((member) => `${member.user_id} ${member.display_name} ${member.email} ${member.roles.map((role) => role.role_label ?? humanize(role.role_code)).join(' ')}`.toLowerCase().includes(search.toLowerCase())) ?? []

  useEffect(() => {
    if (!editing) return
    editor.current?.scrollIntoView({ block: 'start' })
    editor.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
  }, [editing])

  function scopeSummary(role: RoleAssignment) {
    if (role.scope_kind === 'organization') return 'Entire organization'
    if (role.scope_kind === 'division') return catalogs.data?.divisions.find((division) => division.id === role.division_id)?.name ?? 'Assigned division'
    if (role.scope_kind === 'company') return catalogs.data?.companies.find((company) => company.id === role.company_id)?.name ?? 'Vendor company'
    const area = neighborhoods.find((item) => item.id === role.neighborhood_id)?.name ?? 'Assigned neighborhood'
    return role.scope_kind === 'home' ? `${area} · ${homes.find((item) => item.id === role.home_id)?.lot_code ? `Lot ${homes.find((item) => item.id === role.home_id)?.lot_code}` : 'Assigned home'}` : area
  }

  function beginEdit(member: MemberRow) {
    setEditing(member)
    setCompanyId(member.companies[0]?.company_id ?? '')
    setCompanyKind(member.companies[0]?.kind ?? 'technician')
    setDraftRoles(member.roles.length ? member.roles.map((role) => ({ ...role })) : [emptyAssignment(catalogs.data?.roles[0])])
    setMessage('')
    setSaveError('')
  }

  function updateRole(index: number, patch: Partial<RoleAssignment>) {
    setDraftRoles((current) => current.map((role, position) => position === index ? { ...role, ...patch } : role))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing || aal !== 'aal2' || busy) return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setMessage('')
    setSaveError('')
    try {
      if (draftRoles.some((role) => role.can_edit !== false && !catalogs.data?.roles.find((item) => item.code === role.role_code)?.allowed_scope_kinds.includes(role.scope_kind))) throw new Error('Choose a supported scope for each editable role.')
      const normalizedRoles = draftRoles.map((role) => ({
        id: role.id,
        role_code: role.role_code,
        scope_kind: role.scope_kind,
        division_id: role.scope_kind === 'division' ? role.division_id : null,
        company_id: role.company_id ?? (role.scope_kind === 'company' || catalogs.data?.roles.find((item) => item.code === role.role_code)?.requires_company ? companyId || null : null),
        neighborhood_id: ['neighborhood', 'home'].includes(role.scope_kind) ? role.neighborhood_id : null,
        home_id: role.scope_kind === 'home' ? role.home_id : null,
        starts_at: role.starts_at || new Date().toISOString(),
        ends_at: role.ends_at || null
      }))
      const { error } = await requireSupabase().rpc('admin_set_member_access', {
        p_organization_id: organizationId,
        p_user_id: editing.user_id,
        p_affiliation: (catalogs.data?.context.organization_admin ? String(form.get('affiliation')) : editing.affiliation) as 'internal' | 'external',
        p_assignments: normalizedRoles,
        p_company_id: catalogs.data?.companies.some((company) => company.id === companyId) ? companyId : undefined,
        p_company_kind: catalogs.data?.companies.some((company) => company.id === companyId) ? companyKind : undefined
      })
      if (error) throw error
      setMessage(`${editing.display_name}'s access was updated.`)
      setEditing(null)
      await members.refetch()
      if (editing.user_id === currentUserId) await refreshAccess()
    } catch (error) { setSaveError((error as { message?: string }).message ?? 'Access update failed.') }
    finally { setBusy(false) }
  }

  async function revokeInvite(invite: InviteRow) {
    if (aal !== 'aal2' || !window.confirm(`Revoke the pending invitation for ${invite.email}?`)) return
    setBusy(true)
    setMessage('')
    const { error } = await requireSupabase().rpc('admin_revoke_invitation', { p_organization_id: organizationId, p_invitation_id: invite.id })
    setBusy(false)
    if (error) setMessage(error.message)
    else {
      setMessage(`Invitation for ${invite.email} was revoked.`)
      await invitations.refetch()
    }
  }

  return <section className="panel form-panel stack-lg">
    <div className="section-heading admin-section-heading"><div><h2>People and access</h2><p>Manage roles within your areas. Access granted by higher administrators is protected.</p></div><span>{members.data?.length ?? 0} members</span></div>
    {members.isLoading && <LoadingState label="Loading team members" />}
    {members.isError && <ErrorState message={members.error.message} retry={() => void members.refetch()} />}
    {catalogs.isError && <ErrorState message={catalogs.error.message} retry={() => void catalogs.refetch()} />}
    {message && <div className="notice" role="status">{message}</div>}
    <label className="search-box member-search"><Search /><span className="sr-only">Search team members</span><input value={search === initialMemberId ? members.data?.find((member) => member.user_id === initialMemberId)?.display_name ?? '' : search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, or role" /></label>
    <div className="member-list">{filteredMembers.map((member) => <div key={member.user_id}>
      <span><strong>{member.display_name}</strong><small>{member.email} · {humanize(member.status)}</small><small>{member.roles.map((role) => `${catalogs.data?.roles.find((item) => item.code === role.role_code)?.label ?? role.role_label ?? humanize(role.role_code)} — ${scopeSummary(role)}`).join('; ') || 'No active role'}</small></span>
      <span className="inline-actions"><button className="button ghost" disabled={aal !== 'aal2' || catalogs.isLoading || catalogs.isError} onClick={() => beginEdit(member)}><Pencil />Edit roles &amp; scope</button>{member.status === 'active' && (member.can_remove_access !== false || member.can_suspend) && <button className="button ghost" disabled={aal !== 'aal2'} onClick={() => void onSuspend(member.user_id, member.display_name)}><UserX />{member.user_id === currentUserId ? 'Handover' : (member.can_suspend ?? catalogs.data?.context.organization_admin) ? 'Suspend' : 'Remove local access'}</button>}</span>
    </div>)}</div>
    {editing && <form ref={editor} className="access-editor stack-lg" onSubmit={save} aria-labelledby="member-access-heading">
      <div className="section-heading"><div><h2 id="member-access-heading" tabIndex={-1}>Manage {editing.display_name}</h2><p>Choose the role and where this person can work.</p></div><button type="button" className="icon-button" disabled={busy} aria-label="Close editor" onClick={() => setEditing(null)}><X /></button></div>
      <fieldset className="property-fieldset stack-lg" disabled={busy || aal !== 'aal2'}>
      <div className="form-grid two">
        <label className="field">Affiliation<select name="affiliation" defaultValue={editing.affiliation} disabled={!catalogs.data?.context.organization_admin}><option value="internal">Internal</option><option value="external">External</option></select></label>
        <label className="field">Company<select name="company_id" value={companyId} required={draftRoles.some((role) => role.scope_kind === 'company' || (catalogs.data?.roles.find((item) => item.code === role.role_code)?.requires_company ?? ['vendor_admin', 'trade_technician'].includes(role.role_code)))} onChange={(event) => setCompanyId(event.target.value)}><option value="">No company</option>{companyId && !catalogs.data?.companies.some((company) => company.id === companyId) && <option value={companyId}>{editing.companies.find((company) => company.company_id === companyId)?.company_name ?? 'Protected company'}</option>}{catalogs.data?.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        {companyId && <label className="field">Company member type<select name="company_kind" value={companyKind} onChange={(event) => setCompanyKind(event.target.value)} disabled={editing.companies.find((company) => company.company_id === companyId)?.can_edit === false}><option value="technician">Technician</option><option value="manager">Manager</option></select></label>}
      </div>
      <div className="role-editor-list">{draftRoles.map((assignment, index) => {
        const selectedRole = catalogs.data?.roles.find((role) => role.code === assignment.role_code)
        return <fieldset className="role-editor property-fieldset" disabled={assignment.can_edit === false} key={`${assignment.id ?? 'new'}-${index}`}>
          {assignment.can_edit === false && <p className="full-span scope-explanation">Protected access — granted by a higher administrator.</p>}
          <label className="field">Role<select value={assignment.role_code} onChange={(event) => {
            const next = catalogs.data?.roles.find((role) => role.code === event.target.value)
            const scope = next?.allowed_scope_kinds[0] ?? 'neighborhood'
            if (next?.code === 'vendor_admin') setCompanyKind('manager')
            if (next?.code === 'trade_technician') setCompanyKind('technician')
            updateRole(index, { role_code: event.target.value, scope_kind: scope, division_id: null, neighborhood_id: null, home_id: null, company_id: scope === 'company' || next?.requires_company ? companyId || null : null })
          }}>{!selectedRole && <option value={assignment.role_code}>{assignment.can_edit === false ? assignment.role_label ?? humanize(assignment.role_code) : 'Unavailable role — replace or remove'}</option>}{catalogs.data?.roles.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}</select></label>
          <label className="field">Access scope<select value={assignment.scope_kind} onChange={(event) => updateRole(index, { scope_kind: event.target.value as RoleAssignment['scope_kind'], division_id: null, neighborhood_id: null, home_id: null })}>{assignment.can_edit === false && !selectedRole?.allowed_scope_kinds.includes(assignment.scope_kind) && <option value={assignment.scope_kind}>{scopeLabels[assignment.scope_kind]}</option>}{selectedRole?.allowed_scope_kinds.map((scope) => <option key={scope} value={scope}>{scopeLabels[scope]}</option>)}</select></label>
          {assignment.scope_kind === 'division' && <label className="field">Division<select required value={assignment.division_id ?? ''} onChange={(event) => updateRole(index, { division_id: event.target.value || null })}><option value="">Choose division</option>{catalogs.data?.divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {['neighborhood', 'home'].includes(assignment.scope_kind) && <label className="field">Neighborhood<select required value={assignment.neighborhood_id ?? ''} onChange={(event) => updateRole(index, { neighborhood_id: event.target.value || null, home_id: null })}><option value="">Choose neighborhood</option>{neighborhoods.filter((item) => assignment.can_edit === false || catalogs.data?.neighborhoods.some((area) => area.id === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {assignment.scope_kind === 'company' && <label className="field">Vendor company<select required value={assignment.company_id ?? companyId} onChange={(event) => { updateRole(index, { company_id: event.target.value }); setCompanyId(event.target.value) }}><option value="">Choose company</option>{!catalogs.data?.companies.some((company) => company.id === assignment.company_id) && assignment.company_id && <option value={assignment.company_id}>{editing.companies.find((company) => company.company_id === assignment.company_id)?.company_name ?? 'Protected company'}</option>}{catalogs.data?.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
          {assignment.scope_kind === 'home' && <label className="field">Home<select required disabled={!assignment.neighborhood_id} value={assignment.home_id ?? ''} onChange={(event) => updateRole(index, { home_id: event.target.value || null })}><option value="">Choose home</option>{(homesByNeighborhood.get(assignment.neighborhood_id ?? '') ?? []).map((home) => <option key={home.id} value={home.id}>Lot {home.lot_code}{home.address_line1 ? ` · ${home.address_line1}` : ''}</option>)}</select></label>}
          {assignment.scope_kind === 'organization' && <p className="scope-explanation full-span">Applies across the entire organization. No location selection is needed.</p>}
          <details className="access-dates full-span"><summary>Optional start and end dates</summary><div className="form-grid two">
          <label className="field">Starts at<input type="datetime-local" value={localDateTime(assignment.starts_at)} onChange={(event) => updateRole(index, { starts_at: event.target.value ? new Date(event.target.value).toISOString() : undefined })} /></label>
          <label className="field">Ends at<input type="datetime-local" min={localDateTime(assignment.starts_at)} value={localDateTime(assignment.ends_at)} onChange={(event) => updateRole(index, { ends_at: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
          </div></details>
          <button type="button" className="icon-button" aria-label="Remove role" disabled={busy || draftRoles.length === 1} onClick={() => setDraftRoles((current) => current.filter((_, position) => position !== index))}><X /></button>
        </fieldset>
      })}</div>
      </fieldset>
      {saveError && <ErrorState message={saveError} />}
      <div className="form-actions"><button type="button" className="button secondary" disabled={busy || draftRoles.length >= 20} onClick={() => setDraftRoles((current) => [...current, emptyAssignment(catalogs.data?.roles[0])])}><Plus />Add role</button><button className="button primary" disabled={busy || aal !== 'aal2'}><Save />Save roles &amp; scope</button></div>
    </form>}
    <div className="section-heading admin-section-heading"><div><h2>Invitations</h2><p>Pending and historical invitation delivery records.</p></div></div>
    <div className="member-list">{invitations.data?.map((invite) => <div key={invite.id}><span><strong>{invite.email}</strong><small>{invite.status} · expires {new Date(invite.expires_at).toLocaleString()}{invite.delivery_error ? ` · delivery: ${invite.delivery_error}` : ''}</small></span>{invite.status === 'pending' && invite.can_revoke !== false && <button className="button ghost" disabled={busy || aal !== 'aal2'} onClick={() => void revokeInvite(invite)}><MailX />Revoke</button>}</div>)}</div>
  </section>
}
