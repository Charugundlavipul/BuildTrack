import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, MessageSquare, Plus, Reply, Search, Send, Users, X } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { useAuth } from '../auth/AuthProvider'
import { formatDateTime } from '../../lib/utils'
import { newCommand, runCommand } from '../../lib/commands'
import { qualityClient } from '../inspections/qualityData'
import { offlineAccessExpiry, offlineDb } from '../../lib/offline'
import { useChatInbox, useChatPeople, useChatThread, type ChatMessage, type ChatPerson, type ChatThread } from './messageData'

export function MessagesPage() {
  const { org } = useParams()
  const [params, setParams] = useSearchParams()
  const conversation = params.get('conversation') ?? ''
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(params.get('new') === '1')
  const [search, setSearch] = useState('')
  const inbox = useChatInbox(org, page, search)
  function open(id: string) { setCreating(false); setParams({ conversation: id }) }
  if (!org) return null
  return <div className="stack-xl"><PageHeader eyebrow="TEAM COMMUNICATION" title="Messages" description="Private conversations shared only with the people you select." actions={<button className="button primary" disabled={!navigator.onLine} onClick={() => setCreating(!creating)}><Plus />New conversation</button>} />
    {creating && <NewConversation org={org} onCreated={open} onCancel={() => setCreating(false)} />}
    <div className={`messages-layout ${conversation ? 'has-conversation' : ''}`}><aside className="panel messages-inbox" aria-label="Conversations"><div className="section-heading"><h2><MessageSquare />Conversations</h2><span>{inbox.data?.unread ?? 0} unread</span></div>
      <label className="field">Search conversations<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} /></label>
      {inbox.isLoading && <LoadingState label="Loading conversations" />}{inbox.error && <ErrorState message={inbox.error.message} retry={() => void inbox.refetch()} />}
      {!inbox.error && inbox.data && !inbox.data.rows?.length && <EmptyState title="No conversations yet" description="Start a conversation with people in your organization." />}
      {!inbox.error && inbox.data?.rows?.map((chat) => <button key={chat.id} className={`conversation-row ${conversation === chat.id ? 'active' : ''}`} aria-current={conversation === chat.id ? 'true' : undefined} onClick={() => open(chat.id)}><span><strong>{chat.title}</strong><small>{chat.audience === 'internal' ? 'Internal team' : 'Internal team and partners'}</small></span>{chat.unread > 0 && <span className="message-unread" aria-label={`${chat.unread} unread messages`}>{chat.unread}</span>}</button>)}
      {(inbox.data?.total ?? 0) > 25 && <div className="property-pagination"><button className="button ghost" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1}</span><button className="button ghost" disabled={(page + 1) * 25 >= (inbox.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next</button></div>}
    </aside><section className="panel messages-thread" aria-label="Current conversation">{conversation ? <ConversationThread key={`${org}-${conversation}`} org={org} id={conversation} onBack={() => setParams({})} /> : <EmptyState title="Choose a conversation" description="Open an existing conversation or start a new one with the people you need." />}</section></div>
  </div>
}

