export function connectSourceTabs(tabs) {
  function select(id, focus = false) {
    for (const tab of tabs) {
      const active = tab.id === id
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active
      if (active && focus) tab.focus()
    }
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab.id))
    tab.addEventListener('keydown', event => {
      const last = tabs.length - 1
      const next = {
        ArrowLeft: (index + last) % tabs.length,
        ArrowRight: (index + 1) % tabs.length,
        Home: 0,
        End: last,
      }[event.key]
      if (next === undefined) return
      event.preventDefault()
      select(tabs[next].id, true)
    })
  }
  return select
}
