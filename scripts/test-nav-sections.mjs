#!/usr/bin/env node
/**
 * Focused static + lightweight DOM checks for Track C nav regroup.
 * Validates section IA, Actions/More menus, full-page sections (not modals),
 * and that showAppSection wiring exists. No browser binary required.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const htmlPath = path.join(root, 'web/index.html')
const html = fs.readFileSync(htmlPath, 'utf8')
const uiDir = path.join(root, 'web/ui')
const uiSource = fs.existsSync(uiDir)
  ? fs.readdirSync(uiDir)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => fs.readFileSync(path.join(uiDir, name), 'utf8'))
    .join('\n')
  : ''
const appSource = `${html}\n${uiSource}`

let failed = 0
function check(name, ok, detail = '') {
  if (ok) console.log(`ok  ${name}`)
  else {
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`)
    failed++
  }
}

// --- Static structure ---
check('section tabs present', /id="hdr_tabs"/.test(html) && /id="boardbtn"/.test(html))
check('mobile bottom tabs', /id="mob_tabs"/.test(html) && /class="mob-tabs"/.test(html))
check('Actions dropdown', /id="hdr_actions"/.test(html) && /id="hdr_actions_menu"/.test(html))
check('More utility menu', /id="hdr_more"/.test(html) && /id="hdr_cluster"/.test(html))
check('Add role inside Actions', /id="hdr_actions_menu"[\s\S]*?id="addrolebtn"/.test(html))
check('Triage JD inside Actions', /id="hdr_actions_menu"[\s\S]*?id="jdtriagebtn"/.test(html))
check('LinkedIn in More', /id="hdr_cluster"[\s\S]*?id="li_google_btn"/.test(html))
check('Settings in More', /id="hdr_cluster"[\s\S]*?id="settingsbtn"/.test(html))
check('Sign out in More', /id="hdr_cluster"[\s\S]*?id="signout"/.test(html))
check('Support link in More', /id="hdr_cluster"[\s\S]*?id="donate"/.test(html))

check('memory is app-section', /id="memorySection"[^>]*class="[^"]*app-section/.test(html))
check('portfolio is app-section', /id="portfolioSection"[^>]*class="[^"]*app-section/.test(html))
check('advise is app-section', /id="advisorSection"[^>]*class="[^"]*app-section/.test(html))
check('sections live inside #app', (() => {
  const appStart = html.indexOf('id="app"')
  const appEnd = html.indexOf('<!-- full-page builder -->')
  const slice = html.slice(appStart, appEnd > 0 ? appEnd : undefined)
  return slice.includes('id="memorySection"')
    && slice.includes('id="portfolioSection"')
    && slice.includes('id="advisorSection"')
})())

check('no overlay memoryModal', !/id="memoryModal"/.test(html))
check('no overlay portfolioModal', !/id="portfolioModal"/.test(html))
check('no overlay advisorModal', !/id="advisorModal"/.test(html))

check('showAppSection helper', /function showAppSection\s*\(/.test(appSource))
check('SECTION_IDS map', /SECTION_IDS\s*=\s*(?:Object\.freeze\()?\{[\s\S]*memory:\s*'memorySection'/.test(appSource))
check('board-only chrome class', /class="[^"]*board-only/.test(html))
check('hidden-by-section CSS', /\.board-only\.hidden-by-section|\.hidden-by-section/.test(html))
check('mobile tabs media query', /@media \(max-width:820px\)[\s\S]*\.mob-tabs\{display:flex/.test(html))
check('openMemory uses section', /async function openMemoryModal[\s\S]*?showAppSection\('memory'\)/.test(appSource))
check('openPortfolio uses section', /async function openPortfolioModal[\s\S]*?showAppSection\('portfolio'\)/.test(appSource))
check('openAdvisor uses section', /async function openAdvisorModal[\s\S]*?showAppSection\('advise'\)/.test(appSource))

{
  const clusterStart = html.indexOf('id="hdr_cluster"')
  const clusterSlice = clusterStart >= 0 ? html.slice(clusterStart, clusterStart + 900) : ''
  check('memory tab not in More menu', !clusterSlice.includes('id="memorybtn"'))
  check('portfolio tab not in More menu', !clusterSlice.includes('id="portfoliobtn"'))
  check('advise tab not in More menu', !clusterSlice.includes('id="advisorbtn"'))
}

// --- Lightweight DOM via jsdom when installed ---
let JSDOM = null
try {
  ;({ JSDOM } = await import('jsdom'))
} catch {
  JSDOM = null
}

if (!JSDOM) {
  console.log('ok  jsdom optional skip — static checks only (install jsdom for DOM assertions)')
} else {
  const dom = new JSDOM(html, { url: 'https://careerops.local/' })
  const { document } = dom.window
  const $ = (id) => document.getElementById(id)

  check('DOM board tab', !!$('boardbtn'))
  check('DOM memory tab', !!$('memorybtn') && $('memorybtn').getAttribute('data-section') === 'memory')
  check('DOM portfolio tab', !!$('portfoliobtn') && $('portfoliobtn').getAttribute('data-section') === 'portfolio')
  check('DOM advise tab', !!$('advisorbtn') && $('advisorbtn').getAttribute('data-section') === 'advise')
  check('DOM memory section hidden by default', $('memorySection')?.classList.contains('hidden'))
  check('DOM portfolio section hidden by default', $('portfolioSection')?.classList.contains('hidden'))
  check('DOM advisor section hidden by default', $('advisorSection')?.classList.contains('hidden'))
  check('DOM stage present', !!$('stage') && $('stage').classList.contains('board-only'))
  check('DOM Run search outside More', !!$('run') && !$('hdr_cluster')?.contains($('run')))
  check('DOM addrole in Actions menu', !!$('hdr_actions_menu')?.contains($('addrolebtn')))
  check('DOM jdtriage in Actions menu', !!$('hdr_actions_menu')?.contains($('jdtriagebtn')))
  check('DOM settings in More', !!$('hdr_cluster')?.contains($('settingsbtn')))
  check('DOM LinkedIn in More', !!$('hdr_cluster')?.contains($('li_google_btn')))
  check('DOM mob tabs four sections', document.querySelectorAll('#mob_tabs [data-section]').length === 4)
  check('DOM hdr tabs four sections', document.querySelectorAll('#hdr_tabs [data-section]').length === 4)

  function simShow(section) {
    const map = { board: 'stage', memory: 'memorySection', portfolio: 'portfolioSection', advise: 'advisorSection' }
    const onBoard = section === 'board'
    document.querySelectorAll('.board-only').forEach((el) => {
      el.classList.toggle('hidden-by-section', !onBoard)
    })
    Object.entries(map).forEach(([key, id]) => {
      const el = $(id)
      if (!el) return
      if (key === 'board') el.classList.toggle('hidden', !onBoard)
      else el.classList.toggle('hidden', key !== section)
    })
  }
  simShow('memory')
  check('sim memory shows section', !$('memorySection').classList.contains('hidden'))
  check('sim memory hides stage', $('stage').classList.contains('hidden') || $('stage').classList.contains('hidden-by-section'))
  check('sim memory hides portfolio', $('portfolioSection').classList.contains('hidden'))
  simShow('board')
  check('sim board restores stage', !$('stage').classList.contains('hidden') && !$('stage').classList.contains('hidden-by-section'))
  check('sim board hides memory', $('memorySection').classList.contains('hidden'))
}

if (failed) {
  console.error(`\ntest-nav-sections: ${failed} failure(s)`)
  process.exit(1)
}
console.log('\ntest-nav-sections passed')