function NewConversation({ org, onCreated, onCancel }: { org: string; onCreated: (id: string) => void; onCancel: () => void }) {
  const { access } = useAuth()
  const [audience, setAudience] = useState(access?.membership.affiliation === 'internal' ? 'internal' : 'partners')
  const people = useChatPeople(org, audience)
  const [selected, setSelected] = useState<string[]>([])
  const [request] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cache = useQueryClient()
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    const title = String(new FormData(event.currentTarget).get('title')).trim()
    setBusy(true); setError('')
    try {
      const { data, error } = await qualityClient().rpc('project_chat_create', { p_org: org, p_request: request, p_title: title, p_users: selected, p_audience: audience })
      if (error) throw error
      if (typeof data !== 'string') throw new Error('Conversation creation was not confirmed. Retry without changing the details to recover it.')
      await cache.invalidateQueries({ queryKey: ['project-inbox', org] }); onCreated(data)
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  return <form className="panel form-panel stack-lg" aria-label="New conversation" onSubmit={create}><div className="section-heading"><h2>Start a conversation</h2><button type="button" className="icon-button" aria-label="Close new conversation" onClick={onCancel}><X /></button></div><fieldset disabled={busy} className="property-fieldset stack-lg"><div className="form-grid two"><label className="field">Conversation audience<select value={audience} onChange={(event) => { setAudience(event.target.value); setSelected([]) }}>{access?.membership.affiliation === 'internal' && <option value="internal">Internal team</option>}<option value="partners">Internal team and partners</option></select></label><label className="field">Conversation title<input name="title" required maxLength={160} placeholder="What is this conversation about?" /></label></div>
      <ParticipantPicker key={audience} people={people.data ?? []} selected={selected} onChange={setSelected} disabled={people.isLoading || Boolean(people.error)} />
      {people.isLoading && <LoadingState label="Loading people" />}{people.error && <ErrorState message={people.error.message} retry={() => void people.refetch()} />}{!people.isLoading && !people.error && !people.data?.length && <p className="form-help">No other people are available for this audience.</p>}
      <p className="notice warning">Everyone added can read the conversation’s complete shared history.</p></fieldset>{error && <ErrorState message={error} />}<div className="form-actions"><button type="button" className="button ghost" onClick={onCancel}>Cancel</button><button className="button primary" disabled={busy || !selected.length || people.isError || !navigator.onLine}>{busy ? 'Creating…' : 'Create conversation'}</button></div></form>
}

function ParticipantPicker({ people, selected, onChange, disabled }: { people: ChatPerson[]; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const selectedPeople = selected.map((id) => people.find((person) => person.user_id === id)).filter((person): person is ChatPerson => Boolean(person))
  const available = people.filter((person) => !selected.includes(person.user_id) && (
    person.display_name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ||
    (person.role_label ?? '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )).slice(0, 10)

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  function add(person: ChatPerson) {
    if (selected.length >= 49) return
    onChange([...selected, person.user_id])
    setQuery('')
    setOpen(false)
  }

  return <div className="participant-picker">
    <label className="field" htmlFor="participant-search">Participants</label>
    <div className="participant-search-wrap" ref={wrapRef}>
      <Search aria-hidden="true" />
      <input id="participant-search" type="search" role="combobox" aria-label="Search people by name or role" aria-autocomplete="list" aria-expanded={open && available.length > 0} aria-controls="participant-search-results" autoComplete="off" disabled={disabled || selected.length >= 49} value={query} placeholder={disabled ? 'Loading people…' : 'Search by name or role'} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true) }} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'Enter' && open && available[0]) { event.preventDefault(); add(available[0]) } }} />
      {open && available.length > 0 && <div className="participant-search-results" id="participant-search-results" role="listbox" aria-label="Matching people">{available.map((person) => <button type="button" role="option" aria-selected="false" key={person.user_id} className="participant-search-option" onMouseDown={(event) => event.preventDefault()} onClick={() => add(person)}><div className="participant-search-option-info"><span className="participant-search-option-name">{person.display_name}</span>{person.role_label && <small className="participant-search-option-role">{person.role_label}</small>}</div>{person.role_label && <span className="participant-role-pill">{person.role_label}</span>}</button>)}</div>}
    </div>
    {selectedPeople.length > 0 && <div className="selected-participants" aria-label="Selected participants">{selectedPeople.map((person) => <span key={person.user_id} className="selected-participant-tag"><span className="selected-participant-name">{person.display_name}</span>{person.role_label && <small className="selected-participant-role">· {person.role_label}</small>}<button type="button" aria-label={`Remove ${person.display_name}`} onClick={() => onChange(selected.filter((id) => id !== person.user_id))}><X aria-hidden="true" /></button></span>)}</div>}
  </div>
}

