export { buildBoardPack, importBoardPack, planBoardPackUpsert } from '../lib/board-pack.mjs'
export { postedCompLabel, normalizeCompRange } from '../lib/ats-comp.mjs'
export { buildSalaryCompare, normalizeTargetBand, targetBandLabel, parseBandInput } from '../lib/salary-compare.mjs'
export { buildTriageRoleRow, buildMatchReportRow, splitGapsByMaterials, validateTriageAdd, inferRoleLevel } from '../lib/jd-triage.mjs'

export const SECTION_IDS = Object.freeze({
  board: 'stage',
  memory: 'memorySection',
  portfolio: 'portfolioSection',
  advise: 'advisorSection',
})

export function createSectionNavigation({ byId, onShow = {} }) {
  let current = 'board'

  function closeMenus(exceptId) {
    const panels = [
      { panel: 'hdr_actions_menu', button: 'hdr_actions' },
      { panel: 'hdr_cluster', button: 'hdr_more' },
    ]
    for (const item of panels) {
      if (item.panel === exceptId) continue
      byId(item.panel)?.classList.remove('open')
      byId(item.button)?.setAttribute('aria-expanded', 'false')
    }
  }

  function syncTabs(section) {
    document.querySelectorAll('#hdr_tabs .hdr-tab, #mob_tabs .hdr-tab').forEach((tab) => {
      const active = tab.dataset.section === section
      tab.classList.toggle('active', active)
      tab.setAttribute('aria-selected', active ? 'true' : 'false')
    })
  }

  function show(section) {
    const next = SECTION_IDS[section] ? section : 'board'
    current = next
    closeMenus()
    const board = next === 'board'
    document.querySelectorAll('.board-only').forEach((element) => {
      element.classList.toggle('hidden-by-section', !board)
    })
    byId('hdr_board_actions')?.classList.toggle('hidden', !board)
    for (const [key, id] of Object.entries(SECTION_IDS)) {
      const element = byId(id)
      if (!element) continue
      element.classList.toggle('hidden', key === 'board' ? !board : key !== next)
    }
    syncTabs(next)
    onShow[next]?.()
    return next
  }

  return { closeMenus, show, syncTabs, current: () => current }
}
