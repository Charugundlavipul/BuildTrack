import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, MailPlus, Save, UserMinus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingState } from '../../components/Ui'
import { requireSupabase } from '../../lib/supabase'
import { functionErrorMessage } from '../../lib/functionError'
import { formatDateTime, humanize } from '../../lib/utils'
import { type PlatformOrganization } from './platformData'

interface Pricing {
  plan_name: string; currency: string; billing_interval: string; subscription_status: string;
  base_rate: number; user_rate: number; home_rate: number; included_users: number; included_homes: number;
  billing_email: string; starts_on: string; ends_on: string | null; notes: string; version?: number
}
interface Member { user_id: string; email: string; display_name: string; status: 'active' | 'suspended' | 'removed' | 'invited'; affiliation: string; roles: Array<{ label: string; scope: string; effective: boolean }> }
interface Invitation { id: string; normalized_email: string; status: string; expires_at: string; delivery_error: string | null; proposed_grants: Array<{ role_code: string }> }
interface Operations { pricing: Pricing | null; usage: { users: number; homes: number }; members: Member[]; total: number; invitations: Invitation[] }

export function OrganizationOperations({ organization, section }: { organization: PlatformOrganization; section: 'people' | 'pricing' | 'access' }) {
  const cache = useQueryClient()
  const [params] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const [page, setPage] = useState(0)
  const data = useQuery({ queryKey: ['platform-operations', organization.id, search, page], refetchOnWindowFocus: false, queryFn: async () => {
    const { data, error } = await requireSupabase().rpc('platform_get_operations', { p_organization_id: organization.id, p_search: search, p_page: page })
    if (error) throw error
    return data as unknown as Operations
  } })
  async function refresh() {
    await Promise.all([cache.invalidateQueries({ queryKey: ['platform-operations', organization.id] }), cache.invalidateQueries({ queryKey: ['platform-organization', organization.id] }), cache.invalidateQueries({ queryKey: ['platform-organizations'] })])
  }
  if (data.isLoading) return <LoadingState label="Loading organization controls" />
  if (data.error) return <ErrorState message={data.error.message} retry={() => void data.refetch()} />
  if (!data.data) return null
  return section === 'pricing' ? <PricingForm key={`${organization.id}-${data.data.pricing?.version ?? 0}`} organization={organization} pricing={data.data.pricing} usage={data.data.usage} refresh={refresh} /> : section === 'access' ? <Lifecycle organization={organization} usage={data.data.usage} refresh={refresh} /> : <People organization={organization} data={data.data} search={search} page={page} setSearch={(value) => { setSearch(value); setPage(0) }} setPage={setPage} refresh={refresh} />
}

