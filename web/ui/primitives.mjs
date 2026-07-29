export const byId = (id) => document.getElementById(id)

export const escapeHtml = (value) => String(value || '').replace(
  /[&<>"]/g,
  (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character],
)

export const commaList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(String(text || ''))
  const input = document.createElement('textarea')
  input.value = String(text || '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  document.execCommand('copy')
  input.remove()
  return Promise.resolve()
}