function ConversationThread({ org, id, onBack }: { org: string; id: string; onBack: () => void }) {
  const { user, access } = useAuth()
  const thread = useChatThread(org, id)
  const cache = useQueryClient()
  const data = thread.data?.pages[0]
  const messages = [...new Map((thread.data?.pages.flatMap((page) => page.messages ?? []) ?? []).map((row) => [row.id, row])).values()].sort((a, b) => a.seq - b.seq)
  const [body, setBody] = useState('')
  const [reply, setReply] = useState<ChatMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [queued, setQueued] = useState(false)
  const composer = useRef<HTMLTextAreaElement>(null)
  const messageList = useRef<HTMLOListElement>(null)
  const stickToBottom = useRef(true)
  const olderHeight = useRef(0)
  const [atBottom, setAtBottom] = useState(true)
  const [latestRead, setLatestRead] = useState(0)
  const outbox = useQuery({ queryKey: ['project-message-outbox', org, id, user?.id], networkMode: 'always', enabled: Boolean(user), queryFn: () => offlineDb.operations.where('[user_id+organization_id]').equals([user!.id, org]).filter((operation) => operation.command_name === 'send_project_message' && operation.envelope.payload.conversation_id === id && !['synced','access_revoked'].includes(operation.state)).toArray(), refetchInterval: 3000 })
  const newest = data?.messages?.[0]?.seq ?? 0
  useEffect(() => { const list = messageList.current; if (!list) return; if (olderHeight.current) { list.scrollTop += list.scrollHeight - olderHeight.current; olderHeight.current = 0 } else if (stickToBottom.current) list.scrollTop = list.scrollHeight }, [newest, messages.length])
  useEffect(() => {
    if (!newest || !navigator.onLine || thread.error || !atBottom) return
    const mark = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      void qualityClient().rpc('project_chat_mark_read', { p_org: org, p_conversation: id, p_seq: newest }).then(({ error }) => {
        if (!error) { setLatestRead(newest); void cache.invalidateQueries({ queryKey: ['project-inbox', org] }) }
      })
    }
    mark(); window.addEventListener('focus', mark); document.addEventListener('visibilitychange', mark)
    return () => { window.removeEventListener('focus', mark); document.removeEventListener('visibilitychange', mark) }
  }, [atBottom, cache, id, newest, org, thread.error])
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!user || busy || !body.trim()) return
    setBusy(true); setError(''); setQueued(false)
    try {
      const response = await runCommand('send_project_message', newCommand({ organization_id: org, conversation_id: id, body: body.trim(), reply_to: reply?.id ?? null }), { organizationId: org, userId: user.id, aggregateId: id, allowOffline: true })
      if (!('queued' in response) && !response.ok) throw new Error(response.error.message)
      setQueued('queued' in response); setBody(''); setReply(null)
      await offlineDb.cache.delete(draftKey).catch(() => undefined)
      await Promise.all([cache.invalidateQueries({ queryKey: ['project-thread', org, id] }), cache.invalidateQueries({ queryKey: ['project-inbox', org] }), cache.invalidateQueries({ queryKey: ['project-message-outbox', org, id] })])
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  // Keep unsent text partitioned by account and organization, alongside other
  // authorized cache. Sign-out and access revocation purge it with that cache.
  const draftKey = `${user?.id}:${org}:message-draft:${id}`
  const [draftLoaded, setDraftLoaded] = useState(false)
  const userId = user?.id
  useEffect(() => { let current = true; if (userId) void offlineDb.cache.get(draftKey).then((saved) => { if (current && saved && saved.expires_at > new Date().toISOString()) setBody(String(saved.value ?? '')) }).catch(() => { if (current) setError('The saved draft could not be restored.') }).finally(() => { if (current) setDraftLoaded(true) }); return () => { current = false } }, [draftKey, userId])
  function changeBody(value: string) {
    setBody(value); setQueued(false)
    if (user) void offlineDb.cache.put({ cache_key: draftKey, user_id: user.id, organization_id: org, entity_type: 'message_draft', entity_id: id, server_version: 1, value: value, cached_at: new Date().toISOString(), expires_at: access ? offlineAccessExpiry(access) : new Date().toISOString() }).catch(() => undefined)
  }
  if (thread.isLoading) return <LoadingState label="Loading conversation" />
  if (thread.error) return <ErrorState message={thread.error.message} retry={() => void thread.refetch()} />
  if (!data?.conversation) return <EmptyState title="Conversation unavailable" description="It may be outside your current access." />
  return <><header className="message-thread-header"><button className="icon-button message-back" aria-label="Back to conversations" onClick={onBack}><ArrowLeft /></button><div><h2>{data.conversation.title}</h2><p>{data.members?.length ?? 0} participants · {data.conversation.audience === 'internal' ? 'Internal team' : 'Internal team and partners'}</p></div></header>
    <ConversationMembers org={org} id={id} data={data} onLeave={onBack} />
    {thread.hasNextPage && <button className="button ghost" disabled={thread.isFetchingNextPage || !navigator.onLine} onClick={() => { olderHeight.current = messageList.current?.scrollHeight ?? 0; stickToBottom.current = false; setAtBottom(false); void thread.fetchNextPage() }}>{thread.isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}</button>}
    <ol className="project-message-list" ref={messageList} aria-label="Message history" onScroll={(event) => { const list = event.currentTarget; stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80; setAtBottom(stickToBottom.current) }}>{messages.map((message) => <li key={message.id} className={message.kind === 'system' ? 'project-system-message' : `project-message ${message.author_id === user?.id ? 'own' : ''}`}>{message.kind === 'system' ? <p>{message.body}<time>{formatDateTime(message.created_at)}</time></p> : <><div className="activity-entry-meta"><strong>{message.author_name}</strong><time dateTime={message.created_at}>{formatDateTime(message.created_at)}</time></div>{message.reply_to && <blockquote>{message.reply_name && <strong>{message.reply_name}</strong>}{message.reply_body ?? messages.find((row) => row.id === message.reply_to)?.body ?? 'Reply to an earlier message'}</blockquote>}<p>{message.body}</p>{message.author_id === user?.id && <small className="message-read-status">{data.members.filter((member) => member.user_id !== user.id && (member.last_read_seq ?? 0) >= message.seq).length ? `Read by ${data.members.filter((member) => member.user_id !== user.id && (member.last_read_seq ?? 0) >= message.seq).length}` : 'Sent'}</small>}<button className="text-button" aria-label={`Reply to ${message.author_name}`} onClick={() => { setReply(message); composer.current?.focus() }}><Reply />Reply</button></>}</li>)}</ol>
    {outbox.data?.filter((operation) => !messages.some((message) => message.operation_id === operation.id)).map((operation) => <div className="project-message own queued-project-message" key={operation.id}><strong>You</strong><p>{String(operation.envelope.payload.body ?? '')}</p><small>{operation.state === 'conflict' || operation.state === 'failed' ? 'Message needs attention' : 'Waiting to send'}</small> · <Link className="text-button" to={`/org/${org}/sync`}>View saved changes</Link></div>)}
    {latestRead > 0 && <span className="sr-only">Latest messages marked as read</span>}
    {queued && <div className="notice" role="status">Message saved on this device. It will send automatically when connected, if your access is still valid. <Link to={`/org/${org}/sync`}>View saved changes</Link></div>}
    {error && <ErrorState message={error} />}
    <form className="project-message-composer stack-lg" onSubmit={send}>{reply && <div className="message-replying"><span>Replying to <strong>{reply.author_name}</strong><small>{reply.body.slice(0, 160)}</small></span><button type="button" className="icon-button" aria-label="Cancel reply" onClick={() => setReply(null)}><X /></button></div>}<label className="field">Message<textarea ref={composer} value={body} disabled={busy || !draftLoaded} required maxLength={4000} rows={3} onChange={(event) => changeBody(event.target.value)} placeholder="Share an update or ask a question…" /></label><div className="activity-composer-actions"><small>{navigator.onLine ? 'Visible to everyone in this conversation.' : 'Offline: your message will be queued on this device.'}</small><button className="button primary" disabled={busy || !body.trim()}><Send />{busy ? 'Sending…' : navigator.onLine ? 'Send message' : 'Save message to send'}</button></div></form>
  </>
}

