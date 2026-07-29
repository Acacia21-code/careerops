/**
 * Settings helpers: OpenAI-compat prefs (browser-local) + provider secret vault UX.
 * Hosted secrets go through upsert_provider_secret / clear_provider_secret edge RPCs.
 * Decrypted values never appear in the profile row or UI inputs after save.
 */

export const PROVIDER_SECRET_NAMES = Object.freeze([
  'ai_key',
  'kimi_key',
  'humanizer_pw',
  'humanizer_email',
])

export function createOpenaiPrefsStore(ownerId) {
  const key = () => `co_openai_prefs_${ownerId() || 'anon'}`

  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(key()) || '{}') || {}
      return {
        base: String(value.base || '').replace(/\/+$/, ''),
        key: String(value.key || ''),
        model: String(value.model || 'gpt-4o-mini'),
      }
    } catch {
      return { base: '', key: '', model: 'gpt-4o-mini' }
    }
  }

  function save(patch) {
    const current = load()
    const next = {
      base: patch.base != null ? String(patch.base).replace(/\/+$/, '') : current.base,
      key: patch.key === 'remove' ? '' : (patch.key ? String(patch.key) : current.key),
      model: patch.model != null ? String(patch.model || 'gpt-4o-mini') : current.model,
    }
    localStorage.setItem(key(), JSON.stringify(next))
    return next
  }

  return { load, save }
}

export function createDailyUsageStore(ownerId, now = () => new Date()) {
  const key = () => `co_usage_${ownerId() || 'anon'}_${now().toISOString().slice(0, 10)}`
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(key()) || '{"match":0,"generate":0}') || { match: 0, generate: 0 }
    } catch {
      return { match: 0, generate: 0 }
    }
  }
  const save = (usage) => {
    localStorage.setItem(key(), JSON.stringify(usage))
    return usage
  }
  return { load, save }
}

/** True when a provider secret is on file (vault flag and/or self-host plaintext). */
export function providerSecretOnFile(profile, provider) {
  if (!profile || !provider) return false
  const flag = profile[`${provider}_on_file`]
  if (flag === true) return true
  if (flag === false && profile[provider] == null) return false
  const raw = profile[provider]
  if (typeof raw === 'string' && raw.trim()) return true
  if (provider === 'humanizer_pw') {
    const legacy = profile.humanizer_pass
    if (typeof legacy === 'string' && legacy.trim()) return true
  }
  return false
}

export function anyByoKeyOnFile(profile, openaiKey = '') {
  return !!(
    providerSecretOnFile(profile, 'ai_key')
    || providerSecretOnFile(profile, 'kimi_key')
    || (openaiKey && String(openaiKey).trim())
  )
}

/** Short non-revealing status for Settings (never echoes the secret). */
export function secretOnFileLabel(onFile) {
  return onFile ? 'key on file' : 'not set'
}

/**
 * Persist one provider secret via edge RPC when available; else plaintext profile update (self-host).
 * @returns {{ ok: boolean, on_file?: boolean, vault?: boolean, error?: string, mode?: string }}
 */
export async function writeProviderSecret(sb, { provider, value, profileOwnerId, fallbackProfileUpdate }) {
  const v = String(value || '').trim()
  if (!v) return { ok: false, error: 'empty' }
  if (v === 'remove') return clearProviderSecret(sb, { provider, profileOwnerId, fallbackProfileUpdate })

  try {
    const { data, error } = await sb.functions.invoke('upsert_provider_secret', {
      body: { provider, value: v },
    })
    if (!error && data && !data.error) {
      return { ok: true, on_file: true, vault: !!data.vault, mode: 'edge' }
    }
    // Function missing / not deployed → fall through to plaintext self-host path.
    const msg = (error && (await fnErrorMessage(error))) || data?.error || ''
    if (msg && !/not found|404|Failed to send|FunctionsRelayError|FunctionsHttpError/i.test(msg)
      && !/CREDENTIALS_KEK|empty value|invalid provider/i.test(msg)) {
      // Real edge error (e.g. auth) — still try fallback for self-host without the function.
    }
  } catch (_e) { /* fall through */ }

  if (typeof fallbackProfileUpdate === 'function') {
    const err = await fallbackProfileUpdate({ [provider]: v, [`${provider}_on_file`]: true })
    if (err) return { ok: false, error: err, mode: 'plaintext' }
    return { ok: true, on_file: true, vault: false, mode: 'plaintext' }
  }
  if (profileOwnerId) {
    const { error } = await sb.from('mt_profiles').update({
      [provider]: v,
      [`${provider}_on_file`]: true,
    }).eq('owner', profileOwnerId)
    if (error) return { ok: false, error: error.message, mode: 'plaintext' }
    return { ok: true, on_file: true, vault: false, mode: 'plaintext' }
  }
  return { ok: false, error: 'no write path' }
}

export async function clearProviderSecret(sb, { provider, profileOwnerId, fallbackProfileUpdate }) {
  try {
    const { data, error } = await sb.functions.invoke('clear_provider_secret', {
      body: { provider },
    })
    if (!error && data && !data.error) {
      return { ok: true, on_file: false, vault: !!data.vault, mode: 'edge' }
    }
  } catch (_e) { /* fall through */ }

  if (typeof fallbackProfileUpdate === 'function') {
    const err = await fallbackProfileUpdate({ [provider]: null, [`${provider}_on_file`]: false })
    if (err) return { ok: false, error: err, mode: 'plaintext' }
    return { ok: true, on_file: false, vault: false, mode: 'plaintext' }
  }
  if (profileOwnerId) {
    const { error } = await sb.from('mt_profiles').update({
      [provider]: null,
      [`${provider}_on_file`]: false,
    }).eq('owner', profileOwnerId)
    if (error) return { ok: false, error: error.message, mode: 'plaintext' }
    return { ok: true, on_file: false, vault: false, mode: 'plaintext' }
  }
  return { ok: false, error: 'no clear path' }
}

