#!/usr/bin/env node
/**
 * npx @telivity/careerops init | run-chain
 * Wires Open Agent Skill; runs human-gated mode chains over a board pack.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(pkgRoot, '../..')
// Prefer skill shipped inside the npm package; fall back to monorepo path when developing.
const skillSrcCandidates = [
  path.join(pkgRoot, 'skill'),
  path.join(repoRoot, '.agents/skills/careerops'),
]
const skillSrc = skillSrcCandidates.find((p) => fs.existsSync(path.join(p, 'SKILL.md')))

const args = process.argv.slice(2)
const cmd = args[0] || 'help'

function usage() {
  console.log(`CareerOps CLI

Usage:
  npx @telivity/careerops init [--dir <path>]
  npx @telivity/careerops run-chain --list
  npx @telivity/careerops run-chain <name> --pack <file> [--role <id>]
  npx @telivity/careerops run-chain <name> --pack <file> --run <id> --report-file <file>
  npx @telivity/careerops run-chain <name> --pack <file> --run <id> --confirm

What init does:
  1. Ensures .agents/skills/careerops exists (from this package or repo)
  2. Symlinks into .claude/skills, .codex/skills, .opencode/skills
  3. Copies web/config.example.js → web/config.js when missing
  4. Prints how to point at Supabase or a board-pack export

run-chain: human-gated mode pipelines (evaluate→rank→interview). Each step
writes mt_reports; --confirm required between steps. Never auto-applies.

Doctrine: no auto-apply, no invented facts, no auto-send.
`)
}

function flagValue(name) {
  const i = args.indexOf(name)
  if (i < 0) return null
  return args[i + 1] || null
}

function hasFlag(name) {
  return args.includes(name)
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function linkSkill(targetRoot) {
  const destSkill = path.join(targetRoot, '.agents/skills/careerops')
  ensureDir(path.dirname(destSkill))
  if (!fs.existsSync(destSkill)) {
    if (skillSrc) {
      fs.cpSync(skillSrc, destSkill, { recursive: true })
    } else {
      ensureDir(destSkill)
      fs.writeFileSync(
        path.join(destSkill, 'SKILL.md'),
        `# CareerOps\n\nSee https://github.com/TelivityAI/careerops\n\nDoctrine: never invent experience. Never auto-apply.\n`,
      )
    }
  }
  for (const agent of ['.claude', '.codex', '.opencode']) {
    const linkDir = path.join(targetRoot, agent, 'skills')
    ensureDir(linkDir)
    const link = path.join(linkDir, 'careerops')
    try {
      if (fs.existsSync(link) || fs.lstatSync(link).isSymbolicLink()) fs.rmSync(link, { recursive: true, force: true })
    } catch (_e) {}
    try {
      fs.symlinkSync(path.relative(linkDir, destSkill), link)
    } catch (_e) {
      fs.cpSync(destSkill, link, { recursive: true })
    }
  }
  return destSkill
}

function wireConfig(targetRoot) {
  const example = path.join(targetRoot, 'web/config.example.js')
  const config = path.join(targetRoot, 'web/config.js')
  if (fs.existsSync(example) && !fs.existsSync(config)) {
    fs.copyFileSync(example, config)
    console.log('Created web/config.js — fill in YOUR Supabase URL + anon key.')
    return true
  }
  if (fs.existsSync(config)) {
    console.log('web/config.js already present — left unchanged.')
    return false
  }
  console.log('No web/config.example.js here. For hosted demo use https://careerops.telivity.app')
  console.log('For offline skill runs, export a Board pack from Settings → Your data.')
  return false
}

function init() {
  const dirFlag = args.indexOf('--dir')
  const targetRoot = path.resolve(dirFlag >= 0 ? (args[dirFlag + 1] || '.') : process.cwd())
  console.log('Initializing CareerOps in', targetRoot)
  const skill = linkSkill(targetRoot)
  console.log('Skill ready at', skill)
  if (!fs.existsSync(path.join(skill, 'modes'))) {
    console.warn('Warning: modes/ missing under skill — reinstall package or pull latest repo.')
  }
  wireConfig(targetRoot)
  console.log(`
Next:
  • Hosted board: https://careerops.telivity.app
  • Self-host: edit web/config.js → deploy web/
  • Offline: Settings → Board pack (skill) → open CareerOps_board_pack.json with an agent
  • Modes: scan | evaluate | rank | tailor | interview | followup | outcome | advise
  • Chains: careerops run-chain --list  (human confirm between steps)
`)
}

async function loadChainLib() {
  const candidates = [
    path.join(pkgRoot, 'lib/mode-chains.mjs'),
    path.join(repoRoot, 'web/lib/mode-chains.mjs'),
  ]
  const hit = candidates.find((p) => fs.existsSync(p))
  if (!hit) throw new Error('mode-chains.mjs not found (reinstall package or run from monorepo)')
  return import(pathToFileURL(hit).href)
}

async function loadBoardPackLib() {
  const candidates = [
    path.join(pkgRoot, 'lib/board-pack.mjs'),
    path.join(repoRoot, 'web/lib/board-pack.mjs'),
  ]
  const hit = candidates.find((p) => fs.existsSync(p))
  if (!hit) throw new Error('board-pack.mjs not found')
  return import(pathToFileURL(hit).href)
}

function savePack(file, pack, buildBoardPack) {
  // Prefer rebuild so schema/doctrine stay consistent; preserve chain reports + extensions.
  const out = buildBoardPack({
    profile: pack.profile,
    roles: pack.roles || [],
    reports: [
      ...(pack.materials || []),
      ...(pack.reports || []),
    ],
    accomplishments: pack.accomplishments || [],
    portfolio: pack.portfolio || [],
    stories: pack.stories || '',
    find_prefs: pack.find_prefs || null,
    outcomes: pack.outcomes || {},
    interview_events: pack.interview_events || [],
    extensions: pack.extensions || null,
    reportKinds: [...new Set((pack.reports || []).map((r) => r.kind).filter(Boolean))],
  })
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
  return out
}

async function runChainCmd() {
  const chains = await loadChainLib()
  const { importBoardPack, buildBoardPack } = await loadBoardPackLib()

  if (hasFlag('--list') || args[1] === '--list') {
    for (const id of chains.listChains()) {
      const c = chains.getChain(id)
      console.log(`${id}\t${c.steps.map((s) => s.mode).join(' → ')}\t${c.description || ''}`)
    }
    console.log('\nDoctrine: human --confirm between steps; no auto-apply / no auto-send.')
    return
  }

  const name = args[1]
  if (!name || name.startsWith('-')) {
    usage()
    process.exit(1)
  }
  const packPath = flagValue('--pack')
  if (!packPath) {
    console.error('run-chain requires --pack <CareerOps_board_pack.json>')
    process.exit(1)
  }
  const absPack = path.resolve(packPath)
  if (!fs.existsSync(absPack)) {
    console.error('Pack not found:', absPack)
    process.exit(1)
  }

  let pack = importBoardPack(fs.readFileSync(absPack, 'utf8'))
  const runId = flagValue('--run')
  const roleId = flagValue('--role')
  const reportFile = flagValue('--report-file')
  const doConfirm = hasFlag('--confirm')

  if (!runId && !reportFile && !doConfirm) {
    const started = chains.startChain(pack, name, { roleId })
    pack = started.pack
    savePack(absPack, pack, buildBoardPack)
    console.log(JSON.stringify({
      ok: true,
      action: 'started',
      run_id: started.run.id,
      chain_id: started.chain.id,
      brief: started.brief,
      next: 'Run the skill mode in brief.mode, then --report-file, then --confirm',
    }, null, 2))
    return
  }

  const activeId = runId || (chains.findActiveRun(pack, name) || {}).id
  if (!activeId) {
    console.error('No active run. Start with: run-chain <name> --pack <file> [--role <id>]')
    process.exit(1)
  }

  if (reportFile) {
    const body = fs.readFileSync(path.resolve(reportFile), 'utf8')
    const written = chains.writeStepReport(pack, activeId, { body, roleId })
    pack = written.pack
    savePack(absPack, pack, buildBoardPack)
    console.log(JSON.stringify({
      ok: true,
      action: 'report_written',
      run_id: written.run.id,
      report_id: written.report.id,
      kind: written.report.kind,
      status: written.run.status,
      next: 'Human must pass --confirm to advance (no auto-advance)',
    }, null, 2))
    return
  }

  if (doConfirm) {
    const confirmed = chains.confirmStep(pack, activeId, { confirm: true })
    pack = confirmed.pack
    savePack(absPack, pack, buildBoardPack)
    console.log(JSON.stringify({
      ok: true,
      action: 'confirmed',
      run_id: confirmed.run.id,
      status: confirmed.run.status,
      brief: confirmed.brief,
    }, null, 2))
    return
  }

  usage()
  process.exit(1)
}

if (cmd === 'init') init()
else if (cmd === 'run-chain') {
  runChainCmd().catch((e) => {
    console.error(e.message || e)
    process.exit(1)
  })
} else usage()
