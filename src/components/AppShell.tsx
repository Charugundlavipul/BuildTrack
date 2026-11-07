import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useParams } from 'react-router-dom'
import {
  Bell, Building2, ClipboardCheck, CloudOff, FileBarChart,
  Home, LogOut, Menu, MessageSquare, RefreshCw, Settings, ShieldCheck, UserRound, Wifi, Wrench, X
} from 'lucide-react'
import { useAuth } from '../features/auth/AuthProvider'
import { cn } from '../lib/utils'
import type { PermissionCode } from '../types/domain'
import { usePlatformAccess } from '../features/platform/platformData'
import { ProjectMessagesButton } from '../features/messages/ProjectMessagesButton'
import { Brand } from './Brand'

const navItems: Array<{ label: string; path: string; icon: typeof Home; anyOf?: PermissionCode[]; orgAdminOnly?: boolean }> = [
  { label: 'My work', path: 'my-work', icon: Home, anyOf: ['work.read_scope', 'work.create', 'work.triage', 'work.assign', 'work.execute_assigned', 'work.verify', 'inspection.findings.create'] },
  { label: 'Neighborhoods', path: 'neighborhoods', icon: Building2, anyOf: ['structure.manage', 'work.read_scope', 'work.create', 'work.assign', 'inspection.manage', 'inspection.perform', 'report.read_scope'] },
  { label: 'Inspections', path: 'inspections', icon: ClipboardCheck, anyOf: ['inspection.manage', 'inspection.perform', 'company.users.manage'] },
  { label: 'Reports', path: 'reports', icon: FileBarChart, anyOf: ['report.read_scope'] },
  { label: 'Properties', path: 'properties', icon: Building2, anyOf: ['structure.manage'] },
  { label: 'Floor plans', path: 'plans', icon: Building2, anyOf: ['plan.manage', 'structure.manage'] },
  { label: 'Vendor management', path: 'vendors', icon: Wrench, anyOf: ['roster.manage', 'company.users.manage'] },
  { label: 'Administration', path: 'admin', icon: Settings, anyOf: ['access.manage', 'company.users.manage', 'structure.manage', 'roster.manage', 'config.manage', 'audit.read_scope'] },
  { label: 'Role catalog', path: 'roles', icon: ShieldCheck, anyOf: ['access.manage'], orgAdminOnly: true },
  { label: 'Sync center', path: 'sync', icon: Wifi, anyOf: ['work.create', 'work.execute_assigned', 'inspection.perform'] },
  { label: 'Messages', path: 'messages', icon: MessageSquare },
  { label: 'My account', path: 'account', icon: UserRound }
]

export function AppShell({ children }: { children: ReactNode }) {
  const { org } = useParams()
  const { activeOrganization, access, canAny, user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const location = useLocation()
  const platform = usePlatformAccess()
  const [online, setOnline] = useState(navigator.onLine)
  const [updateApp, setUpdateApp] = useState<(() => void) | null>(null)
  const isOrgAdmin = Boolean(access?.roles.some((role) => role.scope_kind === 'organization') && canAny('access.manage'))

  useEffect(() => {
    if (!menuOpen) return
    const trigger = menuButton.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sidebar.current?.querySelector<HTMLElement>('button, a')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
      if (event.key !== 'Tab') return
      const elements = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('button, a[href], select') ?? []).filter((element) => element.offsetParent !== null)
      const first = elements[0]
      const last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKey)
      trigger?.focus()
    }
  }, [menuOpen])

  useEffect(() => {
    document.getElementById('main-content')?.focus({ preventScroll: true })
  }, [location.pathname])

  useEffect(() => {
    const setConnected = () => setOnline(true)
    const setDisconnected = () => setOnline(false)
    window.addEventListener('online', setConnected)
    window.addEventListener('offline', setDisconnected)
    return () => {
      window.removeEventListener('online', setConnected)
      window.removeEventListener('offline', setDisconnected)
    }
  }, [])

  useEffect(() => {
    const updateReady = (event: Event) => {
      const detail = (event as CustomEvent<{ update: () => void }>).detail
      if (detail?.update) setUpdateApp(() => detail.update)
    }
    window.addEventListener('buildtrack:update-ready', updateReady)
    return () => {
      window.removeEventListener('buildtrack:update-ready', updateReady)
    }
  }, [])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside ref={sidebar} id="primary-sidebar" className={cn('sidebar', menuOpen && 'open')}>
        <div className="sidebar-head">
          <Brand />
          <button className="icon-button close-menu" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X /></button>
        </div>
        <nav aria-label="Primary navigation">
          {navItems.filter((item) => (!item.anyOf || canAny(...item.anyOf)) && (!item.orgAdminOnly || isOrgAdmin) && !(item.path === 'neighborhoods' && canAny('structure.manage'))).map(({ label, path, icon: Icon }) => (
            <NavLink key={path} to={`/org/${org}/${path}`} onClick={() => setMenuOpen(false)} className={({ isActive }) => cn('nav-item', (isActive || path === 'properties' && location.pathname.startsWith(`/org/${org}/homes/`)) && 'active')}>
              <Icon /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {platform.data?.administrator && <NavLink className="nav-item" to="/platform">Super Admin portal</NavLink>}
          <div className="user-block"><span className="avatar">{(access?.profile.display_name || user?.email || 'BT').slice(0, 2).toUpperCase()}</span><span><strong>{access?.profile.display_name ?? user?.user_metadata.display_name ?? 'BuildTrack user'}</strong><small>{access?.roles.map((role) => role.role_label ?? role.role_code.replaceAll('_', ' ')).join(', ') || user?.email}</small></span></div>
          <button className="nav-item" onClick={() => void signOut()}><LogOut /><span>Sign out</span></button>
        </div>
      </aside>
      {menuOpen && <button className="menu-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <div className="app-main">
        <header className="topbar">
          <button ref={menuButton} className="icon-button menu-button" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="primary-sidebar" onClick={() => setMenuOpen(true)}><Menu /></button>
          <div className="org-switcher org-name" aria-label="Active organization">{activeOrganization?.name ?? 'BuildTrack'}</div>
          <div className="topbar-actions">
            <span className={cn('connection', !online && 'offline')}>{online ? <Wifi /> : <CloudOff />}<span>{online ? 'Online' : 'Offline'}</span></span>
            {org && <ProjectMessagesButton org={org} />}
            <NavLink className="icon-button" aria-label="Notifications" to={`/org/${org}/notifications`}><Bell /></NavLink>
          </div>
        </header>
        {updateApp && <div className="pwa-update" role="status"><span>A safer BuildTrack update is ready.</span><button className="text-button" onClick={() => updateApp()}><RefreshCw />Update now</button></div>}
        <main id="main-content" tabIndex={-1} className="page-content" inert={menuOpen}>{children}</main>
      </div>
    </div>
  )
}
