import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'

function configuredOrigins() {
  return [...new Set([...(Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173').split(',').map((value) => value.trim()).filter(Boolean), 'https://buildtrack-five-blush.vercel.app'])]
}

function allowedOrigin(request: Request) {
  const configured = configuredOrigins()
  const origin = request.headers.get('origin') ?? configured[0]
  return configured.includes(origin) ? origin : configured[0]
}

export function corsHeaders(request: Request) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(request),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-worker-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  }
}

export function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  })
}

export function handleOptions(request: Request) {
  if (request.method !== 'OPTIONS') return null
  const origin = request.headers.get('origin')
  if (origin && !configuredOrigins().includes(origin)) return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store', 'Vary': 'Origin' } })
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

export function requireAllowedOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && !configuredOrigins().includes(origin)) throw new Error('Forbidden origin')
}

export function userClient(request: Request): SupabaseClient {
  requireAllowedOrigin(request)
  const authorization = request.headers.get('Authorization')
  if (!authorization) throw new Error('Missing authorization header')
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } }
  )
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function authenticatedUser(request: Request) {
  requireAllowedOrigin(request)
  const client = userClient(request)
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw new Error('Unauthenticated')
  return { client, user: data.user }
}

export function requireWorkerSecret(request: Request) {
  const expected = Deno.env.get('WORKER_SHARED_SECRET')
  const supplied = request.headers.get('x-worker-secret')
  if (!expected || !supplied || supplied !== expected) throw new Error('Worker authentication failed')
}

export function safeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error)
  const allowed = [
    /^(Unauthenticated|Missing authorization header|Forbidden origin)$/i,
    /^(forbidden|MFA aal2 required|not found)$/i,
    /^(command_name and envelope are required|unsupported command)$/i,
    /^(invalid|unsupported|required|conflict|access revoked|version conflict|quota).{0,180}$/i,
    /^Resend delivery is not configured$/i,
    /^Invitation was created, but email delivery failed$/i
  ]
  return allowed.some((pattern) => pattern.test(message)) ? message : fallback
}

export function errorResponse(request: Request, error: unknown, fallback: string) {
  console.error(fallback, error)
  const status = errorStatus(error)
  const code = status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 422 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR'
  return json(request, { error: safeErrorMessage(error, fallback), code }, status)
}

export function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/unauthenticated|authorization|worker authentication/i.test(message)) return 401
  if (/forbidden|permission|aal2/i.test(message)) return 403
  if (/not found/i.test(message)) return 404
  if (/quota|validation|unsupported|required|invalid/i.test(message)) return 422
  return 500
}
