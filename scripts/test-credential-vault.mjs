/**
 * Track B2 unit/static tests: credential vault migrations, settings helpers, board-pack stripping.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { webcrypto } from 'node:crypto'
import {
  providerSecretOnFile,
  anyByoKeyOnFile,
  secretOnFileLabel,
  paintProviderSecretStatus,
  PROVIDER_SECRET_NAMES,
} from '../web/ui/settings.mjs'
import { sanitizeProfile } from '../web/lib/board-pack.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

const schema = read('supabase/schema.sql')
const publicMig = read('supabase/migrations/20260729_credential_vault.sql')
const appMig = read('supabase/migrations/20260729_credential_vault_app_schema.sql')
const settingsUi = read('web/ui/settings.mjs')
const stateUi = read('web/ui/state.mjs')
const creds = read('supabase/functions/_shared/credentials.ts')
const chat = read('supabase/functions/chat/index.ts')
const match = read('supabase/functions/resume-match/index.ts')
const rewrite = read('supabase/functions/resume-rewrite/index.ts')
const upsertFn = read('supabase/functions/upsert_provider_secret/index.ts')
const clearFn = read('supabase/functions/clear_provider_secret/index.ts')
const readme = read('README.md')
const sbReadme = read('supabase/README.md')

// --- migrations ---
assert.match(publicMig, /CREATE TABLE IF NOT EXISTS public\.mt_provider_secrets/)
assert.match(publicMig, /ai_key_on_file/)
assert.match(publicMig, /kimi_key_on_file/)
assert.match(publicMig, /humanizer_pw_on_file/)
assert.match(publicMig, /humanizer_email_on_file/)
assert.match(publicMig, /humanizer_pw/)
assert.match(publicMig, /Encrypt-in-place is NOT done/i)
assert.doesNotMatch(publicMig, /pgp_sym_encrypt/)

assert.match(appMig, /CREATE TABLE IF NOT EXISTS app\.provider_secrets/)
assert.match(appMig, /ai_key_on_file/)
assert.match(appMig, /CREATE OR REPLACE VIEW public\.mt_profiles/)
assert.match(appMig, /NOT IN \(\s*'ai_key'/)
assert.match(appMig, /humanizer_pw/)
assert.match(appMig, /mt_provider_secrets/)
assert.match(appMig, /CREDENTIALS_KEK|encrypt-in-place|edge secret/i)
assert.doesNotMatch(appMig, /pgp_sym_encrypt/)

assert.match(schema, /mt_provider_secrets/)
assert.match(schema, /ai_key_on_file/)
assert.match(schema, /humanizer_pw/)
assert.doesNotMatch(schema, /\bhumanizer_pass\s+text\b/)

// --- edge ---
assert.match(creds, /CREDENTIALS_KEK/)
assert.match(creds, /AES-GCM/)
assert.match(creds, /loadProviderSecrets/)
assert.match(creds, /upsertEncryptedSecret/)
assert.match(chat, /loadProviderSecrets/)
assert.match(match, /loadProviderSecrets/)
assert.match(rewrite, /loadProviderSecrets/)
assert.doesNotMatch(chat, /select\('ai_key,kimi_key/)
assert.doesNotMatch(rewrite, /select\('ai_key,kimi_key/)
assert.match(upsertFn, /upsert_provider_secret|upsertEncryptedSecret/)
assert.match(clearFn, /clearEncryptedSecret|clear_provider_secret/)

// --- SPA wiring ---
assert.match(settingsUi, /upsert_provider_secret/)
assert.match(settingsUi, /clear_provider_secret/)
assert.match(settingsUi, /key on file/)
assert.match(settingsUi, /providerSecretOnFile/)
assert.match(stateUi, /applySettingsProviderSecrets/)
assert.match(stateUi, /providerSecretOnFile/)
assert.match(stateUi, /writeProviderSecret/)
assert.doesNotMatch(stateUi, /upd\.ai_key\s*=/)

// --- docs ---
assert.match(readme, /CREDENTIALS_KEK/)
assert.match(readme, /plaintext/i)
assert.match(sbReadme, /CREDENTIALS_KEK/)
assert.match(sbReadme, /humanizer_pw/)
assert.match(sbReadme, /encrypt-in-place|lazily migrate/i)

// --- helpers ---
assert.deepEqual([...PROVIDER_SECRET_NAMES], ['ai_key', 'kimi_key', 'humanizer_pw', 'humanizer_email'])
assert.equal(providerSecretOnFile({ ai_key_on_file: true }, 'ai_key'), true)
assert.equal(providerSecretOnFile({ ai_key: 'sk-ant-x' }, 'ai_key'), true)
assert.equal(providerSecretOnFile({ ai_key_on_file: false }, 'ai_key'), false)
assert.equal(providerSecretOnFile({ humanizer_pass: 'x' }, 'humanizer_pw'), true)
assert.equal(anyByoKeyOnFile({ kimi_key_on_file: true }, ''), true)
assert.equal(anyByoKeyOnFile({}, 'sk-oai'), true)
assert.equal(anyByoKeyOnFile({}, ''), false)
assert.equal(secretOnFileLabel(true), 'key on file')

const painted = paintProviderSecretStatus({
  profile: { ai_key_on_file: true, humanizer_email_on_file: true, humanizer_pw_on_file: true },
  openaiPrefs: { key: '', base: '' },
  esc: (s) => String(s),
})
assert.match(painted.keysHtml, /key on file/)
assert.doesNotMatch(painted.keysHtml, /sk-/)
assert.match(painted.humanHtml, /key on file|on file/)

// --- board pack never keeps secrets ---
const sanitized = sanitizeProfile({
  full_name: 'Ada',
  ai_key: 'sk-secret',
  kimi_key: 'kimi-secret',
  openai_key: 'oai',
  humanizer_pw: 'pw',
  humanizer_pass: 'legacy',
  humanizer_email: 'h@example.com',
  ai_key_on_file: true,
  kimi_key_on_file: true,
  humanizer_pw_on_file: true,
  humanizer_email_on_file: true,
  resume_text: 'hello',
})
assert.equal(sanitized.ai_key, undefined)
assert.equal(sanitized.kimi_key, undefined)
assert.equal(sanitized.openai_key, undefined)
assert.equal(sanitized.humanizer_pw, undefined)
assert.equal(sanitized.humanizer_pass, undefined)
assert.equal(sanitized.humanizer_email, undefined)
assert.equal(sanitized.ai_key_on_file, undefined)
assert.equal(sanitized.resume_text, 'hello')

// --- AES-GCM round-trip mirrors edge helper semantics ---
async function kekBytes(kek) {
  const enc = new TextEncoder()
  let raw
  try {
    const bin = Uint8Array.from(Buffer.from(kek, 'base64'))
    raw = bin.length === 32 ? bin : new Uint8Array(await webcrypto.subtle.digest('SHA-256', enc.encode(kek)))
  } catch {
    raw = new Uint8Array(await webcrypto.subtle.digest('SHA-256', enc.encode(kek)))
  }
  return webcrypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
async function roundTrip(plain, kek) {
  const key = await kekBytes(kek)
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)))
  const pt = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}
assert.equal(await roundTrip('sk-ant-test-secret', 'dev-passphrase-for-tests'), 'sk-ant-test-secret')
assert.equal(await roundTrip('pw', Buffer.alloc(32, 7).toString('base64')), 'pw')

console.log('test-credential-vault passed')
