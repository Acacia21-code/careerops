export {
  promoteAccomplishment,
  promotePortfolio,
  healSourceLinks,
  renderResumeTextFromStruct,
  healBulletsPreserveSource,
  stableRoleKey,
} from '../lib/resume-sync.mjs'

export function createBuilderVisibility({ byId }) {
  return {
    open() {
      byId('builderView')?.classList.remove('hidden')
      document.body.style.overflow = 'hidden'
    },
    close() {
      byId('builderView')?.classList.add('hidden')
      document.body.style.overflow = ''
    },
  }
}
