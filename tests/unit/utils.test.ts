import { describe, expect, it } from 'vitest'
import { escapeCsvCell, humanize } from '../../src/lib/utils'
import { newCommand } from '../../src/lib/commands'

describe('shared contracts', () => {
  it('creates a unique idempotent command envelope', () => {
    const command = newCommand({ title: 'Repair' }, 3)
    expect(command.operation_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(command.expected_version).toBe(3)
    expect(command.payload).toEqual({ title: 'Repair' })
  })

  it('escapes spreadsheet formulas and embedded quotes', () => {
    expect(escapeCsvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"')
    expect(escapeCsvCell('normal')).toBe('"normal"')
  })

  it('humanizes stable state values', () => {
    expect(humanize('ready_for_verification')).toBe('Ready For Verification')
  })
})
