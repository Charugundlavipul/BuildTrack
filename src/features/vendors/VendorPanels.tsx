import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowUpRight, Plus, UsersRound, Wrench } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PriorityBadge, StateBadge } from '../../components/Ui'
import { requireSupabase } from '../../lib/supabase'
import { readAllRows } from '../../lib/queryRows'
import { formatDateTime } from '../../lib/utils'
import { useParticipants } from '../../lib/data'
import { useAuth } from '../auth/AuthProvider'
import { rosterEligibility, useVendorAccess, vendorRoute, type VendorDirectory } from './vendorData'

export function VendorRosterPanel({ directory, vendorId, disabled }: { directory: VendorDirectory; vendorId: string; disabled: boolean }) {
  const { org } = useParams()
  const rows = directory.rosters.filter((row) => row.company_id === vendorId)
  const context = `company=${vendorId}`
  return <section className="panel"><div className="section-heading"><div><h2>Neighborhood eligibility <span className="property-count">{rows.length}</span></h2><p>Each entry authorizes this vendor to receive assignments in one neighborhood.</p></div>{disabled ? <button className="button secondary" disabled><Plus />Add eligibility</button> : <Link className="button secondary" to={`${vendorRoute(org!, 'rosters', 'new')}?${context}`}><Plus />Add eligibility</Link>}</div>
    {!rows.length && <EmptyState title="No neighborhood eligibility" description="Add a neighborhood before this vendor can receive assignments there." />}
    <div className="vendor-roster-list">{rows.slice(0, 20).map((row) => <article key={row.id}><span><strong>{directory.neighborhoods.find((item) => item.id === row.neighborhood_id)?.name ?? 'Neighborhood unavailable'}</strong><small>{formatDateTime(row.active_from)} → {row.active_to ? formatDateTime(row.active_to) : 'No end date'}</small></span><StateBadge state={rosterEligibility(row, directory)} /><Link className="button ghost" aria-label={`Edit eligibility for ${directory.neighborhoods.find((item) => item.id === row.neighborhood_id)?.name ?? 'neighborhood'}`} to={vendorRoute(org!, 'rosters', row.id)}>Edit eligibility<ArrowUpRight /></Link></article>)}</div>
    {!!rows.length && <div className="property-list-footer"><Link className="text-button" to={`${vendorRoute(org!, 'rosters')}?${context}`}>View all eligibility<ArrowUpRight /></Link></div>}
  </section>
}

export function VendorTeamPanel({ vendorId, directory }: { vendorId: string; directory: VendorDirectory }) {
  const { org } = useParams()
  const { can } = useAuth()
  const access = useVendorAccess(org, vendorId)
  const managesTeam = (can('access.manage') || can('company.users.manage')) && access.data?.can_manage_team === true
  const participants = useParticipants(org)
  const members = directory.memberships.filter((item) => item.company_id === vendorId && !item.revoked_at && new Date(item.active_from).getTime() <= directory.checkedAt && (!item.active_to || new Date(item.active_to).getTime() > directory.checkedAt))
  return <section className="panel"><div className="section-heading"><div><h2><UsersRound />Vendor team <span className="property-count">{members.length}</span></h2><p>Company managers, tradespeople, and field Inspectors.</p></div>{managesTeam && directory.vendors.find((item) => item.id === vendorId)?.status === 'active' && <Link className="button secondary" to={`/org/${org}/admin?invite=1&company=${vendorId}`}><Plus />Invite vendor member</Link>}</div>
    {participants.isLoading && <LoadingState label="Loading vendor team" />}
    {participants.isError && <ErrorState message={participants.error.message} retry={() => void participants.refetch()} />}
    {!members.length && <EmptyState title="No vendor team members" description="Invite a manager or assign an existing member to this company from People & access." />}
    <div className="vendor-roster-list">{members.map((member) => <article key={member.id}><span><strong>{participants.data?.find((person) => person.user_id === member.user_id)?.display_name ?? 'Company member'}</strong><small>{member.kind === 'manager' ? 'Primary contact' : 'Secondary contact'}</small></span>{managesTeam && <Link className="button ghost" to={`/org/${org}/admin?member=${encodeURIComponent(member.user_id)}`}>Manage member<ArrowUpRight /></Link>}</article>)}</div>
  </section>
}

export function VendorWorkPanel({ vendorId }: { vendorId: string }) {
  const { org } = useParams()
  const { canAny } = useAuth()
  const permitted = canAny('work.read_scope', 'work.assign', 'work.execute_assigned', 'work.verify', 'work.triage')
  const work = useQuery({
    queryKey: ['vendor-work', org, vendorId], enabled: Boolean(org && permitted),
    queryFn: async () => {
      const client = requireSupabase()
      const assignments = await readAllRows((from, to) => client.from('assignment_episodes').select('id,work_item_id,due_at').eq('organization_id', org!).eq('company_id', vendorId).is('ended_at', null).order('id').range(from, to))
      const ids = [...new Set(assignments.map((item) => item.work_item_id))]
      const rows: Array<{ id: string; title: string; state: string; priority: string; due_at: string | null }> = []
      for (let start = 0; start < ids.length; start += 200) {
        const batch = await readAllRows((from, to) => client.from('work_items').select('id,title,state,priority,due_at,current_assignment_id').eq('organization_id', org!).in('id', ids.slice(start, start + 200)).order('due_at').order('id').range(from, to))
        rows.push(...batch.filter((item) => !['verified', 'cancelled'].includes(item.state) && assignments.some((assignment) => assignment.id === item.current_assignment_id && assignment.work_item_id === item.id)))
      }
      return rows
    }
  })
  if (!permitted) return null
  return <section className="panel"><div className="section-heading"><div><h2><Wrench />Assigned work</h2><p>Active assignments visible within your work access.</p></div><span>{work.data?.length ?? 0} items</span></div>
    {work.isLoading && permitted && <LoadingState label="Loading vendor assignments" />}
    {work.isError && <ErrorState message={work.error.message} retry={() => void work.refetch()} />}
    {permitted && !work.isLoading && !work.isError && !work.data?.length && <EmptyState title="No active work in your scope" description="Current assignments to this vendor will appear here when you have access to them." />}
    <div className="vendor-roster-list">{work.data?.map((item) => <article key={item.id}><span><Link className="property-record-title" to={`/org/${org}/work/${item.id}`}>{item.title}</Link><small>Due {formatDateTime(item.due_at)}</small></span><PriorityBadge priority={item.priority} /><StateBadge state={item.state} /><Link className="icon-button" aria-label={`Open ${item.title}`} to={`/org/${org}/work/${item.id}`}><ArrowUpRight /></Link></article>)}</div>
  </section>
}
