import { useEffect, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Building2, CalendarDays, CheckCircle2, ClipboardList, KeyRound, MailPlus, ShieldCheck, UsersRound, Wrench } from 'lucide-react'
import { ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { requireSupabase, supabase } from '../../lib/supabase'
import { useHomes, useNeighborhoods } from '../../lib/data'
import { useAuth } from '../auth/AuthProvider'
import { newCommand, runCommand } from '../../lib/commands'
import { parseHomeImportCsv } from '../../lib/csv'
import { purgeAuthorizedCache } from '../../lib/offline'
import { MembersPanel } from './MembersPanel'
import { AdministrationCatalogs } from './AdministrationCatalogs'
import { OperationsHealthPanel } from './OperationsHealthPanel'

const roleOptions = [
  'org_admin', 'area_manager', 'superintendent', 'assistant_superintendent', 'internal_quality',
  'external_inspector', 'verifier', 'trade_manager', 'trade_technician', 'operations_coordinator',
  'internal_contributor', 'leadership_viewer', 'auditor'
]

interface HomeImportResult {
  preview: boolean
  inserted_count: number
  rows: Array<{ row: number; lot_code?: string; status: string; error?: string }>
}

function useAdminSummary(organizationId?: string) {
  return useQuery({
    queryKey: ['admin-summary', organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const client = requireSupabase()
      const tables = ['organization_memberships', 'companies', 'neighborhoods', 'checklist_templates'] as const
      const counts = await Promise.all(tables.map(async (table) => {
        const { count, error } = await client.from(table).select('*', { count: 'exact', head: true }).eq('organization_id', organizationId!)
        if (error) throw error
        return [table, count ?? 0] as const
      }))
      return Object.fromEntries(counts)
    }
  })
}

export function AdminPage() {
  const { org } = useParams()
  const { user, can } = useAuth()
  const summary = useAdminSummary(org)
  const neighborhoods = useNeighborhoods(org)
  const homes = useHomes(org)
  const companies = useQuery({
    queryKey: ['admin-companies', org],
    enabled: Boolean(org),
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('companies').select('id,name').eq('organization_id', org!).eq('status', 'active').order('name')
      if (error) throw error
      return data
    }
  })
  const [aal, setAal] = useState<string>('aal1')
  const [showInvite, setShowInvite] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteMessage, setInviteMessage] = useState('')
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const [mfaBusy, setMfaBusy] = useState(false)
  const [mfaError, setMfaError] = useState('')
  const [importCsv, setImportCsv] = useState('lot_code,address_line1,city,state_code,postal_code,phase\n')
  const [importNeighborhood, setImportNeighborhood] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importResult, setImportResult] = useState<HomeImportResult | null>(null)
  const [importError, setImportError] = useState('')
  const [memberMessage, setMemberMessage] = useState('')

  useEffect(() => {
    void supabase?.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => setAal(data?.currentLevel ?? 'aal1'))
  }, [])

  async function beginMfaEnrollment() {
    if (!supabase) return
    setMfaBusy(true)
    setMfaError('')
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'BuildTrack administrator' })
      if (error) throw error
      setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    } catch (error) { setMfaError(error instanceof Error ? error.message : 'Unable to enroll MFA.') }
    finally { setMfaBusy(false) }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !factor) return
    setMfaBusy(true)
    setMfaError('')
    try {
      const code = String(new FormData(event.currentTarget).get('code')).replace(/\s/g, '')
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id })
      if (challengeError) throw challengeError
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code })
      if (verifyError) throw verifyError
      const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      setAal(assurance?.currentLevel ?? 'aal2')
      setFactor(null)
    } catch (error) { setMfaError(error instanceof Error ? error.message : 'The authenticator code was rejected.') }
    finally { setMfaBusy(false) }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!org || aal !== 'aal2') return
    const form = new FormData(event.currentTarget)
    const scopeKind = String(form.get('scope_kind'))
    const neighborhoodId = String(form.get('neighborhood_id')) || null
    const homeId = String(form.get('home_id')) || null
    setInviteBusy(true)
    setInviteMessage('')
    try {
      const { data, error } = await requireSupabase().functions.invoke('invite-user', { body: {
        organization_id: org,
        email: String(form.get('email')).trim(),
        affiliation: String(form.get('affiliation')),
        grants: [{
          role_code: String(form.get('role_code')),
          scope_kind: scopeKind,
          neighborhood_id: scopeKind === 'organization' ? null : neighborhoodId,
          home_id: scopeKind === 'home' ? homeId : null
        }],
        company_id: String(form.get('company_id')) || null,
        company_kind: String(form.get('company_kind')) || null
      } })
      if (error) throw error
      if (!data?.invitation_id) throw new Error('Invitation delivery did not complete.')
      setInviteMessage(`Invitation sent. It expires ${new Date(data.expires_at).toLocaleString()}.`)
      event.currentTarget.reset()
    } catch (error) { setInviteMessage(error instanceof Error ? error.message : 'Invitation failed.') }
    finally { setInviteBusy(false) }
  }

  async function runHomeImport(preview: boolean) {
    if (!org || !user || !importNeighborhood || aal !== 'aal2') return
    setImportBusy(true)
    setImportError('')
    try {
      const rows = parseHomeImportCsv(importCsv)
      const response = await runCommand<Record<string, unknown>, HomeImportResult>('import_homes', newCommand({
        organization_id: org,
        neighborhood_id: importNeighborhood,
        preview,
        rows
      }), { organizationId: org, userId: user.id, aggregateId: importNeighborhood })
      if ('queued' in response) throw new Error('Home imports require a live connection.')
      if (!response.ok) throw new Error(response.error.message)
      setImportResult(response.data)
      if (!preview) await Promise.all([summary.refetch(), homes.refetch()])
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Home import failed.') }
    finally { setImportBusy(false) }
  }

  async function suspendMember(userId: string, displayName: string) {
    if (!org || aal !== 'aal2') return
    if (!window.confirm(userId === user?.id
      ? 'Suspend your own membership? This is allowed only after another active organization administrator is in place, and you will be signed out.'
      : `Suspend ${displayName}? Their tenant and company access will be revoked immediately.`)) return
    setMemberMessage('')
    try {
      const { data, error } = await requireSupabase().rpc('admin_suspend_member', {
        p_organization_id: org,
        p_user_id: userId,
        p_reason: `Suspended from BuildTrack administration: ${displayName}`
      })
      if (error) throw error
      const orphaned = (data as { orphaned_work?: unknown[] } | null)?.orphaned_work
      setMemberMessage(`${displayName} suspended. ${Array.isArray(orphaned) ? orphaned.length : 0} work items need reassignment.`)
      if (userId === user?.id) {
        await purgeAuthorizedCache(user.id)
        await requireSupabase().auth.signOut({ scope: 'local' })
        return
      }
      await summary.refetch()
    } catch (error) { setMemberMessage(error instanceof Error ? error.message : 'Member suspension failed.') }
  }

  return <div className="stack-xl">
    <PageHeader eyebrow="CONTROL CENTER" title="Administration" description="Structure, access, rosters, and configuration are protected by organization-scoped grants and an aal2 session." actions={<button className="button primary" disabled={aal !== 'aal2'} onClick={() => setShowInvite((value) => !value)}><MailPlus />Invite user</button>} />
    {aal !== 'aal2' && <section className="mfa-callout"><KeyRound /><div><strong>Administrator MFA required</strong><p>Enroll a TOTP authenticator and elevate this session before changing access, structure, rosters, or configuration.</p></div><button className="button secondary" disabled={mfaBusy} onClick={() => void beginMfaEnrollment()}>{mfaBusy ? 'Preparing…' : 'Set up MFA'}</button></section>}
    {factor && <section className="panel mfa-enrollment"><div><h2>Scan the authenticator code</h2><p>Scan with your authenticator app, then enter its six-digit code. Keep the secret in a secure password manager.</p></div><img src={factor.qr} alt="TOTP enrollment QR code" /><code>{factor.secret}</code><form onSubmit={verifyMfa}><label className="field">Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label><button className="button primary" disabled={mfaBusy}>Verify and elevate session</button></form></section>}
    {mfaError && <div className="notice danger" role="alert">{mfaError}</div>}
    {showInvite && aal === 'aal2' && <form className="panel form-panel stack-lg" onSubmit={invite}><div className="section-heading"><div><h2>Invite tenant member</h2><p>Email delivery succeeds only after Resend domain verification.</p></div></div><div className="form-grid two">
      <label className="field">Verified email<input type="email" name="email" required /></label>
      <label className="field">Affiliation<select name="affiliation" defaultValue="internal"><option value="internal">Internal</option><option value="external">External</option></select></label>
      <label className="field">Role<select name="role_code" defaultValue="internal_contributor">{roleOptions.map((role) => <option value={role} key={role}>{role.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="field">Scope<select name="scope_kind" defaultValue="neighborhood"><option value="organization">Organization</option><option value="neighborhood">Neighborhood</option><option value="home">Home</option></select></label>
      <label className="field">Neighborhood<select name="neighborhood_id" defaultValue=""><option value="">Choose when scoped</option>{neighborhoods.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label className="field">Home<select name="home_id" defaultValue=""><option value="">Choose for home scope</option>{homes.data?.map((item) => <option value={item.id} key={item.id}>Lot {item.lot_code}</option>)}</select></label>
      <label className="field">Trade company<select name="company_id" defaultValue=""><option value="">No company</option>{companies.data?.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label>
      <label className="field">Company member type<select name="company_kind" defaultValue=""><option value="">Not applicable</option><option value="manager">Manager</option><option value="technician">Technician</option></select></label>
    </div>{inviteMessage && <div className="notice" role="status">{inviteMessage}</div>}<div className="form-actions"><button type="button" className="button ghost" onClick={() => setShowInvite(false)}>Cancel</button><button className="button primary" disabled={inviteBusy}><MailPlus />{inviteBusy ? 'Sending…' : 'Send invitation'}</button></div></form>}
    {summary.isLoading && <LoadingState label="Loading administration summary" />}
    {summary.isError && <ErrorState message={summary.error.message} retry={() => void summary.refetch()} />}
    {summary.data && <section className="admin-grid">
      <AdminCard icon={UsersRound} title="Members and roles" count={summary.data.organization_memberships} description="Invitations, scoped grants, suspension, and handover" />
      <AdminCard icon={Building2} title="Neighborhood structure" count={summary.data.neighborhoods} description="Divisions, neighborhoods, homes, and locations" />
      <AdminCard icon={Wrench} title="Companies and rosters" count={summary.data.companies} description="Trade eligibility, specialties, managers, and technicians" />
      <AdminCard icon={ClipboardList} title="Checklist templates" count={summary.data.checklist_templates} description="Draft versions, publication, and immutable history" />
      <AdminCard icon={CalendarDays} title="Calendars and escalation" description="Business time, quiet hours, reminders, and routes" />
      <AdminCard icon={ShieldCheck} title="Audit and retention" description="Access history, archive policy, and exceptions" />
    </section>}
    {memberMessage && <div className="notice" role="status">{memberMessage}</div>}
    {org && <MembersPanel organizationId={org} aal={aal} currentUserId={user?.id} neighborhoods={neighborhoods.data ?? []} homes={homes.data ?? []} onSuspend={suspendMember} />}
    {org && <AdministrationCatalogs organizationId={org} aal={aal} />}
    {org && <OperationsHealthPanel organizationId={org} canAudit={can('audit.read_scope')} canConfig={can('config.manage')} />}
    <section className="panel form-panel stack-lg"><div className="section-heading"><div><h2>Home import</h2><p>Preview duplicate and validation results before committing up to 1,000 CSV rows.</p></div><span className="state-badge state-active"><span />AAL2 required</span></div>
      <div className="form-grid two"><label className="field">Neighborhood<select value={importNeighborhood} onChange={(event) => setImportNeighborhood(event.target.value)}><option value="">Select neighborhood</option>{neighborhoods.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="field full-span">CSV data<textarea rows={8} value={importCsv} onChange={(event) => setImportCsv(event.target.value)} spellCheck={false} /></label></div>
      <p className="fine-print">Accepted headers: lot_code, address_line1, address_line2, city, state_code, postal_code, phase, external_reference.</p>
      {importError && <div className="notice danger" role="alert">{importError}</div>}
      {importResult && <div className="import-results"><strong>{importResult.preview ? 'Preview' : 'Committed'} · {importResult.inserted_count} inserted</strong><div>{importResult.rows.map((row) => <span key={row.row} className={`import-${row.status}`}>Row {row.row + 2}: {row.lot_code ?? 'no lot'} · {row.status}{row.error ? ` · ${row.error}` : ''}</span>)}</div></div>}
      <div className="form-actions"><button className="button secondary" disabled={aal !== 'aal2' || importBusy || !importNeighborhood} onClick={() => void runHomeImport(true)}>Preview import</button><button className="button primary" disabled={aal !== 'aal2' || importBusy || !importResult?.preview || importResult.rows.some((row) => row.status !== 'ready')} onClick={() => void runHomeImport(false)}>{importBusy ? 'Working…' : 'Commit valid preview'}</button></div>
    </section>
    <section className="panel"><div className="section-heading"><h2>Development decisions</h2><span className="state-badge state-active"><span />Baseline active</span></div><div className="decision-list"><Decision label="Tenant boundary" value="One builder organization per tenant" /><Decision label="Verification" value="Independent person; no self or same-company approval" /><Decision label="Notifications" value="In-app and email via Resend" /><Decision label="Offline cache" value="Explicit download; 24-hour expiry" /><Decision label="Payment boundary" value="External references only; no payment instruction" /></div></section>
  </div>
}

function AdminCard({ icon: Icon, title, count, description }: { icon: typeof UsersRound; title: string; count?: number; description: string }) {
  return <article className="admin-card"><span className="icon-tile"><Icon /></span><span><strong>{title}</strong><small>{description}</small></span>{count != null && <b>{count}</b>}</article>
}

function Decision({ label, value }: { label: string; value: string }) {
  return <div><CheckCircle2 /><span><strong>{label}</strong><small>{value}</small></span></div>
}
