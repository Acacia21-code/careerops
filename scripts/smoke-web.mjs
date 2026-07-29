#!/usr/bin/env node
/**
 * Static smoke: critical control IDs + doctrine strings in web/index.html.
 * No browser required — catches regressions that delete launch controls.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const htmlPath = path.join(root, 'web/index.html')

if (!fs.existsSync(htmlPath)) {
  console.error('Missing web/index.html')
  process.exit(1)
}

const html = fs.readFileSync(htmlPath, 'utf8')
const uiDir = path.join(root, 'web/ui')
const uiSource = fs.existsSync(uiDir)
  ? fs.readdirSync(uiDir)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => fs.readFileSync(path.join(uiDir, name), 'utf8'))
    .join('\n')
  : ''
const appSource = `${html}\n${uiSource}`

const requiredIds = [
  'board',
  'drawer',
  'followups',
  'triage',
  'triage_batch',
  'triage_dedupe',
  'triage_close_offlane',
  'triage_empty_closed',
  'rp2_match',
  'dw_evaluate',
  'dw_gaps',
  'dw_tailor',
  'rp2_apply',
  'builderView',
  'bv_locks',
  'bv_lock_edu',
  'bv_sent',
  'rp2_review',
  'rp2_generate',
  's_blocklist',
  's_max_age',
  's_remote_pref',
  's_hide_blocked',
  's_oai_base',
  's_oai_key',
  's_oai_model',
  'exp_boardpack',
  'boardbtn',
  'memorybtn',
  'portfoliobtn',
  'advisorbtn',
  'jdtriagebtn',
  'jt_add',
  'jt_company',
  'matchbtn',
  'cadence_nudge',
  'mem_save',
  'pf_save',
  'advisor_run',
  'advisor_fu_in',
  'advisor_fu_send',
  'advisor_followup_box',
  'settingsbtn',
  'run',
  'addrolebtn',
  'memorySection',
  'portfolioSection',
  'advisorSection',
  'hdr_actions',
  'hdr_actions_menu',
  'hdr_more',
  'hdr_cluster',
  'mob_tabs',
]

const requiredStrings = [
  { name: 'never invent (materials)', re: /Never invent/i },
  { name: 'no auto-apply doctrine', re: /auto-apply/i },
  { name: 'apply yourself messaging', re: /you apply yourself/i },
  { name: 'Board pack', re: /Board pack/ },
  { name: 'OpenAI-compatible', re: /OpenAI-compatible/ },
  { name: 'Section locks', re: /Section locks|Lock Education/ },
  { name: 'Review draft', re: /Review draft/ },
  { name: 'Find hygiene (blocklist)', re: /id="s_blocklist"/ },
  { name: 'Worth applying tag (not auto-apply)', re: /Worth applying/ },
  { name: 'hidden show chip', re: /filtered Sourced — show/ },
  { name: 'single Build resume CTA', re: /id="dw_tailor"/ },
  { name: 'no duplicate mid Build CTA', re: /id="dw_tailor_mid"/, invert: true },
  { name: 'plain-English remove junk', re: /Remove junk from Sourced/ },
  { name: 'Empty Closed control', re: /Empty Closed/ },
  { name: 'Remote US only pref', re: /remote_us/ },
  { name: 'styled triage fields', re: /class="triage-field"/ },
  { name: 'next step after verdict', re: /id="dw_nextstep"/ },
  { name: 'bullet memory section', re: /id="memorySection"/ },
  { name: 'portfolio section', re: /id="portfolioSection"/ },
  { name: 'advisor section', re: /id="advisorSection"/ },
  { name: 'no memory overlay modal', re: /id="memoryModal"/, invert: true },
  { name: 'no portfolio overlay modal', re: /id="portfolioModal"/, invert: true },
  { name: 'no advisor overlay modal', re: /id="advisorModal"/, invert: true },
  { name: 'section tabs Board Memory', re: /data-section="board"[\s\S]*?data-section="memory"/ },
  { name: 'Actions menu control', re: /id="hdr_actions"/ },
  { name: 'grounded follow-up box', re: /Grounded follow-up/ },
  { name: 'JD triage modal', re: /id="jdtriage"/ },
  { name: 'Triage a JD control', re: /Triage a JD/ },
  { name: 'JD triage Add to board', re: /id="jt_add"/ },
  { name: 'no legacy Resume tool button', re: />📄 Resume tool</, invert: true },
  { name: 'no standalone Chat button', re: /id="chatbtn"/, invert: true },
  { name: 'no standalone chat modal', re: /Job-search chat/, invert: true },
  { name: 'resume_struct canonical doctrine', re: /resume_struct is canonical|Structured resume modified/i },
  { name: 'memory provenance original', re: /Original text stays immutable|body_original/i },
  // HTML comments must not leak private stamp markers (b + east branding)
  { name: 'no private stamp leak', re: new RegExp('<!--\\s*' + 'be' + 'ast' + '-', 'i'), invert: true },
]

let failed = 0

for (const id of requiredIds) {
  const ok = appSource.includes(`id="${id}"`)
  console.log(ok ? `ok  #${id}` : `FAIL #${id}`)
  if (!ok) failed++
}

for (const s of requiredStrings) {
  const hit = s.re.test(appSource)
  const ok = s.invert ? !hit : hit
  console.log(ok ? `ok  ${s.name}` : `FAIL ${s.name}`)
  if (!ok) failed++
}

if (failed) {
  console.error(`\nsmoke-web: ${failed} failure(s)`)
  process.exit(1)
}
console.log('\nsmoke-web passed')
