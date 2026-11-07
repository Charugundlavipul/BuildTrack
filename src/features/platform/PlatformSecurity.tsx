import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '../../lib/supabase'
import { prepareAuthenticator, type AuthenticatorSetup } from '../../lib/mfa'

export function PlatformSecurity() {
  const cache = useQueryClient()
  const [factor, setFactor] = useState<AuthenticatorSetup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function prepare(restartPending = false) {
    setBusy(true); setError('')
    try {
      setFactor(await prepareAuthenticator(restartPending))
    } catch (caught) { setError((caught as Error).message) }
    finally { setBusy(false) }
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!factor) return
    const code = String(new FormData(event.currentTarget).get('code'))
    setBusy(true); setError('')
    try {
      const { error } = await requireSupabase().auth.mfa.challengeAndVerify({ factorId: factor.id, code })
      if (error) throw error
      await Promise.all([cache.invalidateQueries({ queryKey: ['platform-access'] }), cache.invalidateQueries({ queryKey: ['admin-session-assurance'] })])
    } catch (caught) { setError((caught as Error).message) }
    finally { setBusy(false) }
  }
  return <section className="panel form-panel stack-lg"><h1>Verify platform access</h1><p>Use your authenticator to open organization onboarding and the shared role catalog.</p>{!factor ? <button className="button primary" disabled={busy} onClick={() => void prepare()}>{busy ? 'Preparing…' : 'Continue with authenticator'}</button> : <>{factor.pending && <div className="notice warning stack-lg"><p>An unfinished authenticator setup already exists. Enter its code, or start again for a new QR code.</p><button className="button secondary" disabled={busy} onClick={() => void prepare(true)}>Start setup again</button></div>}{factor.qr && <><p>Scan this code with your authenticator app.</p><img className="platform-mfa-qr" src={factor.qr} alt="Super Admin authenticator enrollment" /></>}<form className="stack-lg" onSubmit={verify}><label className="field">Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label><button className="button primary" disabled={busy}>Verify and continue</button></form></>}{error && <div className="notice danger" role="alert">{error}</div>}</section>
}
