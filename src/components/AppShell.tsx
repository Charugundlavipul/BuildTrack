import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import {
  Bell, Building2, ClipboardCheck, CloudOff, FileBarChart, HardHat,
  Home, LogOut, Menu, Settings, ShieldAlert, Wifi, X
} from 'lucide-react'
import { useAuth } from '../features/auth/AuthProvider'
import { cn } from '../lib/utils'

const navItems = [
  { label: 'My work', path: 'my-work', icon: Home },
  { label: 'Neighborhoods', path: 'neighborhoods', icon: Building2 },
  { label: 'Inspections', path: 'inspections', icon: ClipboardCheck },
  { label: 'Reports', path: 'reports', icon: FileBarChart },
  { label: 'Administration', path: 'admin', icon: Settings },
  { label: 'Sync center', path: 'sync', icon: Wifi }
]

export function AppShell({ children }: { children: ReactNode }) {
  const { org } = useParams()
  const navigate = useNavigate()
  const { activeOrganization, organizations, setActiveOrganization, user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)

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

  return (
    <div className="app-shell">
      <aside className={cn('sidebar', menuOpen && 'open')}>
        <div className="sidebar-head">
          <div className="brand-lockup"><span className="brand-mark"><HardHat /></span><span>BuildTrack</span></div>
          <button className="icon-button close-menu" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X /></button>
        </div>
        <nav aria-label="Primary navigation">
          {navItems.map(({ label, path, icon: Icon }) => (
            <NavLink key={path} to={`/org/${org}/${path}`} onClick={() => setMenuOpen(false)} className={({ isActive }) => cn('nav-item', isActive && 'active')}>
              <Icon /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-block"><span className="avatar">{user?.email?.slice(0, 2).toUpperCase()}</span><span><strong>{user?.user_metadata.display_name ?? 'BuildTrack user'}</strong><small>{user?.email}</small></span></div>
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
            navigate(`/org/${next.id}/my-work`)
          }}>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="topbar-actions">
            <span className={cn('connection', !online && 'offline')}>{online ? <Wifi /> : <CloudOff />}{online ? 'Online' : 'Offline'}</span>
            <button className="icon-button" aria-label="Notifications"><Bell /></button>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  )
}
