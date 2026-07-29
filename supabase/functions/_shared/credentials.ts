/**
 * Server-only provider credential helpers for CareerOps edge functions.
 * Encrypts with AES-256-GCM using edge secret CREDENTIALS_KEK.
 * Never return decrypted values to the browser.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const PROVIDER_NAMES = ['ai_key', 'kimi_key', 'humanizer_pw', 'humanizer_email'] as const
export type ProviderName = (typeof PROVIDER_NAMES)[number]

export type ProviderSecrets = {
  ai_key: string | null
  kimi_key: string | null
  humanizer_pw: string | null
  humanizer_email: string | null
}

export const ON_FILE_COL: Record<ProviderName, string> = {
  ai_key: 'ai_key_on_file',
  kimi_key: 'kimi_key_on_file',
  humanizer_pw: 'humanizer_pw_on_file',
  humanizer_email: 'humanizer_email_on_file',
}

export function isProviderName(v: unknown): v is ProviderName {
  return typeof v === 'string' && (PROVIDER_NAMES as readonly string[]).includes(v)
}

export function credentialsKek(): string | null {
  const k = (Deno.env.get('CREDENTIALS_KEK') || '').trim()
  return k || null
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  return createClient(url, key)
}

function hexBytea(bytes: Uint8Array): string {
  return '\\x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function kekBytes(kek: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  let raw: Uint8Array
  try {
    const bin = Uint8Array.from(atob(kek), (c) => c.charCodeAt(0))
    raw = bin.length === 32 ? bin : new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(kek)))
  } catch {
    raw = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(kek)))
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(plain: string, kek: string): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const key = await kekBytes(kek)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
  return { iv, ciphertext: new Uint8Array(ct) }
}

export async function decryptSecret(iv: Uint8Array, ciphertext: Uint8Array, kek: string): Promise<string> {
  const key = await kekBytes(kek)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(pt)
}

/** PostgREST may return bytea as \\xhex or base64 depending on client. */
export function coerceBytea(value: unknown): Uint8Array | null {
  if (value == null) return null
  if (value instanceof Uint8Array) return value
  if (typeof value === 'string') {
    if (value.startsWith('\\x') || value.startsWith('\\X')) {
      const hex = value.slice(2)
      const out = new Uint8Array(hex.length / 2)
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
      return out
    }
    try {
      return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
    } catch {
      return null
    }
  }
  if (Array.isArray(value)) return Uint8Array.from(value)
  return null
}

