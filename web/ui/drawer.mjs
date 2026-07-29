export function createDrawerVisibility({ byId }) {
  return {
    open() {
      byId('drawer')?.classList.remove('hidden')
      byId('scrim')?.classList.remove('hidden')
    },
    close() {
      byId('drawer')?.classList.add('hidden')
      byId('scrim')?.classList.add('hidden')
      document.querySelectorAll('.cardlet.active').forEach((element) => element.classList.remove('active'))
    },
  }
}
