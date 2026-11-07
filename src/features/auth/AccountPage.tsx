import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, KeyRound, UserRound } from 'lucide-react'
import { ErrorState, LoadingState, PageHeader } from '../../components/Ui'
import { requireSupabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'
import { ProfileForm } from './ProfileDetails'
import { useMyProfile } from './profileData'

export function AccountPage() {
  const { user, access } = useAuth()
  const { org } = useParams()
  const profile = useMyProfile()
  const [passwordMessage, setPasswordMessage] = useState('')
  const [busy, setBusy] = useState(false)

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
    {!org && <Link className="text-button" to="/organizations/select">← Organization workspaces</Link>}
    <PageHeader eyebrow="MY ACCOUNT" title={profile.data?.display_name ?? access?.profile.display_name ?? 'BuildTrack user'} description={user?.email ?? ''} />
    <div className={access ? "detail-layout" : "narrow-page"}>
      <div className="stack-lg">
        <section className="panel form-panel stack-lg"><div className="section-heading"><div><h2><UserRound />Profile</h2><p>Your name appears on assignments, comments, and activity.</p></div></div>{profile.isLoading ? <LoadingState label="Loading profile" /> : profile.error ? <ErrorState message={profile.error.message} retry={() => void profile.refetch()} /> : profile.data && <ProfileForm profile={profile.data} />}</section>
        <form className="panel form-panel stack-lg" onSubmit={changePassword}>
          <div className="section-heading"><div><h2><KeyRound />Change password</h2><p>Your current password is required for an authenticated account change.</p></div></div>
          <label className="field">Current password<input name="current_password" type="password" autoComplete="current-password" required /></label>
          <label className="field">New password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
          <label className="field">Confirm new password<input name="confirmation" type="password" autoComplete="new-password" minLength={12} required /></label>
          {passwordMessage && <div className="notice" role="status">{passwordMessage}</div>}
          <button className="button primary" disabled={busy}>Change password</button>
        </form>
      </div>
      {access && <aside className="panel timeline-card">
        <div className="section-heading"><h2>Active access</h2></div>
        <p><strong>{access?.membership.affiliation ?? '—'}</strong> organization member</p>
        <div className="access-list">{access?.roles.map((role) => <div key={role.id}><CheckCircle2 /><span><strong>{role.role_label ?? role.role_code.replaceAll('_', ' ')}</strong><small>{role.scope_kind}{role.neighborhood_id ? ` · ${role.neighborhood_id.slice(0, 8)}` : ''}</small></span></div>)}</div>
      </aside>}
    </div>
  </div>
}
