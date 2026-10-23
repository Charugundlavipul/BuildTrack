/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import type { OrganizationSummary } from '../../types/domain'
import { offlineDb, purgeAuthorizedCache } from '../../lib/offline'

interface AuthContextValue {
  configured: boolean
  loading: boolean
  session: Session | null
  user: User | null
  organizations: OrganizationSummary[]
  activeOrganization: OrganizationSummary | null
  setActiveOrganization: (organization: OrganizationSummary) => void
  refreshOrganizations: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(Boolean(supabase))
  const [session, setSession] = useState<Session | null>(null)
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([])
  const [activeOrganization, setActiveOrganizationState] = useState<OrganizationSummary | null>(null)

  async function refreshOrganizations() {
    if (!supabase) return
    const { data, error } = await supabase.from('my_organizations').select('*').order('name')
    if (error) throw error
    const rows = (data ?? []) as unknown as OrganizationSummary[]
    setOrganizations(rows)
    const storedId = localStorage.getItem('buildtrack.activeOrganization')
    const selected = rows.find((item) => item.id === storedId) ?? rows[0] ?? null
    setActiveOrganizationState(selected)
  }

  useEffect(() => {
    if (!supabase) return
    let alive = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setLoading(false)
      if (data.session) void refreshOrganizations()
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setOrganizations([])
      setActiveOrganizationState(null)
      if (nextSession) void refreshOrganizations()
    })
    return () => {
      alive = false
      listener.subscription.unsubscribe()
    }
  }, [])

  function setActiveOrganization(organization: OrganizationSummary) {
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
    setActiveOrganization,
    refreshOrganizations,
    signOut
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