async function fnErrorMessage(error) {
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const j = await error.context.json()
      if (j?.error) return String(j.error)
      if (j?.message) return String(j.message)
    }
  } catch (_e) { /* ignore */ }
  return String(error?.message || error || '')
}

/**
 * Apply secret field inputs from Settings (blank = keep, "remove" = clear).
 * Mutates `profile` presence flags on success. Does not put values onto the profile object.
 */
export async function applySettingsProviderSecrets(sb, {
  profile,
  ownerId,
  aiKeyInput = '',
  kimiKeyInput = '',
  humanizerEmailInput = '',
  humanizerPwInput = '',
}) {
  const results = []
  const mark = (provider, onFile) => {
    if (!profile) return
    profile[`${provider}_on_file`] = onFile
    delete profile[provider]
    if (provider === 'humanizer_pw') delete profile.humanizer_pass
  }

  const ai = String(aiKeyInput || '').trim()
  if (ai === 'remove') {
    const r = await clearProviderSecret(sb, { provider: 'ai_key', profileOwnerId: ownerId })
    results.push({ provider: 'ai_key', ...r })
    if (r.ok) mark('ai_key', false)
  } else if (ai) {
    const r = await writeProviderSecret(sb, { provider: 'ai_key', value: ai, profileOwnerId: ownerId })
    results.push({ provider: 'ai_key', ...r })
    if (r.ok) mark('ai_key', true)
  }

  const kimi = String(kimiKeyInput || '').trim()
  if (kimi === 'remove') {
    const r = await clearProviderSecret(sb, { provider: 'kimi_key', profileOwnerId: ownerId })
    results.push({ provider: 'kimi_key', ...r })
    if (r.ok) mark('kimi_key', false)
  } else if (kimi) {
    const r = await writeProviderSecret(sb, { provider: 'kimi_key', value: kimi, profileOwnerId: ownerId })
    results.push({ provider: 'kimi_key', ...r })
    if (r.ok) mark('kimi_key', true)
  }

  const he = String(humanizerEmailInput || '').trim()
  if (he === 'remove') {
    const r = await clearProviderSecret(sb, { provider: 'humanizer_email', profileOwnerId: ownerId })
    results.push({ provider: 'humanizer_email', ...r })
    if (r.ok) mark('humanizer_email', false)
  } else if (he) {
    const r = await writeProviderSecret(sb, { provider: 'humanizer_email', value: he, profileOwnerId: ownerId })
    results.push({ provider: 'humanizer_email', ...r })
    if (r.ok) {
      mark('humanizer_email', true)
      if (r.mode === 'plaintext' && profile) profile.humanizer_email = he
    }
  } else if (profile?.humanizer_email && String(profile.humanizer_email).trim()) {
    // Visible plaintext email was cleared in the box (self-host). Vault-only "on file" + blank keeps it.
    const r = await clearProviderSecret(sb, { provider: 'humanizer_email', profileOwnerId: ownerId })
    results.push({ provider: 'humanizer_email', ...r })
    if (r.ok) mark('humanizer_email', false)
  }

  const hp = String(humanizerPwInput || '').trim()
  if (hp === 'remove') {
    const r = await clearProviderSecret(sb, { provider: 'humanizer_pw', profileOwnerId: ownerId })
    results.push({ provider: 'humanizer_pw', ...r })
    if (r.ok) mark('humanizer_pw', false)
  } else if (hp) {
    const r = await writeProviderSecret(sb, { provider: 'humanizer_pw', value: hp, profileOwnerId: ownerId })
    results.push({ provider: 'humanizer_pw', ...r })
    if (r.ok) mark('humanizer_pw', true)
  }

  return results
}

export function paintProviderSecretStatus({ profile, openaiPrefs, esc }) {
  const claude = providerSecretOnFile(profile, 'ai_key')
  const kimi = providerSecretOnFile(profile, 'kimi_key')
  const oaiKey = !!(openaiPrefs && openaiPrefs.key)
  const keysHtml = 'Stored keys: '
    + (claude
      ? `<b style="color:var(--ok,#1a7f37)">Claude ✓</b> <span class="muted">(${esc(secretOnFileLabel(true))})</span>`
      : '<span class="muted">Claude — not set</span>')
    + ' · '
    + (kimi
      ? `<b style="color:var(--ok,#1a7f37)">Kimi ✓</b> <span class="muted">(${esc(secretOnFileLabel(true))})</span>`
      : '<span class="muted">Kimi — not set</span>')
    + ' · '
    + (oaiKey
      ? `<b style="color:var(--ok,#1a7f37)">OpenAI-compat ✓</b> <span class="muted">(${esc(secretOnFileLabel(true))} · ${esc(openaiPrefs.base || 'no base')})</span>`
      : '<span class="muted">OpenAI-compat — not set</span>')

  const em = providerSecretOnFile(profile, 'humanizer_email')
  const pw = providerSecretOnFile(profile, 'humanizer_pw')
  const emailHint = (profile?.humanizer_email && String(profile.humanizer_email).trim())
    ? esc(profile.humanizer_email)
    : esc(em ? 'on file' : 'not set')
  const humanHtml = 'Humanizer: '
    + (em
      ? `<b style="color:var(--ok,#1a7f37)">email ✓</b> <span class="muted">(${emailHint})</span>`
      : '<span class="muted">email — not set</span>')
    + ' · '
    + (pw
      ? `<b style="color:var(--ok,#1a7f37)">password ✓</b> <span class="muted">(key on file)</span>`
      : '<span class="muted">password — not set</span>')

  return { keysHtml, humanHtml }
}
