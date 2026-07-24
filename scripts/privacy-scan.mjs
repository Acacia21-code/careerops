#!/usr/bin/env node
/**
 * Privacy / scrub gate for the public CareerOps tree.
 * Fails on identity fingerprints, secrets, vault paths, and internal chatter.
 *
 * Ban needles are assembled at runtime so this file does not self-match.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/')

const SCAN_DIRS = ['supabase', 'training', 'docs', 'packages', 'web', 'scripts']
const SCAN_FILES = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', '.gitattributes']
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.md', '.sql', '.json', '.jsonl',
  '.toml', '.yml', '.yaml', '.html', '.css', '.txt', '.sh', '.ipynb',
])
const SKIP_NAMES = new Set(['package-lock.json', 'config.js'])
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', '__pycache__', '.venv', 'dist', '.temp'])

function re(parts, flags = 'i') {
  return new RegExp(parts.join(''), flags)
}

const BANS = [
  { class: 'identity', re: re(['\\b', 'dusan', '\\b']) },
  { class: 'identity', re: re(['milice', 'vic']) },
  { class: 'identity', re: re(['du', 'šan|', 'dusan', 'mac']) },
  { class: 'identity', re: re(['dusan', '@']) },
  { class: 'identity', re: re(['\\/Users\\/', 'dusan', 'mac\\b']) },
  { class: 'identity', re: re(['dusan', 'milicevic']) },
  { class: 'identity', re: re(['build_', 'dusan', '|', 'dusan', '_']) },
  { class: 'secrets', re: re(['\\bsbp_[a-z0-9]{20,}']) },
  { class: 'secrets', re: re(['\\bsk-ant-api[a-z0-9_-]{10,}']) },
  { class: 'secrets', re: /\bsk-[a-zA-Z0-9]{20,}/ },
  { class: 'secrets', re: /\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/ },
  { class: 'vault', re: re(['career-ops-', 'private']) },
  { class: 'vault', re: re(['docs\\/_', 'internal']) },
  { class: 'vault', re: re(['BEAST_', 'ROADMAP|BEAST_', 'PROGRESS']) },
  { class: 'vault', re: re(['\\b', 'beast', '\\b']) },
  { class: 'chatter', re: re(['agent-', 'transcript']) },
  { class: 'chatter', re: re(['\\b', 'furious', '\\b']) },
  { class: 'chatter', re: re(['zombie\\s+', 'agent']) },
  { class: 'chatter', re: re(['\\b', 'fuck', '\\b|\\b', 'shit', '\\b|\\b', 'asshole', '\\b']) },
]

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(ent.name)) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function shouldScan(file) {
  const base = path.basename(file)
  if (SKIP_NAMES.has(base)) return false
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  if (rel === 'web/config.js') return false
  if (rel === SELF) return false
  const ext = path.extname(file).toLowerCase()
  return TEXT_EXT.has(ext) || SCAN_FILES.includes(base)
}

function bansFor(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  if (rel === 'web/index.html') {
    return BANS.filter((b) => b.class === 'identity' || b.class === 'secrets' || b.class === 'vault')
  }
  return BANS
}

function scanFile(file) {
  const hits = []
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return hits
  }
  if (text.includes('\0')) return hits
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/placeholder|example shape|sbp_x+|never commit a real|token example/i.test(line) && /sbp_/i.test(line)) {
      continue
    }
    for (const { class: cls, re: rule } of bansFor(file)) {
      if (rule.test(line)) {
        hits.push({
          file: path.relative(ROOT, file).split(path.sep).join('/'),
          line: i + 1,
          class: cls,
          sample: line.trim().slice(0, 120),
        })
      }
    }
  }
  return hits
}

const files = []
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files)
for (const f of SCAN_FILES) {
  const p = path.join(ROOT, f)
  if (fs.existsSync(p)) files.push(p)
}

const uniq = [...new Set(files)].filter(shouldScan)
const hits = uniq.flatMap(scanFile)

let trackedBad = []
try {
  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  const forbid = [
    /supabase\/\.temp/,
    /\.sb_token$/,
    /\.key$/,
    /\/hf_token$/,
    /\.anthropic_key$/,
    /\.kimi_key$/,
  ]
  trackedBad = tracked.filter((t) => forbid.some((r) => r.test(t)))
} catch {
  /* not a git checkout */
}

if (hits.length || trackedBad.length) {
  console.error('privacy-scan FAILED')
  for (const h of hits) console.error(`  [${h.class}] ${h.file}:${h.line}: ${h.sample}`)
  for (const t of trackedBad) console.error(`  [tracked-secret] ${t}`)
  process.exit(1)
}
console.log(`privacy-scan OK (${uniq.length} files)`)
