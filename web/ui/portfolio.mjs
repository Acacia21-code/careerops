export {
  createPortfolioItem,
  editPortfolioItem,
  archivePortfolioItem,
  resumeOkItems,
} from '../lib/portfolio.mjs'

export function activePortfolioItems(rows) {
  return (rows || []).filter((row) => !row.archived_at)
}