function People({ organization, data, search, page, setSearch, setPage, refresh }: { organization: PlatformOrganization; data: Operations; search: string; page: number; setSearch: (value: string) => void; setPage: (value: number) => void; refresh: () => Promise<void> }) {
  const [action, setAction] = useState<{ member?: Member; invitation?: Invitation; status?: 'active' | 'suspended' | 'removed' } | null>(null)
  const [inviting, setInviting] = useState(false)
  const [checkedAt] = useState(() => Date.now())
  const [reviewInvite, setReviewInvite] = useState<{ email: string; role_code: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const roles = [{ code: 'org_admin', label: 'Org Admin' }]
  async function sendInvite() {
    if (!reviewInvite) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { data, error } = await requireSupabase().functions.invoke('platform-invite', { body: { organization_id: organization.id, ...reviewInvite } })
      if (error) throw error
      if (!data?.invitation_id) throw new Error('Delivery was not confirmed. Check invitation history before retrying.')
      setMessage(`Invitation sent to ${reviewInvite.email}.`); setReviewInvite(null); setInviting(false)
    } catch (caught) { setError(await functionErrorMessage(caught, 'Invitation delivery failed. Check history before retrying.')) }
    finally { await refresh(); setBusy(false) }
  }
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!action) return
    const reason = String(new FormData(event.currentTarget).get('reason')).trim()
    setBusy(true); setError(''); setMessage('')
    try {
      const client = requireSupabase()
      const { error } = action.member ? await client.rpc('platform_set_member_status', { p_organization_id: organization.id, p_user_id: action.member.user_id, p_status: action.status!, p_reason: reason, p_expected_status: action.member.status }) : await client.rpc('platform_revoke_invitation', { p_organization_id: organization.id, p_invitation_id: action.invitation!.id, p_reason: reason })
      if (error) throw error
      setMessage(action.member ? 'Organization membership updated.' : 'Invitation revoked.'); setAction(null); await refresh()
    } catch (caught) { setError((caught as Error).message) }
    finally { setBusy(false) }
  }
  const begin = (next: typeof action) => { setError(''); setMessage(''); setAction(next) }
  return <div className="stack-lg"><section className="panel form-panel stack-lg"><div className="section-heading"><div><h2>People & invitations</h2><p>Manage access to {organization.name}.</p></div><button className="button primary" disabled={organization.status !== 'active' || busy} onClick={() => { setInviting(!inviting); setReviewInvite(null); setError('') }}><MailPlus />Invite user</button></div>
    {organization.status !== 'active' && <div className="notice warning">This organization is blocked or archived. Invitations are disabled.</div>}
    {inviting && <form className="platform-invite-form stack-lg" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); setReviewInvite({ email: String(form.get('email')).trim(), role_code: String(form.get('role')) }); setError('') }}><h3>Invite to organization</h3><fieldset disabled={busy} className="configuration-fields form-grid two" onChange={() => setReviewInvite(null)}><label className="field">Email<input name="email" type="email" required /></label><label className="field">Organization-wide role<select name="role" required defaultValue=""><option value="" disabled>Choose role</option>{roles.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}</select></label></fieldset><p className="fine-print">For home, neighborhood, or trade-company access, use the organization’s People administration. This invitation grants the selected role across the organization.</p>{reviewInvite ? <div className="notice warning stack-lg"><p>Send to <strong>{reviewInvite.email}</strong> with {roles.find((role) => role.code === reviewInvite.role_code)?.label}? Any pending invitation for this email will be replaced.</p><div className="button-row"><button type="button" className="button primary" disabled={busy} onClick={() => void sendInvite()}>{busy ? 'Sending…' : 'Confirm and send invitation'}</button><button type="button" className="button ghost" disabled={busy} onClick={() => setReviewInvite(null)}>Back</button></div></div> : <button className="button secondary" disabled={busy || !roles.length}>Review invitation</button>}</form>}
    <label className="field">Search users<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    {!data.members.length ? <EmptyState title="No matching users" description="Change the search or invite a user." /> : <div className="platform-members">{data.members.map((member) => <article key={member.user_id} className="platform-member"><div><strong>{member.display_name || member.email}</strong><p>{member.email}</p><div className="role-meta"><span className="state-badge">{humanize(member.status)}</span><span>{humanize(member.affiliation)}</span></div><p className="fine-print">{member.roles.map((role) => `${role.label} · ${humanize(role.scope)}${role.effective ? '' : ' (unavailable)'}`).join('; ') || 'No current role grants'}</p></div><div className="button-row">{member.status === 'active' && <button className="button secondary" disabled={busy} onClick={() => begin({ member, status: 'suspended' })}><Ban />Suspend</button>}{member.status === 'suspended' && <button className="button secondary" disabled={busy} onClick={() => begin({ member, status: 'active' })}>Reactivate</button>}{member.status !== 'removed' && <button className="button ghost danger-text" disabled={busy} onClick={() => begin({ member, status: 'removed' })}><UserMinus />Remove</button>}</div></article>)}</div>}
    <footer className="property-pagination"><span>{data.total ? `${page * 25 + 1}–${Math.min(page * 25 + 25, data.total)}` : '0'} of {data.total} users</span><div className="button-row"><button className="button ghost" disabled={!page || busy} onClick={() => setPage(page - 1)}>Previous</button><button className="button ghost" disabled={(page + 1) * 25 >= data.total || busy} onClick={() => setPage(page + 1)}>Next</button></div></footer></section>
    {action && <dialog className="platform-action-dialog" aria-labelledby="platform-member-confirm-title" ref={(node) => { if (node && !node.open) node.showModal() }} onCancel={(event) => { event.preventDefault(); if (!busy) setAction(null) }}><form className="form-panel stack-lg" onSubmit={apply}><h2 id="platform-member-confirm-title">{action.member ? `${action.status === 'removed' ? 'Remove' : action.status === 'suspended' ? 'Suspend' : 'Reactivate'} membership` : 'Revoke invitation'}</h2><p>{action.member?.email ?? action.invitation?.normalized_email}</p><div className="notice warning">{action.member ? action.status === 'removed' ? 'Removes this organization’s access and revokes its role and company grants. Their account, other organizations, and historical records remain. A new invitation is required to return.' : action.status === 'suspended' ? 'Stops access to this organization. Current grants remain available for reactivation.' : 'Restores membership. Only enabled, unexpired role and company grants provide access.' : 'This invitation link will stop working.'}{action.member && action.status !== 'active' && <p>Organization administrators may need to reassign responsibilities. The last active access administrator cannot be removed.</p>}</div><label className="field">Reason<textarea name="reason" minLength={5} maxLength={1000} required /></label><div>{error && <div className="notice danger" role="alert">{error}</div>}</div><div className="button-row"><button className="button primary" disabled={busy}>{busy ? 'Applying…' : 'Confirm change'}</button><button type="button" className="button secondary" disabled={busy} onClick={() => setAction(null)}>Cancel</button></div></form></dialog>}
    {error && !action && <div className="notice danger" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    <section className="panel form-panel stack-lg"><h2>Invitation history</h2><p className="fine-print">Latest 50 invitations, including invitations sent by organization administrators.</p>{!data.invitations.length ? <p>No invitations sent.</p> : data.invitations.map((invitation) => <div className="platform-invitation" key={invitation.id}><div><strong>{invitation.normalized_email}</strong><p>{invitation.status === 'pending' && new Date(invitation.expires_at).getTime() < checkedAt ? 'Expired' : humanize(invitation.status)} · expires {formatDateTime(invitation.expires_at)}</p>{invitation.delivery_error && <p className="danger-text">{invitation.delivery_error}</p>}</div>{invitation.status === 'pending' && <button className="button secondary" disabled={busy} onClick={() => begin({ invitation })}>Revoke invitation</button>}</div>)}</section>
  </div>
}

