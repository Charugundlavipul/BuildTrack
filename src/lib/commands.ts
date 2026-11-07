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
  if (!navigator.onLine) {
    if (options.allowOffline) {
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
    throw new Error('You are currently offline. Please reconnect to the internet to perform this action.')
  }

  const client = requireSupabase()
  try {
    const { data, error } = await client.functions.invoke('command', {
      body: { command_name: commandName, envelope }
    })
    if (error) throw error
    return data as CommandResult<TResult>
  } catch (error) {
    const context = (error as { context?: unknown } | null)?.context
    if (context instanceof Response) {
      try {
        const body = await context.clone().json() as { error?: string | { message?: string } }
        const message = typeof body?.error === 'string' ? body.error : body?.error?.message
        if (message) (error as Error).message = message
      } catch {
        // ignore json parse error
      }
    }
    // Only queue if connection was actually lost (!navigator.onLine)
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
    // When internet is present, always throw the error immediately rather than queuing
    throw error
  }
}

export function newCommand<TPayload>(payload: TPayload, expectedVersion?: number): CommandEnvelope<TPayload> {
  return {
    operation_id: crypto.randomUUID(),
    expected_version: expectedVersion,
    captured_at: new Date().toISOString(),
    payload
  }
}
