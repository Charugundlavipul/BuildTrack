import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MailX, Pencil, Plus, Save, UserX, X } from 'lucide-react'
import { requireSupabase } from '../../lib/supabase'
import type { HomeRow, NeighborhoodRow } from '../../lib/data'

interface RoleAssignment {
  id?: string
  role_code: string
  scope_kind: 'organization' | 'neighborhood' | 'home'
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
  roles: RoleAssignment[]
  companies: Array<{ company_id: string; company_name: string; kind: 'manager' | 'technician' }>
}

interface InviteRow {
  id: string
  email: string
  status: string
  expires_at: string
  created_at: string
  delivery_error: string | null
}

interface RoleOption {
  code: string
  label: string
  allowed_scope_kinds: Array<'organization' | 'neighborhood' | 'home'>
}

interface CompanyOption { id: string; name: string }

const emptyAssignment = (): RoleAssignment => ({ role_code: 'internal_contributor', scope_kind: 'neighborhood', neighborhood_id: null, home_id: null })

export function MembersPanel({ organizationId, aal, currentUserId, neighborhoods, homes, onSuspend }: {
  organizationId: string
  aal: string
  currentUserId?: string
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
  const catalogs = useQuery({
    queryKey: ['admin-access-catalogs', organizationId],
    queryFn: async () => {
      const client = requireSupabase()
      const [{ data: roles, error: roleError }, { data: companies, error: companyError }] = await Promise.all([
        client.from('roles').select('code,label,allowed_scope_kinds').order('label'),
        client.from('companies').select('id,name').eq('organization_id', organizationId).eq('status', 'active').order('name')
      ])
      if (roleError) throw roleError
      if (companyError) throw companyError
      return { roles: roles as RoleOption[], companies: companies as CompanyOption[] }
    }
  })
  const [editing, setEditing] = useState<MemberRow | null>(null)
  const [draftRoles, setDraftRoles] = useState<RoleAssignment[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const homesByNeighborhood = useMemo(() => new Map(neighborhoods.map((item) => [item.id, homes.filter((home) => home.neighborhood_id === item.id)])), [homes, neighborhoods])

  function beginEdit(member: MemberRow) {
    setEditing(member)
    setDraftRoles(member.roles.length ? member.roles.map((role) => ({ ...role })) : [emptyAssignment()])
    setMessage('')
  }

  function updateRole(index: number, patch: Partial<RoleAssignment>) {
    setDraftRoles((current) => current.map((role, position) => position === index ? { ...role, ...patch } : role))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing || aal !== 'aal2') return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setMessage('')
    try {
      const normalizedRoles = draftRoles.map((role) => ({
        role_code: role.role_code,
        scope_kind: role.scope_kind,
        neighborhood_id: role.scope_kind === 'organization' ? null : role.neighborhood_id,
        home_id: role.scope_kind === 'home' ? role.home_id : null,
        starts_at: role.starts_at || new Date().toISOString(),
        ends_at: role.ends_at || null
      }))
      const { error } = await requireSupabase().rpc('admin_set_member_access', {
        p_organization_id: organizationId,
        p_user_id: editing.user_id,
        p_affiliation: String(form.get('affiliation')) as 'internal' | 'external',
        p_assignments: normalizedRoles,
        p_company_id: String(form.get('company_id')) || undefined,
        p_company_kind: String(form.get('company_kind')) || undefined
      })
      if (error) throw error
      setMessage(`${editing.display_name}'s access was updated.`)
      setEditing(null)
      await members.refetch()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Access update failed.') }
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
    <div className="section-heading admin-section-heading"><div><h2>People and access</h2><p>Manage every member's affiliation, company relationship, roles, and geographic scope. Changes require an elevated MFA session.</p></div><span>{members.data?.length ?? 0} members</span></div>
    {message && <div className="notice" role="status">{message}</div>}
    <div className="member-list">{members.data?.map((member) => <div key={member.user_id}>
      <span><strong>{member.display_name}</strong><small>{member.email} · {member.status} · {member.roles.map((role) => `${role.role_code} (${role.scope_kind})`).join(', ') || 'no active role'}</small></span>
      <span className="inline-actions"><button className="button ghost" disabled={aal !== 'aal2'} onClick={() => beginEdit(member)}><Pencil />Edit access</button>{member.status === 'active' && <button className="button ghost" disabled={aal !== 'aal2'} onClick={() => void onSuspend(member.user_id, member.display_name)}><UserX />{member.user_id === currentUserId ? 'Handover' : 'Suspend'}</button>}</span>
    </div>)}</div>
    {editing && <form className="access-editor stack-lg" onSubmit={save}>
      <div className="section-heading"><div><h2>Edit {editing.display_name}</h2><p>Saving replaces all active role and company assignments atomically.</p></div><button type="button" className="icon-button" aria-label="Close editor" onClick={() => setEditing(null)}><X /></button></div>
      <div className="form-grid two">
        <label className="field">Affiliation<select name="affiliation" defaultValue={editing.affiliation}><option value="internal">Internal</option><option value="external">External</option></select></label>
        <label className="field">Company<select name="company_id" defaultValue={editing.companies[0]?.company_id ?? ''}><option value="">No company</option>{catalogs.data?.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <label className="field">Company member type<select name="company_kind" defaultValue={editing.companies[0]?.kind ?? 'technician'}><option value="technician">Technician</option><option value="manager">Manager</option></select></label>
      </div>
      <div className="role-editor-list">{draftRoles.map((assignment, index) => {
        const selectedRole = catalogs.data?.roles.find((role) => role.code === assignment.role_code)
        return <div className="role-editor" key={`${assignment.id ?? 'new'}-${index}`}>
          <label className="field">Role<select value={assignment.role_code} onChange={(event) => {
            const next = catalogs.data?.roles.find((role) => role.code === event.target.value)
            const scope = next?.allowed_scope_kinds[0] ?? 'neighborhood'
            updateRole(index, { role_code: event.target.value, scope_kind: scope, neighborhood_id: null, home_id: null })
          }}>{catalogs.data?.roles.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}</select></label>
          <label className="field">Scope<select value={assignment.scope_kind} onChange={(event) => updateRole(index, { scope_kind: event.target.value as RoleAssignment['scope_kind'], neighborhood_id: null, home_id: null })}>{selectedRole?.allowed_scope_kinds.map((scope) => <option key={scope} value={scope}>{scope}</option>)}</select></label>
          {assignment.scope_kind !== 'organization' && <label className="field">Neighborhood<select required value={assignment.neighborhood_id ?? ''} onChange={(event) => updateRole(index, { neighborhood_id: event.target.value || null, home_id: null })}><option value="">Choose neighborhood</option>{neighborhoods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {assignment.scope_kind === 'home' && <label className="field">Home<select required value={assignment.home_id ?? ''} onChange={(event) => updateRole(index, { home_id: event.target.value || null })}><option value="">Choose home</option>{(homesByNeighborhood.get(assignment.neighborhood_id ?? '') ?? []).map((home) => <option key={home.id} value={home.id}>Lot {home.lot_code}</option>)}</select></label>}
          <label className="field">Starts at<input type="datetime-local" value={assignment.starts_at?.slice(0, 16) ?? ''} onChange={(event) => updateRole(index, { starts_at: event.target.value ? new Date(event.target.value).toISOString() : undefined })} /></label>
          <label className="field">Ends at<input type="datetime-local" min={assignment.starts_at?.slice(0, 16)} value={assignment.ends_at?.slice(0, 16) ?? ''} onChange={(event) => updateRole(index, { ends_at: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
          <button type="button" className="icon-button" aria-label="Remove role" disabled={draftRoles.length === 1} onClick={() => setDraftRoles((current) => current.filter((_, position) => position !== index))}><X /></button>
        </div>
      })}</div>
      <div className="form-actions"><button type="button" className="button secondary" onClick={() => setDraftRoles((current) => [...current, emptyAssignment()])}><Plus />Add role</button><button className="button primary" disabled={busy || aal !== 'aal2'}><Save />Save access</button></div>
    </form>}
    <div className="section-heading admin-section-heading"><div><h2>Invitations</h2><p>Pending and historical invitation delivery records.</p></div></div>
    <div className="member-list">{invitations.data?.map((invite) => <div key={invite.id}><span><strong>{invite.email}</strong><small>{invite.status} · expires {new Date(invite.expires_at).toLocaleString()}{invite.delivery_error ? ` · delivery: ${invite.delivery_error}` : ''}</small></span>{invite.status === 'pending' && <button className="button ghost" disabled={busy || aal !== 'aal2'} onClick={() => void revokeInvite(invite)}><MailX />Revoke</button>}</div>)}</div>
  </section>
}
