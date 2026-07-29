#!/usr/bin/env node
/**
 * Regression guard for horizontal kanban scrolling.
 *
 * The board is the horizontal scroll container (#board, overflow-x:auto) and it
 * relies on height:100% — plus .col max-height:100% — to stay inside the viewport.
 * Percentage heights only resolve when #app gives .stage a *definite* height, so a
 * bare `min-height:100vh` on #app silently turns those percentages into `auto`:
 * columns grow to content height, the document scrolls vertically, and the board's
 * horizontal scrollbar lands hundreds of pixels below the fold. The right-hand
 * columns (Rejected, Closed) then become unreachable. No browser binary required.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8')

let failed = 0
function check(name, ok, detail = '') {
  if (ok) console.log(`ok  ${name}`)
  else {
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`)
    failed++
  }
}

/** Grab a CSS declaration block by selector, tolerating the file's wrapped rules. */
function rule(selector) {
  const at = html.indexOf(selector + '{')
  if (at < 0) return ''
  const open = html.indexOf('{', at)
  const close = html.indexOf('}', open)
  return close < 0 ? '' : html.slice(open + 1, close).replace(/\s+/g, '')
}

const app = rule('#app')
const stage = rule('.stage')
const board = rule('#board.board')
const col = rule('.col')

check('#app shell rule found', !!app)
check('#app is a column flex shell', /display:flex/.test(app) && /flex-direction:column/.test(app), app)
check('#app has a definite height so % heights resolve', /(^|;)height:100dvh/.test(app), app)
check('#app keeps a 100vh fallback before dvh', /(^|;)height:100vh;height:100dvh/.test(app), app)
check('#app does not fall back to min-height-only sizing', !/min-height:100vh/.test(app), app)

check('.stage can shrink inside the flex shell', /min-height:0/.test(stage), stage)
check('.stage clips its own overflow (drawer/scrim stay contained)', /overflow:hidden/.test(stage), stage)
check('.stage is a positioning context for drawer + scrim', /position:relative/.test(stage), stage)

check('#board scrolls horizontally', /overflow-x:auto/.test(board), board)
check('#board does not scroll vertically', /overflow-y:hidden/.test(board), board)
check('#board is viewport-bounded via height:100%', /height:100%/.test(board), board)
check('#board lays columns out in a row', /display:flex/.test(board) && !/flex-direction:column/.test(board), board)
check('#board columns never wrap', !/flex-wrap:wrap/.test(board), board)

check('.col holds a fixed track width (forces overflow)', /flex:00\d+px/.test(col) && /width:\d+px/.test(col), col)
check('.col is bounded by the board height', /max-height:100%/.test(col), col)
check('.col scrolls its own cards vertically', /overflow-y:auto/.test(col), col)

// Board chrome sits above .stage in the same flex column. Without flex:none these
// rows shrink under pressure instead of the stage keeping its share of the height.
const chrome = rule('#status,#setupbanner,#followups,#cadence_nudge,#reconcile_banner,#triage,#mob_tabs')
check('board chrome rows are flex:none', /flex:none/.test(chrome), chrome || '(rule missing)')
for (const id of ['#status', '#setupbanner', '#followups', '#cadence_nudge', '#reconcile_banner', '#triage', '#mob_tabs']) {
  check(`chrome row ${id} pinned in the flex:none list`, chrome !== '' && html.includes(id), chrome)
}
check('header is not allowed to flex', /flex:none/.test(rule('#app > header')))

// Mobile: .mob-tabs is position:fixed at the bottom, so the board must stop short of
// it or the horizontal scrollbar hides behind the tab bar.
const mobileQuery = (() => {
  const at = html.indexOf('@media (max-width:820px)')
  return at < 0 ? '' : html.slice(at, html.indexOf('\n  }', at))
})()
check('mobile bottom tabs are fixed to the bottom', /\.mob-tabs\{display:flex;position:fixed[^}]*bottom:0/.test(mobileQuery.replace(/\s+/g, '')))
check('board clears the fixed bottom tabs on mobile', /\.stage\{padding-bottom:calc\(56px\+env\(safe-area-inset-bottom\)\)\}/.test(mobileQuery.replace(/\s+/g, '')), 'expected .stage padding-bottom in the max-width:820px query')

// Section switching must not reintroduce a page-level scroll.
check('full-page sections scroll internally', /\.app-section\{[^}]*overflow:auto/.test(html.replace(/\s+/g, ' ')))
check('board chrome hides via display:none when off-board', /\.board-only\.hidden-by-section\{display:none!important\}/.test(html))

if (failed) {
  console.error(`\ntest-board-layout: ${failed} failure(s)`)
  process.exit(1)
}
console.log('\ntest-board-layout passed')
