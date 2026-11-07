import { useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import { ErrorState, LoadingState } from '../../components/Ui'
import { requireSupabase } from '../../lib/supabase'
import { useAuth } from './AuthProvider'
import { completionKey, profileComplete, useMyProfile, type MyProfile } from './profileData'

export function ProfileRequired({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const profile = useMyProfile()
  if (location.pathname === '/complete-profile') return children
  if (!navigator.onLine && user && localStorage.getItem(completionKey(user.id)) === '1') return children
  if (!navigator.onLine && !profile.data) return <main className="centered-page"><section className="select-card"><h1>Connect to finish your profile</h1><p>Your first and last name must be saved online before you start using the portal.</p></section></main>
  if (profile.isPending) return <main className="centered-page"><LoadingState label="Loading your profile" /></main>
  if (profile.error) return <main className="centered-page"><ErrorState message={profile.error.message} retry={() => void profile.refetch()} /></main>
  if (!profileComplete(profile.data)) return <Navigate replace to={`/complete-profile?next=${encodeURIComponent(location.pathname + location.search)}`} />
  return children
}

export function ProfileForm({ profile, onboarding = false, onSaved }: { profile: MyProfile; onboarding?: boolean; onSaved?: () => void | Promise<void> }) {
  const { user, refreshAccess } = useAuth()
  const cache = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [version, setVersion] = useState(profile.version)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true); setError(''); setMessage('')
    try {
      const { data, error } = await requireSupabase().rpc('save_my_profile', {
        p_first_name: String(form.get('first_name')).trim(), p_last_name: String(form.get('last_name')).trim(),
        p_phone_number: String(form.get('phone_number') ?? '').trim(), p_contact_email: String(form.get('contact_email') ?? '').trim(),
        p_timezone: onboarding ? profile.timezone ?? '' : String(form.get('timezone') ?? '').trim(), p_expected_version: version
      })
      if (error) throw error
      const saved = data as unknown as MyProfile
      setVersion(saved.version)
      cache.setQueryData(['my-profile', user?.id], saved)
      if (user) localStorage.setItem(completionKey(user.id), '1')
      await refreshAccess()
      setMessage('Profile updated.')
      await onSaved?.()
    } catch (caught) { setError((caught as Error).message) }
    finally { setBusy(false) }
  }
  return <form className="stack-lg" onSubmit={save}><fieldset className="configuration-fields stack-lg" disabled={busy}><div className="form-grid two"><label className="field">First name<input name="first_name" autoComplete="given-name" required maxLength={80} defaultValue={profile.first_name ?? ''} /></label><label className="field">Last name<input name="last_name" autoComplete="family-name" required maxLength={80} defaultValue={profile.last_name ?? ''} /></label><label className="field">Phone number (optional)<input name="phone_number" type="tel" autoComplete="tel" maxLength={40} defaultValue={profile.phone_number ?? ''} /></label><label className="field">Contact email (optional)<input name="contact_email" type="email" autoComplete="email" maxLength={254} defaultValue={profile.contact_email ?? ''} /></label></div>{!onboarding && <label className="field">Timezone (optional)<input name="timezone" defaultValue={profile.timezone ?? ''} placeholder="America/New_York" /></label>}</fieldset><p className="fine-print">Sign-in email: <strong>{profile.account_email}</strong>. Your optional contact email does not change how you sign in.</p>{error && <div className="notice danger" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}<button className="button primary" disabled={busy || !navigator.onLine || !profile.email_verified}>{busy ? 'Saving…' : onboarding ? 'Save details and continue' : 'Save profile'}</button>{!profile.email_verified && <div className="notice warning">Verify your invitation email before saving your profile.</div>}</form>
}

export function CompleteProfilePage() {
  const profile = useMyProfile()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requested = params.get('next') ?? ''
  const destination = requested.startsWith('/org/') || requested === '/platform' || requested.startsWith('/platform/') || requested === '/organizations/select' || requested === '/account' ? requested : '/organizations/select'
  return <main className="centered-page"><section className="select-card profile-onboarding-card stack-lg"><span className="icon-tile"><UserRound /></span><div><p className="eyebrow">YOUR PROFILE</p><h1>Tell us about yourself</h1><p>Enter your first and last name to get started. Phone number and contact email are optional.</p></div>{!navigator.onLine && !profile.data ? <div className="notice warning">Connect to the internet to complete your profile.</div> : profile.isLoading ? <LoadingState label="Loading your profile" /> : profile.error ? <ErrorState message={profile.error.message} retry={() => void profile.refetch()} /> : profile.data && <ProfileForm profile={profile.data} onboarding onSaved={() => navigate(destination, { replace: true })} />}<button className="text-button" onClick={() => void signOut()}>Sign out</button></section></main>
}
