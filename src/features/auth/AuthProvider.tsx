/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import type { AccessContext, OrganizationSummary, PermissionCode } from '../../types/domain'
import { offlineDb, purgeAuthorizedCache, readOrganizationSnapshot, saveOrganizationSnapshot } from '../../lib/offline'

interface AuthContextValue {
  configured: boolean
  loading: boolean
  session: Session | null
  user: User | null
  organizations: OrganizationSummary[]
  activeOrganization: OrganizationSummary | null
  access: AccessContext | null
  accessLoading: boolean
  accessError: string | null
  setActiveOrganization: (organization: OrganizationSummary) => void
  refreshOrganizations: () => Promise<void>
  refreshAccess: () => Promise<void>
  can: (permission: PermissionCode) => boolean
  canAny: (...permissions: PermissionCode[]) => boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(Boolean(supabase))
  const [session, setSession] = useState<Session | null>(null)
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([])
  const [activeOrganization, setActiveOrganizationState] = useState<OrganizationSummary | null>(null)
  const [access, setAccess] = useState<AccessContext | null>(null)
  const [accessLoading, setAccessLoading] = useState(false)
  const [accessError, setAccessError] = useState<string | null>(null)

  const applyOrganizations = useCallback((rows: OrganizationSummary[]) => {
    setOrganizations(rows)
    const storedId = localStorage.getItem('buildtrack.activeOrganization')
    const selected = rows.find((item) => item.id === storedId) ?? rows[0] ?? null
    setActiveOrganizationState(selected)
    if (selected) setAccessLoading(true)
  }, [])

  const refreshOrganizations = useCallback(async (userId?: string) => {
    if (!supabase) return
    const { data, error } = await supabase.from('my_organizations').select('*').order('name')
    if (error) throw error
    const rows = (data ?? []) as unknown as OrganizationSummary[]
    applyOrganizations(rows)
    const snapshotUserId = userId ?? (await supabase.auth.getUser()).data.user?.id
    if (snapshotUserId) await saveOrganizationSnapshot(snapshotUserId, rows)
  }, [applyOrganizations])

  const refreshAccess = useCallback(async () => {
    if (!supabase || !session || !activeOrganization) {
      setAccess(null)
      return
    }
    setAccessLoading(true)
    setAccessError(null)
    try {
      const { data, error } = await supabase.rpc('current_access', { p_organization_id: activeOrganization.id })
      if (error) throw error
      setAccess(data as unknown as AccessContext)
    } catch (error) {
      setAccess(null)
      setAccessError(error instanceof Error ? error.message : 'Unable to load scoped access.')
    } finally {
      setAccessLoading(false)
    }
  }, [activeOrganization, session])

  useEffect(() => {
    if (!supabase) return
    let alive = true
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      if (data.session) {
        const cached = await readOrganizationSnapshot(data.session.user.id)
        if (alive && cached.length) applyOrganizations(cached)
        if (navigator.onLine) void refreshOrganizations(data.session.user.id).catch(() => undefined)
      }
      if (alive) setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setOrganizations([])
      setActiveOrganizationState(null)
      setAccess(null)
      setAccessError(null)
      if (nextSession) {
        void readOrganizationSnapshot(nextSession.user.id).then((cached) => {
          if (cached.length) applyOrganizations(cached)
        })
        if (navigator.onLine) void refreshOrganizations(nextSession.user.id).catch(() => undefined)
      }
    })
    return () => {
      alive = false
      listener.subscription.unsubscribe()
    }
  }, [applyOrganizations, refreshOrganizations])

  useEffect(() => {
    if (!session || !activeOrganization) return
    const timer = window.setTimeout(() => void refreshAccess(), 0)
    return () => window.clearTimeout(timer)
  }, [activeOrganization, refreshAccess, session])

  function setActiveOrganization(organization: OrganizationSummary) {
    setAccess(null)
    setAccessError(null)
    setAccessLoading(true)
    setActiveOrganizationState(organization)
    localStorage.setItem('buildtrack.activeOrganization', organization.id)
  }

  async function signOut() {
    if (!supabase || !session?.user) return
    const pending = await offlineDb.operations.where('user_id').equals(session.user.id).filter((operation) => !['synced', 'access_revoked'].includes(operation.state)).count()
    if (pending > 0 && !window.confirm(`${pending} local operation${pending === 1 ? '' : 's'} have not synchronized. Sign out and leave them safely partitioned on this device?`)) return
    await purgeAuthorizedCache(session.user.id)
    localStorage.removeItem('buildtrack.activeOrganization')
    await supabase.auth.signOut({ scope: 'local' })
  }

  const value: AuthContextValue = {
    configured: Boolean(supabase),
    loading,
    session,
    user: session?.user ?? null,
    organizations,
    activeOrganization,
    access,
    accessLoading,
    accessError,
    setActiveOrganization,
    refreshOrganizations,
    refreshAccess,
    can: (permission) => Boolean(access?.permissions.includes(permission)),
    canAny: (...permissions) => permissions.some((permission) => access?.permissions.includes(permission)),
    signOut
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
