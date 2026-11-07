import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { requireSupabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/utils'

export function NotificationsPage() {
  const { org } = useParams()
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(0)
  const notifications = useQuery({
    queryKey: ['notifications', org, page],
    enabled: Boolean(org),
    queryFn: async () => {
      const { data, error, count } = await requireSupabase().from('notifications').select('*', { count: 'exact' }).eq('organization_id', org!).is('invalidated_at', null).order('created_at', { ascending: false }).order('id').range(page * 25, page * 25 + 24)
      if (error) throw error
      return { rows: data ?? [], total: count ?? 0 }
    },
    refetchInterval: 60_000
  })
  const unreadCount = useQuery({ queryKey: ['notifications-unread', org], enabled: Boolean(org), queryFn: async () => {
    const { count, error } = await requireSupabase().from('notifications').select('id', { count: 'exact', head: true }).eq('organization_id', org!).is('invalidated_at', null).is('read_at', null)
    if (error) throw error
    return count ?? 0
  }, refetchInterval: 60_000 })

  async function markRead(id: string) {
    setActionError('')
    const { error } = await requireSupabase().from('notifications').update({ read_at: new Date().toISOString() }).eq('organization_id', org!).eq('id', id)
    if (error) setActionError(error.message)
    else await Promise.all([notifications.refetch(), unreadCount.refetch()])
  }

  async function markAllRead() {
    setBusy(true)
    setActionError('')
    const { error } = await requireSupabase().from('notifications').update({ read_at: new Date().toISOString() }).eq('organization_id', org!).is('read_at', null)
    if (error) setActionError(error.message)
    else await Promise.all([notifications.refetch(), unreadCount.refetch()])
    setBusy(false)
  }

  const unread = unreadCount.data ?? 0
  return <div className="stack-xl">
    <PageHeader eyebrow="IN-APP INBOX" title="Notifications" description="Assignments, due dates, and updates that need your attention." actions={<button className="button secondary" disabled={!unread || busy} onClick={() => void markAllRead()}><CheckCheck />{busy ? 'Marking read…' : 'Mark all read'}</button>} />
    {actionError && <ErrorState message={actionError} />}
    {notifications.isLoading && <LoadingState label="Loading notifications" />}
    {notifications.isError && <ErrorState message={notifications.error.message} retry={() => void notifications.refetch()} />}
    {unreadCount.isError && <ErrorState message={unreadCount.error.message} retry={() => void unreadCount.refetch()} />}
    {!notifications.isLoading && !notifications.isError && !notifications.data?.rows.length && <EmptyState title="No notifications" description="Assignment, due-date, verification, and inspection alerts will appear here." />}
    {!!notifications.data?.rows.length && <section className="panel notification-list">{notifications.data.rows.map((item) => <article className={item.read_at ? 'notification-row' : 'notification-row unread'} key={item.id}>
      <span className="icon-tile"><Bell /></span><div><strong>{item.title}</strong><p>{item.body}</p><small>{formatDateTime(item.created_at)}</small></div><div className="inline-actions">{item.deep_link.startsWith(`/org/${org}/`) && <Link className="button secondary" to={item.deep_link} onClick={() => void markRead(item.id)}>Open</Link>}{!item.read_at && <button className="text-button" onClick={() => void markRead(item.id)}>Mark read</button>}</div>
    </article>)}</section>}
    {notifications.data && notifications.data.total > 0 && <footer className="property-pagination"><span>{page * 25 + 1}–{Math.min(page * 25 + 25, notifications.data.total)} of {notifications.data.total} notifications · {unread} unread overall</span><div className="button-row"><button className="button ghost" disabled={!page || notifications.isFetching} onClick={() => setPage(page - 1)}>Previous</button><button className="button ghost" disabled={(page + 1) * 25 >= notifications.data.total || notifications.isFetching} onClick={() => setPage(page + 1)}>Next</button></div></footer>}
  </div>
}
