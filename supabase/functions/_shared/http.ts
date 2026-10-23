import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'

function allowedOrigin(request: Request) {
  const configured = (Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173').split(',').map((value) => value.trim())
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
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

export function userClient(request: Request): SupabaseClient {
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

export function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/unauthenticated|authorization/i.test(message)) return 401
  if (/forbidden|permission|aal2/i.test(message)) return 403
  if (/not found/i.test(message)) return 404
  if (/quota|validation|unsupported|required|invalid/i.test(message)) return 422
  return 500
}
