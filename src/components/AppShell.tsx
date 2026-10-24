import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import {
  Bell, Building2, ClipboardCheck, CloudOff, Download, FileBarChart, HardHat,
  Home, LogOut, Menu, RefreshCw, Settings, ShieldAlert, UserRound, Wifi, X
} from 'lucide-react'
import { useAuth } from '../features/auth/AuthProvider'
import { cn } from '../lib/utils'
import type { PermissionCode } from '../types/domain'

const navItems: Array<{ label: string; path: string; icon: typeof Home; anyOf?: PermissionCode[] }> = [
  { label: 'My work', path: 'my-work', icon: Home, anyOf: ['work.read_scope', 'work.create', 'work.triage', 'work.assign', 'work.execute_assigned', 'work.verify'] },
  { label: 'Neighborhoods', path: 'neighborhoods', icon: Building2, anyOf: ['structure.manage', 'work.read_scope', 'work.create', 'work.assign', 'inspection.manage', 'inspection.perform', 'report.read_scope'] },
  { label: 'Inspections', path: 'inspections', icon: ClipboardCheck, anyOf: ['inspection.manage', 'inspection.perform'] },
  { label: 'Reports', path: 'reports', icon: FileBarChart, anyOf: ['report.read_scope'] },
  { label: 'Administration', path: 'admin', icon: Settings, anyOf: ['access.manage', 'structure.manage', 'roster.manage', 'config.manage', 'audit.read_scope'] },
  { label: 'Sync center', path: 'sync', icon: Wifi, anyOf: ['work.create', 'work.execute_assigned', 'inspection.perform'] },
  { label: 'My account', path: 'account', icon: UserRound }
]

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function AppShell({ children }: { children: ReactNode }) {
  const { org } = useParams()
  const navigate = useNavigate()
  const { activeOrganization, organizations, setActiveOrganization, access, canAny, user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [updateApp, setUpdateApp] = useState<(() => void) | null>(null)

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
    const captureInstall = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const installed = () => setInstallPrompt(null)
    const updateReady = (event: Event) => {
      const detail = (event as CustomEvent<{ update: () => void }>).detail
      if (detail?.update) setUpdateApp(() => detail.update)
    }
    window.addEventListener('beforeinstallprompt', captureInstall)
    window.addEventListener('appinstalled', installed)
    window.addEventListener('buildtrack:update-ready', updateReady)
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstall)
      window.removeEventListener('appinstalled', installed)
      window.removeEventListener('buildtrack:update-ready', updateReady)
    }
  }, [])

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstallPrompt(null)
  }

  return (
    <div className="app-shell">
      <aside className={cn('sidebar', menuOpen && 'open')}>
        <div className="sidebar-head">
          <div className="brand-lockup"><span className="brand-mark"><HardHat /></span><span>BuildTrack</span></div>
          <button className="icon-button close-menu" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X /></button>
        </div>
        <nav aria-label="Primary navigation">
          {navItems.filter((item) => !item.anyOf || canAny(...item.anyOf)).map(({ label, path, icon: Icon }) => (
            <NavLink key={path} to={`/org/${org}/${path}`} onClick={() => setMenuOpen(false)} className={({ isActive }) => cn('nav-item', isActive && 'active')}>
              <Icon /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-block"><span className="avatar">{(access?.profile.display_name || user?.email || 'BT').slice(0, 2).toUpperCase()}</span><span><strong>{access?.profile.display_name ?? user?.user_metadata.display_name ?? 'BuildTrack user'}</strong><small>{access?.roles.map((role) => role.role_code.replaceAll('_', ' ')).join(', ') || user?.email}</small></span></div>
          <button className="nav-item" onClick={() => void signOut()}><LogOut /><span>Sign out</span></button>
        </div>
      </aside>
      {menuOpen && <button className="menu-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <div className="app-main">
        <div className="dev-banner"><ShieldAlert size={14} /> Development environment · Synthetic data only</div>
        <header className="topbar">
          <button className="icon-button menu-button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu /></button>
          <label className="org-switcher"><span className="sr-only">Active organization</span><select value={activeOrganization?.id ?? ''} onChange={(event) => {
            const next = organizations.find((item) => item.id === event.target.value)
            if (!next) return
            setActiveOrganization(next)
            navigate(`/org/${next.id}`)
          }}>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="topbar-actions">
            <span className={cn('connection', !online && 'offline')}>{online ? <Wifi /> : <CloudOff />}<span>{online ? 'Online' : 'Offline'}</span></span>
            {installPrompt && <button className="button secondary compact-button" onClick={() => void installApp()}><Download /><span>Install</span></button>}
            <NavLink className="icon-button" aria-label="Notifications" to={`/org/${org}/notifications`}><Bell /></NavLink>
          </div>
        </header>
        {updateApp && <div className="pwa-update" role="status"><span>A safer BuildTrack update is ready.</span><button className="text-button" onClick={() => updateApp()}><RefreshCw />Update now</button></div>}
        <main className="page-content">{children}</main>
      </div>
    </div>
  )
}
