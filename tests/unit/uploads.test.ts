import { describe, expect, it } from 'vitest'
import { isAvailableCompletionEvidence, validateEvidenceFile } from '../../src/lib/uploads'
import { isCleanScanResult } from '../../supabase/functions/_shared/files'

describe('evidence validation', () => {
  it('accepts a supported file within the 20 MB boundary', () => {
    expect(() => validateEvidenceFile(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }))).not.toThrow()
  })

  it('rejects unsupported content types', () => {
    expect(() => validateEvidenceFile(new File(['script'], 'script.html', { type: 'text/html' }))).toThrow(/JPEG/)
  })

  it('rejects files over 20 MB', () => {
    const file = new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' })
    expect(() => validateEvidenceFile(file)).toThrow(/20 MB/)
  })
})

describe('completion evidence integrity', () => {
  const fresh = { status: 'ready', visibility: 'shared', purpose: 'correction', correction_attempt_id: null }
  it('requires fresh shared correction evidence for a new completion attempt', () => {
    expect(isAvailableCompletionEvidence(fresh)).toBe(true)
    expect(isAvailableCompletionEvidence({ ...fresh, correction_attempt_id: 'previous-attempt' })).toBe(false)
    expect(isAvailableCompletionEvidence({ ...fresh, purpose: 'observation' })).toBe(false)
    expect(isAvailableCompletionEvidence({ ...fresh, visibility: 'internal' })).toBe(false)
    expect(isAvailableCompletionEvidence({ ...fresh, status: 'quarantined' })).toBe(false)
  })
})

describe('malware scan results', () => {
  it('requires an explicit clean result and rejects unsafe content', () => {
    expect(isCleanScanResult({ CleanResult: true })).toBe(true)
    expect(isCleanScanResult({ CleanResult: true, ContainsExecutable: false })).toBe(true)
    expect(isCleanScanResult({ CleanResult: true, ContainsScript: true })).toBe(false)
    expect(isCleanScanResult({ CleanResult: false })).toBe(false)
  })
  it('fails closed for missing or malformed provider results', () => {
    for (const result of [null, [], {}, 'true', { CleanResult: 'false' }, { CleanResult: 'true' }, { CleanResult: true, ContainsScript: 'false' }]) {
      expect(isCleanScanResult(result)).toBe(false)
    }
  })
})
