import { requireSupabase } from './supabase'
import { enqueueOperation } from './offline'
import type { CommandEnvelope, CommandResult, UUID } from '../types/domain'

export interface CommandOptions {
  organizationId: UUID
  userId: UUID
  aggregateId: UUID
  dependencies?: UUID[]
  allowOffline?: boolean
}

export async function runCommand<TPayload extends Record<string, unknown>, TResult>(
  commandName: string,
  envelope: CommandEnvelope<TPayload>,
  options: CommandOptions
): Promise<CommandResult<TResult> | { queued: true; operation_id: UUID }> {
  if (!navigator.onLine && options.allowOffline) {
    await enqueueOperation({
      user_id: options.userId,
      organization_id: options.organizationId,
      aggregate_id: options.aggregateId,
      command_name: commandName,
      dependencies: options.dependencies ?? [],
      envelope
    })
    return { queued: true, operation_id: envelope.operation_id }
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke('command', {
    body: { command_name: commandName, envelope }
  })
  if (error) throw error
  return data as CommandResult<TResult>
}

export function newCommand<TPayload>(payload: TPayload, expectedVersion?: number): CommandEnvelope<TPayload> {
  return {
    operation_id: crypto.randomUUID(),
    expected_version: expectedVersion,
    captured_at: new Date().toISOString(),
    payload
  }
}
