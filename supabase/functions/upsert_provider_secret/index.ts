// Write-only edge RPC: store a provider secret server-side.
// With CREDENTIALS_KEK → encrypted mt_provider_secrets.
// Without KEK → plaintext mt_profiles columns (self-host tradeoff).
// Never returns the secret value.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  credentialsKek,
  isProviderName,
  serviceClient,
  upsertEncryptedSecret,
  upsertPlaintextSecret,
} from '../_shared/credentials.ts'

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const auth = req.headers.get('Authorization') || ''
  const sb = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_ANON_KEY') || '', {
    global: { headers: { Authorization: auth } },
  })
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401, headers: cors })

  const body = await req.json().catch(() => ({}))
  const provider = body?.provider
  const value = body?.value
  if (!isProviderName(provider)) {
    return new Response(JSON.stringify({ error: 'invalid provider' }), { status: 400, headers: cors })
  }
  if (typeof value !== 'string' || !value.trim()) {
    return new Response(JSON.stringify({ error: 'empty value' }), { status: 400, headers: cors })
  }

  const svc = serviceClient()
  const kek = credentialsKek()
  const result = kek
    ? await upsertEncryptedSecret(svc, user.id, provider, value)
    : await upsertPlaintextSecret(svc, user.id, provider, value)

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: cors })
  }
  return new Response(JSON.stringify({ ok: true, provider, on_file: true, vault: !!kek }), { headers: cors })
})
