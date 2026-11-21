const labels = ['White wins', 'Draws', 'Black wins']
const kinds = ['white', 'draw', 'black']

export function outcomePercentages(counts) {
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (!total) return null
  const exact = counts.map(count => count * 100 / total)
  const rounded = exact.map(Math.floor)
  const remainder = 100 - rounded.reduce((sum, count) => sum + count, 0)
  const order = [0, 1, 2].sort((a, b) => (exact[b] - rounded[b]) - (exact[a] - rounded[a]))
  for (const index of order.slice(0, remainder)) rounded[index]++
  return rounded
}

export function outcomeBar(counts) {
  const percentages = outcomePercentages(counts)
  const bar = document.createElement('span')
  bar.className = 'outcome-bar'
  const description = percentages.map((value, index) => `${labels[index]} ${value}%`).join(', ')
  bar.setAttribute('role', 'img')
  bar.setAttribute('aria-label', description)
  bar.title = description
  for (const [index, value] of percentages.entries()) {
    if (value === 0) continue
    const segment = document.createElement('span')
    segment.className = `outcome-segment ${kinds[index]}`
    segment.style.flexBasis = `${value}%`
    segment.setAttribute('aria-hidden', 'true')
    if (value >= 17) segment.textContent = `${value}%`
    bar.append(segment)
  }
  return bar
}
