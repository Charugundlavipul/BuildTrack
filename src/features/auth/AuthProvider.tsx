/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import type { AccessContext, OrganizationSummary, PermissionCode } from '../../types/domain'
import { offlineDb, purgeAuthorizedCache, purgeOrganizationCache, readAccessSnapshot, saveAccessSnapshot, readOrganizationSnapshot, saveOrganizationSnapshot } from '../../lib/offline'

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
  const queryCache = useQueryClient()
  const previousAccount = useRef<string | null | undefined>(undefined)
  const accountGeneration = useRef(0)
  const organizationRequest = useRef(0)
  const accessRequest = useRef(0)
  const selectedOrganization = useRef<string | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [session, setSession] = useState<Session | null>(null)
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([])
  const [activeOrganization, setActiveOrganizationState] = useState<OrganizationSummary | null>(null)
  const [access, setAccess] = useState<AccessContext | null>(null)
  const [accessLoading, setAccessLoading] = useState(false)
  const [accessError, setAccessError] = useState<string | null>(null)

  const invalidateAccountRequests = useCallback(() => {
    accountGeneration.current++
    organizationRequest.current++
    accessRequest.current++
  }, [])

  const applyOrganizations = useCallback((rows: OrganizationSummary[]) => {
    setOrganizations(rows)
    const storedId = localStorage.getItem('buildtrack.activeOrganization')
    const selected = rows.find((item) => item.id === storedId) ?? rows[0] ?? null
    if (selectedOrganization.current !== (selected?.id ?? null)) {
      accessRequest.current++
      setAccess(null)
      setAccessError(null)
    }
    selectedOrganization.current = selected?.id ?? null
    setActiveOrganizationState(selected)
    setAccessLoading(Boolean(selected))
  }, [])

  const refreshOrganizations = useCallback(async (userId?: string) => {
    const account = userId ?? previousAccount.current
    if (!supabase || !account || account !== previousAccount.current) return
    const generation = accountGeneration.current
    const request = ++organizationRequest.current
    const { data, error } = await supabase.from('my_organizations').select('*').order('name')
    if (account !== previousAccount.current || generation !== accountGeneration.current || request !== organizationRequest.current) return
    if (error) throw error
    const rows = (data ?? []) as unknown as OrganizationSummary[]
    applyOrganizations(rows)
    await saveOrganizationSnapshot(account, rows).catch(() => undefined)
  }, [applyOrganizations])

  const refreshAccess = useCallback(async () => {
    if (!supabase || !session || !activeOrganization) {
      setAccess(null)
      return
    }
    if (session.user.id !== previousAccount.current || activeOrganization.id !== selectedOrganization.current) return
    const generation = accountGeneration.current
    const request = ++accessRequest.current
    const currentRequest = () => generation === accountGeneration.current && request === accessRequest.current
      && session.user.id === previousAccount.current && activeOrganization.id === selectedOrganization.current
    setAccessLoading(true)
    setAccessError(null)
    try {
      if (!navigator.onLine) {
        const cached = await readAccessSnapshot(session.user.id, activeOrganization.id)
        if (!currentRequest()) return
        if (!cached) throw new Error('Connect to refresh access before reopening this workspace offline.')
        setAccess(cached); return
      }
      const { data, error } = await supabase.rpc('current_access', { p_organization_id: activeOrganization.id })
      if (!currentRequest()) return
      if (error) {
        if (['42501', 'PGRST301'].includes(error.code)) await purgeOrganizationCache(session.user.id, activeOrganization.id)
        throw error
      }
      const current = data as unknown as AccessContext
      if (current && (current.organization_id !== activeOrganization.id || current.user_id !== session.user.id)) throw new Error('The access response does not match the current workspace.')
      setAccess(current)
      if (current) await saveAccessSnapshot(session.user.id, current).catch(() => undefined)
    } catch (error) {
      if (!currentRequest()) return
      setAccess(null)
      setAccessError(error instanceof Error ? error.message : 'Unable to load scoped access.')
    } finally {
      if (currentRequest()) setAccessLoading(false)
    }
  }, [activeOrganization, session])

  useEffect(() => {
    if (!supabase) return
    let alive = true
    let authEvents = 0
    const applySession = (next: Session | null) => {
      const account = next?.user.id ?? null
      if (previousAccount.current !== account) invalidateAccountRequests()
      if (previousAccount.current !== undefined && previousAccount.current !== account) queryCache.clear()
      previousAccount.current = account
      setSession(next)
    }
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      if (authEvents) return
      applySession(data.session)
      const generation = accountGeneration.current
      if (data.session) {
        const cached = await readOrganizationSnapshot(data.session.user.id).catch(() => [])
        if (alive && generation === accountGeneration.current && cached.length) applyOrganizations(cached)
        if (navigator.onLine) await refreshOrganizations(data.session.user.id).catch(() => undefined)
      }
      if (alive && generation === accountGeneration.current) setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!alive) return
      authEvents++
      applySession(nextSession)
      const generation = accountGeneration.current
      setOrganizations([])
      setActiveOrganizationState(null)
      selectedOrganization.current = null
      accessRequest.current++
      setAccess(null)
      setAccessError(null)
      if (nextSession) {
        void readOrganizationSnapshot(nextSession.user.id).catch(() => []).then((cached) => {
          if (alive && generation === accountGeneration.current && cached.length) applyOrganizations(cached)
        }).finally(() => { if (!navigator.onLine && alive && generation === accountGeneration.current) setLoading(false) })
        if (navigator.onLine) void refreshOrganizations(nextSession.user.id).catch(() => undefined).finally(() => {
          if (alive && generation === accountGeneration.current) setLoading(false)
        })
      } else setLoading(false)
    })
    return () => {
      alive = false
      invalidateAccountRequests()
      listener.subscription.unsubscribe()
    }
  }, [applyOrganizations, invalidateAccountRequests, queryCache, refreshOrganizations])

  useEffect(() => {
    if (!session || !activeOrganization) return
    const timer = window.setTimeout(() => void refreshAccess(), 0)
    return () => window.clearTimeout(timer)
  }, [activeOrganization, refreshAccess, session])

  useEffect(() => {
    const reconnect = () => { if (session) { void refreshOrganizations(session.user.id).catch(() => undefined); void refreshAccess() } }
    window.addEventListener('online', reconnect)
    return () => window.removeEventListener('online', reconnect)
  }, [refreshAccess, refreshOrganizations, session])

  function setActiveOrganization(organization: OrganizationSummary) {
    selectedOrganization.current = organization.id
    accessRequest.current++
    setAccess(null)
    setAccessError(null)
    setAccessLoading(true)
    setActiveOrganizationState(organization)
    localStorage.setItem('buildtrack.activeOrganization', organization.id)
  }

  async function signOut() {
    if (!supabase || !session?.user) return
    const pending = await offlineDb.operations.where('user_id').equals(session.user.id).filter((operation) => operation.state !== 'synced').count()
    if (pending > 0 && !window.confirm(`${pending} local operation${pending === 1 ? '' : 's'} have not synchronized. Sign out and leave them safely partitioned on this device?`)) return
    window.dispatchEvent(new Event('buildtrack:logout-start'))
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
