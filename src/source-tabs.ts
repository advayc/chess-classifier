export function connectSourceTabs(tabs: HTMLElement[]): (id: string, focus?: boolean) => void {
  function select(id: string, focus = false): void {
    for (const tab of tabs) {
      const active = tab.id === id
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '')
      if (panel) panel.hidden = !active
      if (active && focus) tab.focus()
    }
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab.id))
    tab.addEventListener('keydown', event => {
      const last = tabs.length - 1
      const next = ({
        ArrowLeft: (index + last) % tabs.length,
        ArrowRight: (index + 1) % tabs.length,
        Home: 0,
        End: last,
      } as Record<string, number>)[event.key]
      if (next === undefined) return
      event.preventDefault()
      select(tabs[next].id, true)
    })
  }
  return select
}
