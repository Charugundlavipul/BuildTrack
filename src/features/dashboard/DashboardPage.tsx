import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowUpRight, CalendarClock, Plus, Search, ShieldCheck, UsersRound, Wrench } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, MetricCard, PageHeader, PriorityBadge, StateBadge } from '../../components/Ui'
import { useDashboardMetrics, useParticipants, useWorkItems } from '../../lib/data'
import { newCommand, runCommand } from '../../lib/commands'
import { relativeDate } from '../../lib/utils'
import { useAuth } from '../auth/AuthProvider'

const filters = ['all', 'overdue', 'blocked', 'ready_for_verification', 'critical'] as const

export function DashboardPage() {
  const { org } = useParams()
  const [filter, setFilter] = useState<(typeof filters)[number]>('all')
  const [search, setSearch] = useState('')
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const metrics = useDashboardMetrics(org)
  const work = useWorkItems(org)
  const participants = useParticipants(org)

  const filtered = useMemo(() => (work.data ?? []).filter((item) => {
    const matchesSearch = !search || `${item.title} ${item.lot_code ?? ''} ${item.address ?? ''}`.toLowerCase().includes(search.toLowerCase())
    if (!matchesSearch) return false
    if (filter === 'blocked') return item.state === 'blocked'
    if (filter === 'ready_for_verification') return item.state === 'ready_for_verification'
    if (filter === 'critical') return item.priority === 'critical'
    if (filter === 'overdue') return Boolean(item.due_at && new Date(item.due_at) < new Date() && !['verified', 'cancelled'].includes(item.state))
    return !['draft', 'verified', 'cancelled'].includes(item.state)
  }), [work.data, filter, search])

  async function bulkAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!org || !user) return
    const form = new FormData(event.currentTarget)
    const itemIds = form.getAll('item_ids').map(String)
    if (!itemIds.length) {
      setBulkMessage('Select at least one work item.')
      return
    }
    setBulkBusy(true)
    setBulkMessage('')
    try {
      const dueAt = new Date(String(form.get('due_at'))).toISOString()
      const assignee = String(form.get('internal_user_id'))
      const rows = itemIds.map((itemId) => {
        const item = work.data?.find((candidate) => candidate.id === itemId)
        return {
          item_id: itemId,
          expected_version: item?.version,
          accountable_internal_user_id: assignee,
          company_id: null,
          due_at: dueAt,
          reason: String(form.get('reason')).trim() || 'Bulk assignment'
        }
      })
      const result = await runCommand('bulk_assign_work_items', newCommand({ organization_id: org, rows }), {
        organizationId: org,
        userId: user.id,
        aggregateId: org
      })
      if ('queued' in result) setBulkMessage('Bulk assignment was queued.')
      else if (!result.ok) setBulkMessage(result.error.message)
      else {
        const data = result.data as { success_count?: number; failure_count?: number }
        setBulkMessage(`${data.success_count ?? 0} assigned; ${data.failure_count ?? 0} failed. Open failed items individually for details.`)
        await queryClient.invalidateQueries({ queryKey: ['work-items', org] })
        await queryClient.invalidateQueries({ queryKey: ['dashboard-metrics', org] })
      }
    } catch (caught) {
      setBulkMessage(caught instanceof Error ? caught.message : 'Bulk assignment failed.')
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div className="stack-xl">
      <PageHeader eyebrow="TODAY'S FIELD VIEW" title="My work" description="Prioritize what needs attention, then move each item toward an independently verified finish." actions={<Link className="button primary" to={`/org/${org}/work/new`}><Plus />New work item</Link>} />
      {metrics.isError && <ErrorState message={metrics.error.message} retry={() => void metrics.refetch()} />}
      <section className="metrics-grid" aria-label="Work summary">
        <MetricCard label="Open work" value={metrics.data?.open_count ?? '—'} helper="Excludes drafts and closed work" />
        <MetricCard label="Overdue" value={metrics.data?.overdue_count ?? '—'} helper="Blocked work remains aged" tone="danger" />
        <MetricCard label="Blocked" value={metrics.data?.blocked_count ?? '—'} helper="Waiting on a recorded cause" tone="warning" />
        <MetricCard label="Awaiting verification" value={metrics.data?.pending_verification_count ?? '—'} helper="Requires an independent decision" tone="success" />
      </section>
      <details className="panel bulk-panel">
        <summary><UsersRound />Bulk assign active work</summary>
        <form onSubmit={bulkAssign} className="stack-lg">
          <p className="muted">Select up to 500 visible items. Each row is authorized and version-checked independently, so one failure does not hide the other results.</p>
          <label className="field">Work items<select name="item_ids" multiple required size={Math.min(8, Math.max(3, filtered.length))}>{filtered.map((item) => <option key={item.id} value={item.id}>{item.lot_code ? `Lot ${item.lot_code} — ` : ''}{item.title} (v{item.version})</option>)}</select></label>
          <div className="form-grid two">
            <label className="field">Internal assignee<select name="internal_user_id" required defaultValue=""><option value="" disabled>Select an active member</option>{participants.data?.map((participant) => <option key={participant.user_id} value={participant.user_id}>{participant.display_name}</option>)}</select></label>
            <label className="field">Due date and time<input name="due_at" type="datetime-local" required /></label>
            <label className="field full-span">Assignment reason<input name="reason" maxLength={500} defaultValue="Bulk assignment" /></label>
          </div>
          {bulkMessage && <div className="notice" role="status">{bulkMessage}</div>}
          <div><button className="button primary" disabled={bulkBusy || !filtered.length}>{bulkBusy ? 'Assigning…' : 'Assign selected work'}</button></div>
        </form>
      </details>
      <section className="panel">
        <div className="panel-toolbar">
          <div className="segmented" aria-label="Work filter">{filters.map((value) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'Active' : value.replaceAll('_', ' ')}</button>)}</div>
          <label className="search-box"><Search /><span className="sr-only">Search work</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lot, address, task" /></label>
        </div>
        {work.isLoading && <LoadingState label="Loading authorized work" />}
        {work.isError && <ErrorState message={work.error.message} retry={() => void work.refetch()} />}
        {!work.isLoading && !filtered.length && <EmptyState title="No work in this view" description="Change the filters or create a new field observation." action={<Link className="button secondary" to={`/org/${org}/work/new`}>Create work</Link>} />}
        {!!filtered.length && <div className="work-list">{filtered.map((item) => (
          <Link className="work-row" key={item.id} to={`/org/${org}/work/${item.id}`}>
            <div className="work-priority-line" data-priority={item.priority} />
            <div className="work-main"><div className="work-title-line"><strong>{item.title}</strong><PriorityBadge priority={item.priority} /></div><p>{item.lot_code ? `Lot ${item.lot_code}` : 'Common area'}{item.address ? ` · ${item.address}` : ''}</p><div className="work-meta"><span><Wrench />{item.assigned_party_name ?? 'Unassigned'}</span><span className={item.due_at && new Date(item.due_at) < new Date() ? 'overdue' : ''}><CalendarClock />{relativeDate(item.due_at)}</span></div></div>
            <StateBadge state={item.state} />
            <ArrowUpRight className="row-arrow" />
          </Link>
        ))}</div>}
      </section>
      <section className="field-callout"><ShieldCheck /><div><strong>Closure stays independent</strong><p>The person who submits a correction—and anyone in the accountable trade company—cannot verify that attempt.</p></div><Link to={`/org/${org}/reports`}>View quality metrics <ArrowUpRight /></Link></section>
    </div>
  )
}