async function patchAppProfiles(ownerId: string, patch: Record<string, unknown>): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !key) return false
  try {
    const r = await fetch(`${url}/rest/v1/profiles?owner=eq.${ownerId}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Accept-Profile': 'app',
        'Content-Profile': 'app',
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
    })
    return r.ok || r.status === 404
  } catch {
    return false
  }
}

async function readAppProfilesPlaintext(ownerId: string): Promise<Partial<ProviderSecrets> & { humanizer_pass?: string | null }> {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !key) return {}
  try {
    const r = await fetch(
      `${url}/rest/v1/profiles?owner=eq.${ownerId}&select=ai_key,kimi_key,humanizer_pw,humanizer_email,humanizer_pass`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Accept-Profile': 'app',
          'Content-Profile': 'app',
        },
      },
    )
    if (!r.ok) return {}
    const rows = await r.json()
    return (Array.isArray(rows) ? rows[0] : null) || {}
  } catch {
    return {}
  }
}

async function setOnFileFlag(svc: SupabaseClient, ownerId: string, provider: ProviderName, onFile: boolean, clearPlaintext: boolean) {
  const flagCol = ON_FILE_COL[provider]
  const viewPatch: Record<string, unknown> = { [flagCol]: onFile }
  await svc.from('mt_profiles').update(viewPatch).eq('owner', ownerId)

  const appPatch: Record<string, unknown> = { [flagCol]: onFile }
  if (clearPlaintext) appPatch[provider] = null
  await patchAppProfiles(ownerId, appPatch)

  // Self-host public table may still accept plaintext column clears.
  if (clearPlaintext) {
    const full: Record<string, unknown> = { [flagCol]: onFile, [provider]: null }
    const { error } = await svc.from('mt_profiles').update(full).eq('owner', ownerId)
    if (error) {
      // Hosted view lacks secret columns — flag-only update already applied.
    }
  }
}

export async function upsertEncryptedSecret(
  svc: SupabaseClient,
  ownerId: string,
  provider: ProviderName,
  plain: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const kek = credentialsKek()
  if (!kek) return { ok: false, error: 'CREDENTIALS_KEK not configured' }
  const value = String(plain || '').trim()
  if (!value) return { ok: false, error: 'empty secret' }
  const { iv, ciphertext } = await encryptSecret(value, kek)
  const row = {
    owner: ownerId,
    provider,
    ciphertext: hexBytea(ciphertext),
    iv: hexBytea(iv),
    updated_at: new Date().toISOString(),
  }
  const { error } = await svc.from('mt_provider_secrets').upsert(row, { onConflict: 'owner,provider' })
  if (error) return { ok: false, error: error.message }
  await setOnFileFlag(svc, ownerId, provider, true, true)
  return { ok: true }
}

export async function clearEncryptedSecret(
  svc: SupabaseClient,
  ownerId: string,
  provider: ProviderName,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await svc.from('mt_provider_secrets').delete().eq('owner', ownerId).eq('provider', provider)
  if (error) return { ok: false, error: error.message }
  await setOnFileFlag(svc, ownerId, provider, false, true)
  return { ok: true }
}

/**
 * Load secrets for edge use only. Prefer vault decrypt; fall back to plaintext
 * profile columns (self-host / pre-migration). Lazily migrates plaintext → vault when KEK is set.
 */
export async function loadProviderSecrets(
  userId: string,
  opts: { migratePlaintext?: boolean } = {},
): Promise<ProviderSecrets> {
  const out: ProviderSecrets = {
    ai_key: null,
    kimi_key: null,
    humanizer_pw: null,
    humanizer_email: null,
  }
  const svc = serviceClient()
  const kek = credentialsKek()

  const { data: vaultRows } = await svc
    .from('mt_provider_secrets')
    .select('provider, ciphertext, iv')
    .eq('owner', userId)

  if (kek && Array.isArray(vaultRows)) {
    for (const row of vaultRows) {
      if (!isProviderName(row.provider)) continue
      const iv = coerceBytea(row.iv)
      const ct = coerceBytea(row.ciphertext)
      if (!iv || !ct) continue
      try {
        out[row.provider] = await decryptSecret(iv, ct, kek)
      } catch (e) {
        console.error('vault decrypt failed for', row.provider, String((e as Error)?.message || e))
      }
    }
  }

  // Self-host: mt_profiles still has plaintext columns.
  const { data: prof } = await svc
    .from('mt_profiles')
    .select('ai_key,kimi_key,humanizer_pw,humanizer_email')
    .eq('owner', userId)
    .maybeSingle()

  if (prof) {
    if (!out.ai_key && prof.ai_key) out.ai_key = String(prof.ai_key)
    if (!out.kimi_key && prof.kimi_key) out.kimi_key = String(prof.kimi_key)
    if (!out.humanizer_pw && prof.humanizer_pw) out.humanizer_pw = String(prof.humanizer_pw)
    if (!out.humanizer_email && prof.humanizer_email) out.humanizer_email = String(prof.humanizer_email)
  }

  // Hosted: client-safe view omits secrets — read leftover plaintext from app.profiles.
  if (!out.ai_key || !out.kimi_key || !out.humanizer_pw || !out.humanizer_email) {
    const p = await readAppProfilesPlaintext(userId)
    if (!out.ai_key && p.ai_key) out.ai_key = String(p.ai_key)
    if (!out.kimi_key && p.kimi_key) out.kimi_key = String(p.kimi_key)
    if (!out.humanizer_pw && (p.humanizer_pw || p.humanizer_pass)) {
      out.humanizer_pw = String(p.humanizer_pw || p.humanizer_pass)
    }
    if (!out.humanizer_email && p.humanizer_email) out.humanizer_email = String(p.humanizer_email)
  }

  if (opts.migratePlaintext !== false && kek) {
    for (const name of PROVIDER_NAMES) {
      const val = out[name]
      if (!val) continue
      const already = Array.isArray(vaultRows) && vaultRows.some((r) => r.provider === name)
      if (already) continue
      const migrated = await upsertEncryptedSecret(svc, userId, name, val)
      if (!migrated.ok) console.error('lazy vault migrate failed', name, migrated.error)
    }
  }

  return out
}

/** Persist plaintext on profile when CREDENTIALS_KEK is unset (simple self-host). */
export async function upsertPlaintextSecret(
  svc: SupabaseClient,
  ownerId: string,
  provider: ProviderName,
  plain: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const value = String(plain || '').trim()
  if (!value) return { ok: false, error: 'empty secret' }
  const patch = { [provider]: value, [ON_FILE_COL[provider]]: true }
  const { error } = await svc.from('mt_profiles').update(patch).eq('owner', ownerId)
  if (!error) return { ok: true }
  // Hosted client-safe view omits secret columns — write flags on the view + plaintext on app.profiles.
  const { error: ferr } = await svc.from('mt_profiles').update({ [ON_FILE_COL[provider]]: true }).eq('owner', ownerId)
  const appOk = await patchAppProfiles(ownerId, patch)
  if (appOk) return { ok: true }
  return { ok: false, error: ferr?.message || error.message }
}

export async function clearPlaintextSecret(
  svc: SupabaseClient,
  ownerId: string,
  provider: ProviderName,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const patch = { [provider]: null, [ON_FILE_COL[provider]]: false }
  const { error } = await svc.from('mt_profiles').update(patch).eq('owner', ownerId)
  await patchAppProfiles(ownerId, patch)
  if (error) {
    const { error: ferr } = await svc.from('mt_profiles').update({ [ON_FILE_COL[provider]]: false }).eq('owner', ownerId)
    if (ferr) return { ok: false, error: ferr.message }
  }
  return { ok: true }
}
