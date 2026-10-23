import { describe, expect, it } from 'vitest'
import { parseHomeImportCsv } from '../../src/lib/csv'

describe('home import CSV', () => {
  it('parses quoted addresses and optional fields', () => {
    expect(parseHomeImportCsv('lot_code,address_line1,city\n101,"12 Main St, Unit A",Raleigh')).toEqual([
      { lot_code: '101', address_line1: '12 Main St, Unit A', city: 'Raleigh' }
    ])
  })

  it('requires the lot code header', () => {
    expect(() => parseHomeImportCsv('address_line1\n12 Main St')).toThrow(/lot_code/)
  })
})
