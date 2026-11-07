import { beforeEach, describe, expect, it, vi } from 'vitest'
const mfa = vi.hoisted(() => ({ listFactors: vi.fn(), enroll: vi.fn(), unenroll: vi.fn() }))
vi.mock('../../src/lib/supabase', () => ({ requireSupabase: () => ({ auth: { mfa } }) }))
import { prepareAuthenticator } from '../../src/lib/mfa'

const verified = { id: 'verified', factor_type: 'totp', status: 'verified', friendly_name: 'My authenticator' }
const pending = { id: 'pending', factor_type: 'totp', status: 'unverified', friendly_name: 'BuildTrack administrator' }
const factors = (all: object[], totp: object[] = []) => ({ data: { all, totp }, error: null })

describe('authenticator setup recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mfa.enroll.mockResolvedValue({ data: { id: 'new', totp: { qr_code: 'qr', secret: 'secret' } }, error: null })
    mfa.unenroll.mockResolvedValue({ error: null })
  })
  it('uses the existing verified authenticator without enrollment or deletion', async () => {
    mfa.listFactors.mockResolvedValue(factors([pending, verified], [verified]))
    expect(await prepareAuthenticator(true)).toEqual({ id: 'verified' })
    expect(mfa.enroll).not.toHaveBeenCalled()
    expect(mfa.unenroll).not.toHaveBeenCalled()
  })
  it('resumes unfinished setup without causing duplicate-name errors', async () => {
    mfa.listFactors.mockResolvedValue(factors([pending]))
    expect(await prepareAuthenticator()).toEqual({ id: 'pending', pending: true })
    expect(mfa.enroll).not.toHaveBeenCalled()
    expect(mfa.unenroll).not.toHaveBeenCalled()
  })
  it('restarts only explicitly requested unfinished BuildTrack factors', async () => {
    mfa.listFactors.mockResolvedValue(factors([pending, { ...pending, id: 'unrelated', friendly_name: 'Another app' }]))
    expect(await prepareAuthenticator(true)).toEqual({ id: 'new', qr: 'qr', secret: 'secret' })
    expect(mfa.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: 'pending' })
  })
  it('creates a new setup when no authenticator exists', async () => {
    mfa.listFactors.mockResolvedValue(factors([]))
    expect(await prepareAuthenticator()).toEqual({ id: 'new', qr: 'qr', secret: 'secret' })
  })
  it('recovers an enrollment race by reusing the factor created in another tab', async () => {
    mfa.listFactors.mockResolvedValueOnce(factors([])).mockResolvedValueOnce(factors([pending]))
    mfa.enroll.mockResolvedValue({ error: new Error('Factor name already exists') })
    expect(await prepareAuthenticator()).toEqual({ id: 'pending', pending: true })
  })
  it('does not enroll or delete when the factor lookup fails', async () => {
    mfa.listFactors.mockResolvedValue({ data: null, error: new Error('Session expired') })
    await expect(prepareAuthenticator()).rejects.toThrow('Session expired')
    expect(mfa.enroll).not.toHaveBeenCalled()
    expect(mfa.unenroll).not.toHaveBeenCalled()
  })
})