function PricingForm({ organization, pricing, usage, refresh }: { organization: PlatformOrganization; pricing: Pricing | null; usage: Operations['usage']; refresh: () => Promise<void> }) {
  const [values, setValues] = useState<Pricing>(() => pricing ?? { plan_name: '', currency: 'USD', billing_interval: 'monthly', subscription_status: 'draft', base_rate: 0, user_rate: 0, home_rate: 0, included_users: 0, included_homes: 0, billing_email: '', starts_on: new Date().toLocaleDateString('en-CA'), ends_on: '', notes: '' })
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const total = Number(values.base_rate) + Math.max(0, usage.users - Number(values.included_users)) * Number(values.user_rate) + Math.max(0, usage.homes - Number(values.included_homes)) * Number(values.home_rate)
  const money = (amount: number) => `${values.currency.toUpperCase()} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  function update<K extends keyof Pricing>(key: K, value: Pricing[K]) { setValues({ ...values, [key]: value }); setReview(false); setMessage('') }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!review) { setReview(true); return }
    setBusy(true); setError('')
    try {
      const { error } = await requireSupabase().rpc('platform_save_pricing', { p_organization_id: organization.id, p_config: { ...values }, p_expected_version: pricing?.version })
      if (error) throw error
      setMessage('Pricing saved.'); toast.success('Organization pricing saved.'); setReview(false); await refresh()
    } catch (caught) { setError((caught as Error).message); setReview(false) }
    finally { setBusy(false) }
  }
  return <form className="panel form-panel stack-lg" onSubmit={save}><div><h2>Contract pricing</h2><p>Combine a base subscription with usage rates. All rates apply per selected billing interval.</p></div><div className="notice">Configuration and estimates only. No payment collection or invoices are generated.</div><fieldset className="configuration-fields stack-lg" disabled={busy}><div className="form-grid two"><label className="field">Plan name<input required maxLength={120} value={values.plan_name} onChange={(event) => update('plan_name', event.target.value)} /></label><label className="field">Subscription status<select value={values.subscription_status} onChange={(event) => update('subscription_status', event.target.value)}>{['draft', 'trial', 'active', 'past_due', 'cancelled'].map((status) => <option key={status} value={status}>{humanize(status)}</option>)}</select><small>Tracks the agreement. Access is managed separately.</small></label><label className="field">Currency<input required pattern="[A-Za-z]{3}" maxLength={3} value={values.currency} onChange={(event) => update('currency', event.target.value.toUpperCase())} /><small>Three-letter currency code, such as USD.</small></label><label className="field">Billing interval<select value={values.billing_interval} onChange={(event) => update('billing_interval', event.target.value)}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label></div><div className="platform-rate-grid">{(['base_rate', 'user_rate', 'home_rate'] as const).map((key) => <label className="field" key={key}>{key === 'base_rate' ? 'Base subscription' : key === 'user_rate' ? 'Per active user' : 'Per active home'}<input type="number" min="0" max="9999999999.99" step="0.01" required value={values[key]} onChange={(event) => update(key, event.target.valueAsNumber || 0)} /></label>)}</div><div className="form-grid two">{(['included_users', 'included_homes'] as const).map((key) => <label className="field" key={key}>{humanize(key)}<input type="number" min="0" max="2147483647" step="1" required value={values[key]} onChange={(event) => update(key, event.target.valueAsNumber || 0)} /></label>)}<label className="field">Agreement starts<input type="date" required value={values.starts_on} onChange={(event) => update('starts_on', event.target.value)} /></label><label className="field">Agreement ends (optional)<input type="date" min={values.starts_on} value={values.ends_on ?? ''} onChange={(event) => update('ends_on', event.target.value)} /></label></div><label className="field">Billing email<input type="email" value={values.billing_email} onChange={(event) => update('billing_email', event.target.value)} /></label><label className="field">Agreement notes<textarea maxLength={4000} value={values.notes} onChange={(event) => update('notes', event.target.value)} /></label></fieldset>
    <section className="platform-price-estimate stack-lg"><h3>Current usage estimate</h3><dl className="platform-price-lines"><div><dt>Base subscription</dt><dd>{money(Number(values.base_rate))}</dd></div><div><dt>{usage.users} active users · {Math.max(0, usage.users - Number(values.included_users))} billable</dt><dd>{money(Math.max(0, usage.users - Number(values.included_users)) * Number(values.user_rate))}</dd></div><div><dt>{usage.homes} active homes · {Math.max(0, usage.homes - Number(values.included_homes))} billable</dt><dd>{money(Math.max(0, usage.homes - Number(values.included_homes)) * Number(values.home_rate))}</dd></div><div><dt>Estimated recurring total</dt><dd><strong>{money(total)} / {values.billing_interval === 'annual' ? 'year' : 'month'}</strong></dd></div></dl><p className="fine-print">Snapshot of active memberships and unarchived homes. Excludes tax, proration, discounts, historical usage, and payment processing. Trial and agreement dates do not automatically change this estimate or block access.</p></section>
    {review && <div className="notice warning">Save {values.plan_name} pricing at the rates above? This replaces the current configuration and records the change in activity.</div>}{error && <div className="notice danger" role="alert">{error}</div>}{message && <div role="status" className="notice">{message}</div>}<div className="form-actions"><button className="button primary" disabled={busy}><Save />{busy ? 'Saving…' : review ? 'Confirm pricing' : 'Review pricing'}</button></div></form>
}

function Lifecycle({ organization, usage, refresh }: { organization: PlatformOrganization; usage: Operations['usage']; refresh: () => Promise<void> }) {
  const [status, setStatus] = useState<PlatformOrganization['status']>('suspended')
  const [reason, setReason] = useState('')
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!review) { setReview(true); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const { error } = await requireSupabase().rpc('platform_set_organization_status', { p_organization_id: organization.id, p_status: status, p_reason: reason, p_expected_version: organization.version })
      if (error) throw error
      setReview(false); setMessage('Organization access updated.'); await refresh()
    } catch (caught) { setError((caught as Error).message); setReview(false) }
    finally { setBusy(false) }
  }
  return <section className="panel form-panel stack-lg"><div><h2>Access & lifecycle</h2><p>Current status: <strong>{organization.status === 'suspended' ? 'Blocked' : humanize(organization.status)}</strong></p></div><div className="notice warning">Blocking and archiving stop online tenant access for all users. Pending invitations are revoked. Existing memberships, pricing, and operational history remain. Previously downloaded offline data cannot be remotely erased.</div><p>{usage.users} active memberships · {usage.homes} unarchived homes</p><form className="stack-lg" onSubmit={save}><fieldset disabled={busy} className="configuration-fields stack-lg"><label className="field">Change access<select value={status} onChange={(event) => { setStatus(event.target.value as PlatformOrganization['status']); setReview(false) }}><option value="suspended">Block organization</option><option value="active">Activate organization</option><option value="archived">Archive organization</option></select></label><label className="field">Reason<textarea required minLength={5} maxLength={1000} value={reason} onChange={(event) => { setReason(event.target.value); setReview(false) }} /></label></fieldset>{review && <div className="notice warning">Confirm {status === 'suspended' ? 'blocking' : status === 'active' ? 'activating' : 'archiving'} {organization.name}? {status === 'active' ? 'Eligible existing memberships and grants will regain access. A ready organization must have an active access administrator.' : 'Users will lose online access and pending invitations will be revoked.'}</div>}{error && <div className="notice danger" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}<div className="button-row"><button className="button primary" disabled={busy || status === organization.status}>{busy ? 'Applying…' : review ? 'Confirm access change' : 'Review access change'}</button>{review && <button type="button" className="button secondary" disabled={busy} onClick={() => setReview(false)}>Cancel</button>}</div></form></section>
}
