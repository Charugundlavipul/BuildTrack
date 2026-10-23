import { describe, expect, it } from 'vitest'
import { validateEvidenceFile } from '../../src/lib/uploads'

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
