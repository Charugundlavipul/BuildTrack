export async function functionErrorMessage(error: unknown, fallback: string) {
  const context = (error as { context?: unknown } | null)?.context
  if (context instanceof Response) {
    const body = await context.clone().json().catch(() => null) as { error?: string | { message?: string } } | null
    if (typeof body?.error === 'string') return body.error
    if (typeof body?.error?.message === 'string') return body.error.message
  }
  return error instanceof Error ? error.message : fallback
}
