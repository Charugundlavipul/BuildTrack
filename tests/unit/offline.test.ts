import { describe, expect, it } from 'vitest'
import { dependentOperations, dependencyOrder, inspectionOperationDependencies, offlineAccessExpiry, overlayInspectionOperations, type CachedInspectionDetail } from '../../src/lib/offline'
import type { AccessContext, AccessRole, OfflineOperation } from '../../src/types/domain'

function operation(id: string, dependencies: string[] = [], state: OfflineOperation['state'] = 'queued'): OfflineOperation {
  return {
    id,
    user_id: 'user',
    organization_id: 'org',
    aggregate_id: id,
    command_name: 'test',
    request_hash: id,
    envelope: { operation_id: id, payload: {} },
    state,
    dependencies,
    retries: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  }
}

describe('offline dependency ordering', () => {
  it('includes transitive local dependents in a discard without selecting unrelated or synchronized work', () => {
    const rows = [operation('root', [], 'conflict'), operation('photo', ['root']), operation('comment', ['photo']), operation('unrelated'), operation('sent', ['root'], 'synced')]
    expect(dependentOperations(rows, 'root').map((row) => row.id)).toEqual(['root', 'photo', 'comment'])
  })
  it('orders dependent operations after their prerequisites', () => {
    const result = dependencyOrder([operation('comment', ['work']), operation('work')])
    expect(result.ordered.map((item) => item.id)).toEqual(['work', 'comment'])
    expect(result.blocked).toEqual([])
  })

  it('keeps dependency cycles blocked for explicit user attention', () => {
    const result = dependencyOrder([operation('a', ['b']), operation('b', ['a'])])
    expect(result.ordered).toEqual([])
    expect(result.blocked).toHaveLength(2)
  })

  it('does not send an operation when its prerequisite is missing', () => {
    const result = dependencyOrder([operation('photo', ['missing-work'])])
    expect(result.ordered).toEqual([])
    expect(result.blocked.map((item) => item.id)).toEqual(['photo'])
  })

  it('does not automatically retry permanent failures or their dependents', () => {
    const rejected = { ...operation('work', [], 'failed'), retryable: false }
    const result = dependencyOrder([rejected, operation('photo', ['work'])], true)
    expect(result.ordered).toEqual([])
    expect(result.blocked.map((item) => item.id)).toContain('photo')
  })
})

describe('offline inspection response overlays', () => {
  const snapshot: CachedInspectionDetail = { inspection: { id: 'inspection', version: 1, neighborhood_id: 'area', home_id: 'home', status: 'in_progress' },
    questions: [{ id: 'question', label: 'Cabinet is aligned', section: 'Kitchen' }], responses: [],
    observations: [{ id: 'saved-issue', question_id: 'question', status: 'open', description: 'Old instructions', version: 2 }] }
  function batch(id: string, response: string, reason: string): OfflineOperation {
    return { ...operation(id), command_name: 'save_inspection_responses', envelope: { operation_id: id, payload: {
      inspection_id: 'inspection', responses: [{ question_id: 'question', response, reason, description: reason, observation_id: `local-${id}` }]
    } } }
  }
  it('updates an existing issue instead of duplicating it on repeated offline saves', () => {
    const result = overlayInspectionOperations(snapshot, [batch('first', 'fail', 'Adjust hinge'), batch('second', 'fail', 'Replace hinge and check alignment')])
    expect(result.observations).toHaveLength(1)
    expect(result.observations?.[0]).toMatchObject({ id: 'saved-issue', description: 'Replace hinge and check alignment', status: 'open' })
    expect(result.responses[0]).toMatchObject({ result: 'fail', explanation: 'Replace hinge and check alignment' })
    expect(snapshot.observations?.[0].description).toBe('Old instructions')
  })
  it('disregards open issues when an offline answer is corrected to pass', () => {
    const result = overlayInspectionOperations(snapshot, [batch('first', 'fail', 'Adjust hinge'), batch('second', 'pass', 'Checked and accepted')])
    expect(result.observations?.[0]).toMatchObject({ id: 'saved-issue', status: 'disregarded' })
    expect(result.responses[0].result).toBe('pass')
  })
})


describe('inspection submission dependencies', () => {
  it('waits for room observations and their photos before submitting the report', () => {
    const finding = { ...operation('finding'), command_name: 'create_work_item', envelope: { operation_id: 'finding', payload: { id: 'observation-1', inspection_id: 'inspection-1' } } }
    const photo = { ...operation('photo', ['finding']), envelope: { operation_id: 'photo', payload: { work_item_id: 'observation-1' } } }
    const answer = { ...operation('answer'), envelope: { operation_id: 'answer', payload: { inspection_id: 'inspection-1' } } }
    expect(inspectionOperationDependencies([photo, finding, answer, operation('other')], 'inspection-1')).toEqual(['finding', 'answer', 'photo'])
  })
})


describe('offline authorization expiry', () => {
  const now = Date.parse('2026-10-29T12:00:00Z')
  function access(ends: Array<string | null>): AccessContext {
    return { roles: ends.map((ends_at) => ({ ends_at }) as AccessRole) } as AccessContext
  }
  it('limits permanent grants to one day of cached access', () => {
    expect(offlineAccessExpiry(access([null]), now)).toBe('2026-10-30T12:00:00.000Z')
  })
  it('expires all cached permissions at the earliest temporary grant boundary', () => {
    expect(offlineAccessExpiry(access([null, '2026-10-29T13:00:00Z', '2026-10-29T14:00:00Z']), now)).toBe('2026-10-29T13:00:00.000Z')
  })
  it('does not extend a grant which has already expired', () => {
    expect(Date.parse(offlineAccessExpiry(access(['2026-10-29T11:00:00Z']), now))).toBeLessThan(now)
  })
})
