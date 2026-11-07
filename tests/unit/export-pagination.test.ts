import { describe, expect, it } from 'vitest'
import { readExportRows } from '../../supabase/functions/_shared/query'

describe('bounded export pagination', () => {
  it('exports beyond the API row cap without truncating or repeating records', async () => {
    const data = Array.from({ length: 1_507 }, (_, id) => ({ id }))
    const result = await readExportRows((from, to) => Promise.resolve({ data: data.slice(from, to + 1), error: null }))
    expect(result).toEqual(data)
  })
  it('accepts the exact quota and rejects an oversized export', async () => {
    const exact = Array.from({ length: 1_000 }, (_, id) => id)
    const load = (data: number[]) => (from: number, to: number) => Promise.resolve({ data: data.slice(from, to + 1), error: null })
    expect(await readExportRows(load(exact), 1_000)).toEqual(exact)
    await expect(readExportRows(load([...exact, 1_000]), 1_000)).rejects.toThrow('Export quota exceeded')
  })
  it('fails the whole export if a later page is not authorized', async () => {
    await expect(readExportRows((from) => Promise.resolve(from === 0
      ? { data: Array.from({ length: 500 }, (_, id) => id), error: null }
      : { data: null, error: new Error('Access revoked') }))).rejects.toThrow('Access revoked')
  })
})
