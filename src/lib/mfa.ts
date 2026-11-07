import { requireSupabase } from './supabase'

export interface AuthenticatorSetup { id: string; qr?: string; secret?: string; pending?: boolean }
const setupName = 'BuildTrack administrator'
const ownedNames = new Set([setupName, 'BuildTrack platform administration'])

/** Verified factors are always reused. An unfinished setup is restarted only by an explicit user action. */
export async function prepareAuthenticator(restartPending = false): Promise<AuthenticatorSetup> {
  const mfa = requireSupabase().auth.mfa
  const { data, error } = await mfa.listFactors()
  if (error) throw error
  const verified = data.totp.find((factor) => factor.status === 'verified')
  if (verified) return { id: verified.id }
  const pending = data.all.filter((factor) => factor.factor_type === 'totp' && factor.status === 'unverified' && ownedNames.has(factor.friendly_name ?? ''))
  if (pending.length && !restartPending) return { id: pending[0].id, pending: true }
  for (const factor of pending) {
    const { error } = await mfa.unenroll({ factorId: factor.id })
    if (error) throw error
  }
  const enrolled = await mfa.enroll({ factorType: 'totp', friendlyName: setupName })
  if (enrolled.error) {
    // Another tab may have created the factor after listFactors completed.
    const latest = await mfa.listFactors()
    const existing = latest.data?.all.find((factor) => factor.factor_type === 'totp' && (factor.status === 'verified' || ownedNames.has(factor.friendly_name ?? '')))
    if (existing) return { id: existing.id, pending: existing.status !== 'verified' }
    throw enrolled.error
  }
  return { id: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret }
}
