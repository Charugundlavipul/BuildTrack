import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Building2, CalendarDays, CheckCircle2, ClipboardList, MailPlus, ShieldCheck, UsersRound, Wrench } from 'lucide-react'
import { ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { requireSupabase } from '../../lib/supabase'
import { useHomes, useNeighborhoods } from '../../lib/data'
import { useAuth } from '../auth/AuthProvider'
import { newCommand, runCommand } from '../../lib/commands'
import { parseHomeImportCsv } from '../../lib/csv'
import { purgeAuthorizedCache } from '../../lib/offline'
import { MembersPanel } from './MembersPanel'
import { InviteMemberForm } from './InviteMemberForm'
import { AdministrationCatalogs } from './AdministrationCatalogs'
import { OperationsHealthPanel } from './OperationsHealthPanel'
import { HomeLayoutFields } from '../properties/HomeLayoutFields'
import { usePlans } from '../inspections/qualityData'
import { usePropertyDirectory } from '../properties/propertyData'
import { useAdministrationContext } from './hierarchy'

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
  const [params] = useSearchParams()
  const { user, can } = useAuth()
  const authority = useAdministrationContext(org)
  const managesPeople = can('access.manage') || can('company.users.manage')
  const cache = useQueryClient()
  const summary = useAdminSummary(org)
  const neighborhoods = useNeighborhoods(org)
  const homes = useHomes(org)
  const [section, setSection] = useState('people')
  const aal = 'aal2'
  const [showInvite, setShowInvite] = useState(params.get('invite') === '1')
  const [importCsv, setImportCsv] = useState('lot_code,address_line1,city,state_code,postal_code\n')
  const [importNeighborhood, setImportNeighborhood] = useState('')
  const importPlans = usePlans(can('structure.manage') ? org : undefined)
  const importDirectory = usePropertyDirectory(can('structure.manage') ? org : undefined)
  const [importLayout, setImportLayout] = useState('')
  const [importPlan, setImportPlan] = useState('')
  const [importSpaces, setImportSpaces] = useState<Array<{ name: string; type: string }>>([])
  const [importBusy, setImportBusy] = useState(false)
  const [importResult, setImportResult] = useState<HomeImportResult | null>(null)
  const [importError, setImportError] = useState('')
  const [memberMessage, setMemberMessage] = useState('')

  async function runHomeImport(preview: boolean) {
    if (!org || !user || !importNeighborhood) return
    setImportBusy(true)
    setImportError('')
    try {
      const rows = parseHomeImportCsv(importCsv)
      const response = await runCommand<Record<string, unknown>, HomeImportResult>('import_homes', newCommand({
        organization_id: org,
        neighborhood_id: importNeighborhood,
        layout_mode: importLayout,
        master_plan_id: importLayout === 'plan' ? importPlan : null,
        spaces: importLayout === 'manual' ? importSpaces : [],
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
    if (!org) return
    if (!window.confirm(userId === user?.id
      ? 'Suspend your own membership? This is allowed only after another active organization administrator is in place, and you will be signed out.'
      : authority.data?.organization_admin ? `Suspend ${displayName}? Their organization and company access will be revoked.` : `Remove the access you control for ${displayName}? Their protected access and other areas will remain.`)) return
    setMemberMessage('')
    try {
      const { data, error } = await requireSupabase().rpc('admin_suspend_member', {
        p_organization_id: org,
        p_user_id: userId,
        p_reason: `Suspended from BuildTrack administration: ${displayName}`
      })
      if (error) throw error
      const orphaned = (data as { orphaned_work?: unknown[] } | null)?.orphaned_work
      const scopeOnly = (data as { scope_only?: boolean } | null)?.scope_only
      setMemberMessage(`${displayName}: ${scopeOnly ? 'local access removed' : 'membership suspended'}. ${Array.isArray(orphaned) ? orphaned.length : 0} work items need reassignment.`)
      if (userId === user?.id && !scopeOnly) {
        await purgeAuthorizedCache(user.id)
        await requireSupabase().auth.signOut({ scope: 'local' })
        return
      }
      await Promise.all([summary.refetch(), cache.invalidateQueries({ queryKey: ['admin-members', org] }), cache.invalidateQueries({ queryKey: ['administration-context', org] })])
    } catch (error) { setMemberMessage(error instanceof Error ? error.message : 'Member suspension failed.') }
  }

  const availableSections = [
    { key: 'people', label: 'People & access', allowed: managesPeople },
    { key: 'catalogs', label: 'Structure & settings', allowed: can('structure.manage') || can('roster.manage') || can('config.manage') },
    { key: 'import', label: 'Import homes', allowed: can('structure.manage') },
    { key: 'activity', label: 'Activity & policies', allowed: can('audit.read_scope') || can('config.manage') }
  ].filter((item) => item.allowed)
  const activeSection = availableSections.some((item) => item.key === section) ? section : availableSections[0]?.key
  return <div className="stack-xl">
    <PageHeader eyebrow="CONTROL CENTER" title="Administration" description="Manage your team, locations, and operating standards." actions={managesPeople ? <button className="button primary" onClick={() => setShowInvite((value) => !value)}><MailPlus />Invite user</button> : undefined} />
    {showInvite && managesPeople && org && <InviteMemberForm organizationId={org} initialCompanyId={params.get('company') ?? undefined} neighborhoods={neighborhoods.data ?? []} homes={homes.data ?? []} onClose={() => setShowInvite(false)} />}
    {summary.isLoading && <LoadingState label="Loading administration summary" />}
    {summary.isError && <ErrorState message={summary.error.message} retry={() => void summary.refetch()} />}
    <nav className="section-nav" aria-label="Administration sections">{availableSections.map(({ key, label }) => <button key={key} aria-pressed={activeSection === key} className={activeSection === key ? 'active' : ''} onClick={() => setSection(key)}>{label}</button>)}</nav>
    {summary.data && <details className="admin-overview"><summary>Organization overview</summary><section className="admin-grid">
      <AdminCard icon={UsersRound} title="Members and roles" count={summary.data.organization_memberships} description="Invitations, scoped grants, suspension, and handover" />
      <AdminCard icon={Building2} title="Neighborhood structure" count={summary.data.neighborhoods} description="Divisions, neighborhoods, homes, and locations" />
      <AdminCard icon={Wrench} title="Companies and rosters" count={summary.data.companies} description="Company categories, neighborhood eligibility, managers, and technicians" />
      <AdminCard icon={ClipboardList} title="Checklist templates" count={summary.data.checklist_templates} description="Draft versions, publication, and immutable history" />
      <AdminCard icon={CalendarDays} title="Calendars and escalation" description="Business time, quiet hours, reminders, and routes" />
      <AdminCard icon={ShieldCheck} title="Audit and retention" description="Access history, archive policy, and exceptions" />
    </section></details>}
    {memberMessage && <div className="notice" role="status">{memberMessage}</div>}
    {authority.data?.organization_admin && activeSection === 'people' && <Link className="button secondary" to={`/org/${org}/roles`}>Manage role catalog</Link>}<div hidden={activeSection !== 'people'}>{org && managesPeople && <MembersPanel organizationId={org} initialMemberId={params.get('member') ?? undefined} aal={aal} currentUserId={user?.id} neighborhoods={neighborhoods.data ?? []} homes={homes.data ?? []} onSuspend={suspendMember} />}</div>
    <div hidden={activeSection !== 'catalogs'}>{org && <AdministrationCatalogs organizationId={org} aal={aal} />}</div>
    <div hidden={activeSection !== 'import'}>
      <section className="panel form-panel stack-lg">
        <div className="section-heading"><div><h2>Home import</h2><p>Preview duplicate and validation results before committing up to 1,000 CSV rows.</p></div><span className="state-badge state-active"><span />CSV batch import</span></div>
        <div className="form-grid two"><label className="field">Neighborhood<select value={importNeighborhood} onChange={(event) => { setImportNeighborhood(event.target.value); setImportLayout(''); setImportPlan(''); setImportSpaces([]); setImportResult(null) }}><option value="">Select neighborhood</option>{neighborhoods.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="field full-span">CSV data<textarea rows={8} value={importCsv} onChange={(event) => { setImportCsv(event.target.value); setImportResult(null) }} spellCheck={false} /></label></div>
        <fieldset className="property-fieldset stack-lg" disabled={importBusy}><HomeLayoutFields mode={importLayout} setMode={(mode) => { setImportLayout(mode); setImportPlan(''); setImportResult(null) }} spaces={importSpaces} setSpaces={(next) => { setImportSpaces(next); setImportResult(null) }} onPlanChange={(id) => { setImportPlan(id); setImportResult(null) }} plans={importPlans.data?.filter((plan) => plan.active && plan.division_id === importDirectory.data?.neighborhoods.find((row) => row.id === importNeighborhood)?.division_id) ?? []} /><p className="fine-print">This layout is copied to every home in this import. Import different plans or room layouts in separate batches.</p></fieldset>
        <p className="fine-print">Accepted headers: lot_code, address_line1, address_line2, city, state_code, postal_code, external_reference.</p>
        {importError && <div className="notice danger" role="alert">{importError}</div>}
        {importResult && <div className="import-results"><strong>{importResult.preview ? 'Preview' : 'Committed'} · {importResult.inserted_count} inserted</strong><div>{importResult.rows.map((row) => <span key={row.row} className={`import-${row.status}`}>Row {row.row + 2}: {row.lot_code ?? 'no lot'} · {row.status}{row.error ? ` · ${row.error}` : ''}</span>)}</div></div>}
        <div className="form-actions"><button className="button secondary" disabled={importBusy || !importNeighborhood || !importLayout || (importLayout === 'plan' ? !importPlan : !importSpaces.length || importSpaces.some((room) => !room.name.trim() || !room.type))} onClick={() => void runHomeImport(true)}>Preview import</button><button className="button primary" disabled={importBusy || !importResult?.preview || importResult.rows.some((row) => row.status !== 'ready')} onClick={() => void runHomeImport(false)}>{importBusy ? 'Working…' : 'Commit valid preview'}</button></div>
      </section>
    </div>
    <div hidden={activeSection !== 'activity'} className="stack-xl">
      {org && <OperationsHealthPanel organizationId={org} canAudit={can('audit.read_scope')} canConfig={can('config.manage')} />}
      <section className="panel"><div className="section-heading"><h2>Operational policies</h2><span className="state-badge state-active"><span />Controls active</span></div><div className="decision-list"><Decision label="Tenant boundary" value="One builder organization per tenant" /><Decision label="Verification" value="Independent person; no self or same-company approval" /><Decision label="Notifications" value="In-app and email via Resend" /><Decision label="Offline cache" value="Automatic saving; 24-hour expiry" /><Decision label="Payment boundary" value="External references only; no payment instruction" /></div></section>
    </div>
  </div>
}

function AdminCard({ icon: Icon, title, count, description }: { icon: typeof UsersRound; title: string; count?: number; description: string }) {
  return <article className="admin-card"><span className="icon-tile"><Icon /></span><span><strong>{title}</strong><small>{description}</small></span>{count != null && <b>{count}</b>}</article>
}

function Decision({ label, value }: { label: string; value: string }) {
  return <div><CheckCircle2 /><span><strong>{label}</strong><small>{value}</small></span></div>
}
