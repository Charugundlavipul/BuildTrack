import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../../src/features/auth/AuthProvider'
import { readOrganizationSnapshot, saveAccessSnapshot, saveOrganizationSnapshot } from '../../src/lib/offline'

const backend = vi.hoisted(() => ({
  getSession: vi.fn(), organizations: vi.fn(), rpc: vi.fn(),
  listener: undefined as unknown as (event: string, next: Session | null) => void
}))
vi.mock('../../src/lib/supabase', () => ({ supabase: {
  from: () => ({ select: () => ({ order: backend.organizations }) }), rpc: backend.rpc,
  auth: {
    getSession: backend.getSession,
    onAuthStateChange: (listener: typeof backend.listener) => { backend.listener = listener; return { data: { subscription: { unsubscribe: vi.fn() } } } }
  }
} }))
vi.mock('../../src/lib/offline', () => ({
  offlineDb: {}, purgeAuthorizedCache: vi.fn(), purgeOrganizationCache: vi.fn(),
  readAccessSnapshot: vi.fn().mockResolvedValue(null), saveAccessSnapshot: vi.fn().mockResolvedValue(undefined),
  readOrganizationSnapshot: vi.fn().mockResolvedValue([]), saveOrganizationSnapshot: vi.fn().mockResolvedValue(undefined)
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function session(id: string): Session {
  return { access_token: 'fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600,
    user: { id, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-05T12:00:00Z' } }
}
const orgA = { id: 'org-a', name: 'Organization A', timezone: 'UTC', status: 'active' as const }
const orgB = { ...orgA, id: 'org-b', name: 'Organization B' }
const access = (user: string, org: string, allowed = false) => ({ data: { user_id: user, organization_id: org, permissions: allowed ? ['work.assign'] : [] }, error: null })

function Probe() {
  const auth = useAuth()
  return <><span data-testid="user">{auth.user?.id ?? 'none'}</span><span data-testid="organization">{auth.activeOrganization?.id ?? 'none'}</span>
    <span data-testid="allowed">{String(auth.can('work.assign'))}</span><span data-testid="count">{auth.organizations.length}</span>
    <span data-testid="loading">{String(auth.loading)}</span><span data-testid="access-error">{auth.accessError ?? ''}</span>
    <button onClick={() => auth.setActiveOrganization(orgB)}>Switch organization</button></>
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>)
}
beforeEach(() => {
  localStorage.clear()
  backend.getSession.mockReset().mockResolvedValue({ data: { session: session('user-a') } })
  backend.organizations.mockReset().mockResolvedValue({ data: [orgA], error: null })
  backend.rpc.mockReset()
})
afterEach(cleanup)

describe('session and workspace isolation', () => {
  it('continues online sign-in when browser cache storage is unavailable or full', async () => {
    vi.mocked(readOrganizationSnapshot).mockRejectedValueOnce(new Error('IndexedDB unavailable'))
    vi.mocked(saveOrganizationSnapshot).mockRejectedValueOnce(new Error('Storage quota exceeded'))
    vi.mocked(saveAccessSnapshot).mockRejectedValueOnce(new Error('Storage quota exceeded'))
    backend.rpc.mockResolvedValue(access('user-a', orgA.id, true))
    mount()
    await waitFor(() => expect(screen.getByTestId('allowed')).toHaveTextContent('true'))
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
    expect(screen.getByTestId('access-error')).toBeEmptyDOMElement()
  })
  it('ignores an old account access response after another account signs in', async () => {
    const old = deferred<ReturnType<typeof access>>()
    backend.organizations.mockResolvedValueOnce({ data: [orgA], error: null }).mockResolvedValue({ data: [orgB], error: null })
    backend.rpc.mockImplementation((_name, args) => args.p_organization_id === orgA.id ? old.promise : Promise.resolve(access('user-b', orgB.id)))
    mount()
    await waitFor(() => expect(backend.rpc).toHaveBeenCalled())
    act(() => backend.listener('SIGNED_IN', session('user-b')))
    await waitFor(() => expect(screen.getByTestId('organization')).toHaveTextContent(orgB.id))
    await act(async () => { old.resolve(access('user-a', orgA.id, true)); await old.promise })
    expect(screen.getByTestId('user')).toHaveTextContent('user-b')
    expect(screen.getByTestId('allowed')).toHaveTextContent('false')
  })

  it('does not repopulate organization data when an old request finishes after logout', async () => {
    const old = deferred<{ data: typeof orgA[]; error: null }>()
    backend.organizations.mockReturnValue(old.promise)
    mount()
    await waitFor(() => expect(backend.organizations).toHaveBeenCalled())
    act(() => backend.listener('SIGNED_OUT', null))
    await act(async () => { old.resolve({ data: [orgA], error: null }); await old.promise })
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(screen.getByTestId('organization')).toHaveTextContent('none')
    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })

  it('ignores permissions arriving from a previously selected organization', async () => {
    const old = deferred<ReturnType<typeof access>>()
    backend.organizations.mockResolvedValue({ data: [orgA, orgB], error: null })
    backend.rpc.mockImplementation((_name, args) => args.p_organization_id === orgA.id ? old.promise : Promise.resolve(access('user-a', orgB.id)))
    mount()
    await waitFor(() => expect(backend.rpc).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Switch organization' }))
    await waitFor(() => expect(screen.getByTestId('organization')).toHaveTextContent(orgB.id))
    await act(async () => { old.resolve(access('user-a', orgA.id, true)); await old.promise })
    expect(screen.getByTestId('allowed')).toHaveTextContent('false')
  })

  it('does not restore a stale initial session over a newer sign-in event', async () => {
    const initial = deferred<{ data: { session: Session } }>()
    backend.getSession.mockReturnValue(initial.promise)
    backend.organizations.mockResolvedValue({ data: [orgB], error: null })
    backend.rpc.mockResolvedValue(access('user-b', orgB.id))
    mount()
    act(() => backend.listener('SIGNED_IN', session('user-b')))
    await waitFor(() => expect(screen.getByTestId('organization')).toHaveTextContent(orgB.id))
    await act(async () => { initial.resolve({ data: { session: session('user-a') } }); await initial.promise })
    expect(screen.getByTestId('user')).toHaveTextContent('user-b')
  })
})