function ConversationMembers({ org, id, data, onLeave }: { org: string; id: string; data: ChatThread; onLeave: () => void }) {
  const { user } = useAuth()
  const people = useChatPeople(org, data.conversation.audience ?? 'partners')
  const [adding, setAdding] = useState('')
  const [review, setReview] = useState<{ id: string; name: string; active: boolean } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const cache = useQueryClient()
  async function apply() {
    if (!review || busy) return
    setBusy(true); setError('')
    try {
      const { error } = await qualityClient().rpc('project_chat_set_member', { p_org: org, p_conversation: id, p_user: review.id, p_active: review.active })
      if (error) throw error
      await Promise.all([cache.invalidateQueries({ queryKey: ['project-thread', org, id] }), cache.invalidateQueries({ queryKey: ['project-inbox', org] }), cache.invalidateQueries({ queryKey: ['project-message-outbox', org, id] })])
      if (review.id === user?.id && !review.active) onLeave()
      setReview(null); setAdding('')
    } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  return <details className="conversation-member-details"><summary><Users />Participants & access</summary><div className="stack-lg"><ul>{data.members?.map((person) => <li key={person.user_id}><span>{person.display_name}{person.user_id === user?.id ? ' (you)' : ''}{person.has_access === false ? ' · Access expired' : ''}</span>{(data.conversation.can_manage || person.user_id === user?.id) && <button className="text-button danger-text" disabled={busy || !navigator.onLine} onClick={() => setReview({ id: person.user_id, name: person.display_name, active: false })}>{person.user_id === user?.id ? 'Leave' : 'Remove'}</button>}</li>)}</ul>
      {data.conversation.can_manage && <div className="form-grid two"><label className="field">Add participant<select value={adding} onChange={(event) => setAdding(event.target.value)}><option value="">Choose person</option>{people.data?.filter((person) => !data.members.some((member) => member.user_id === person.user_id)).map((person) => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}</select></label><button className="button secondary" disabled={!adding || busy || !navigator.onLine} onClick={() => setReview({ id: adding, name: people.data?.find((p) => p.user_id === adding)?.display_name ?? 'This person', active: true })}>Review participant access</button></div>}
      {people.error && data.conversation.can_manage && <ErrorState message={people.error.message} />}
      {review && <div className="notice warning stack-lg"><p>{review.active ? `${review.name} will see this conversation’s complete shared history.` : `${review.name} will lose access to this conversation. Existing messages and history will remain.`}</p><div className="button-row"><button className="button ghost" disabled={busy} onClick={() => setReview(null)}>Cancel</button><button className="button primary" disabled={busy} onClick={() => void apply()}>{review.active ? 'Confirm add participant' : 'Confirm removal'}</button></div></div>}{error && <ErrorState message={error} />}
    </div></details>
}
