import { useState, type FormEvent } from 'react'
import { CheckCircle2, KeyRound, UserRound } from 'lucide-react'
import { PageHeader } from '../../components/Ui'
import { requireSupabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'

export function AccountPage() {
  const { user, access, refreshAccess } = useAuth()
  const [profileMessage, setProfileMessage] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setProfileMessage('')
    const { error } = await requireSupabase().rpc('update_my_profile', {
      p_display_name: String(form.get('display_name')).trim(),
      p_preferred_locale: 'en',
      p_timezone: String(form.get('timezone')).trim() || undefined
    })
    setBusy(false)
    if (error) setProfileMessage(error.message)
    else {
      await refreshAccess()
      setProfileMessage('Profile updated.')
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const currentPassword = String(form.get('current_password'))
    const password = String(form.get('password'))
    const confirmation = String(form.get('confirmation'))
    if (password !== confirmation) return setPasswordMessage('The new passwords do not match.')
    setBusy(true)
    setPasswordMessage('')
    const { error } = await requireSupabase().auth.updateUser({ password, current_password: currentPassword })
    setBusy(false)
    if (error) setPasswordMessage(error.message)
    else {
      setPasswordMessage('Password changed successfully.')
      event.currentTarget.reset()
    }
  }

  return <div className="stack-xl">
    <PageHeader eyebrow="MY ACCOUNT" title={access?.profile.display_name ?? 'BuildTrack user'} description={user?.email ?? ''} />
    <div className="detail-layout">
      <div className="stack-lg">
        <form className="panel form-panel stack-lg" onSubmit={updateProfile}>
          <div className="section-heading"><div><h2><UserRound />Profile</h2><p>These details identify you in authorized participant lists and audit views.</p></div></div>
          <label className="field">Display name<input name="display_name" defaultValue={access?.profile.display_name ?? ''} minLength={2} maxLength={120} required /></label>
          <label className="field">Timezone<input name="timezone" defaultValue={access?.profile.timezone ?? ''} placeholder="America/New_York" /></label>
          {profileMessage && <div className="notice" role="status"><CheckCircle2 />{profileMessage}</div>}
          <button className="button primary" disabled={busy}>Save profile</button>
        </form>
        <form className="panel form-panel stack-lg" onSubmit={changePassword}>
          <div className="section-heading"><div><h2><KeyRound />Change password</h2><p>Your current password is required for an authenticated account change.</p></div></div>
          <label className="field">Current password<input name="current_password" type="password" autoComplete="current-password" required /></label>
          <label className="field">New password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
          <label className="field">Confirm new password<input name="confirmation" type="password" autoComplete="new-password" minLength={12} required /></label>
          {passwordMessage && <div className="notice" role="status">{passwordMessage}</div>}
          <button className="button primary" disabled={busy}>Change password</button>
        </form>
      </div>
      <aside className="panel timeline-card">
        <div className="section-heading"><h2>Active access</h2></div>
        <p><strong>{access?.membership.affiliation ?? '—'}</strong> organization member</p>
        <div className="decision-list">{access?.roles.map((role) => <div key={role.id}><CheckCircle2 /><span><strong>{role.role_code.replaceAll('_', ' ')}</strong><small>{role.scope_kind}{role.neighborhood_id ? ` · ${role.neighborhood_id.slice(0, 8)}` : ''}</small></span></div>)}</div>
      </aside>
    </div>
  </div>
}
