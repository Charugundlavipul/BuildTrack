import { describe, expect, it } from 'vitest'
import { dependencyOrder } from '../../src/lib/offline'
import type { OfflineOperation } from '../../src/types/domain'

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
})
