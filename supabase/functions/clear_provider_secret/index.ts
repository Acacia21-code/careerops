// Write-only edge RPC: clear a provider secret. Never returns secret material.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  clearEncryptedSecret,
  clearPlaintextSecret,
  credentialsKek,
  isProviderName,
  serviceClient,
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
  if (!isProviderName(provider)) {
    return new Response(JSON.stringify({ error: 'invalid provider' }), { status: 400, headers: cors })
  }

  const svc = serviceClient()
  const kek = credentialsKek()
  // Always clear vault row if present; also clear plaintext fallback.
  const vaultClear = await clearEncryptedSecret(svc, user.id, provider)
  const plainClear = await clearPlaintextSecret(svc, user.id, provider)
  if (!vaultClear.ok && !plainClear.ok) {
    return new Response(JSON.stringify({ error: vaultClear.error || plainClear.error }), { status: 500, headers: cors })
  }
  return new Response(JSON.stringify({ ok: true, provider, on_file: false, vault: !!kek }), { headers: cors })
})
