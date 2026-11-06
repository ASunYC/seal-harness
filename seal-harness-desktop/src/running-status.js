const runningRow = '[data-chat-running]'
const brandedRow = `${runningRow}[data-seal-running]`
const icon = `${brandedRow} > :last-child:has(> [data-shimmer]) > [aria-hidden="true"]`
const seal = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 18" fill="none" stroke="black" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6.2 10.3C9 8.3 12 8.6 14.4 8.9c.5-2.7 2.1-4.4 4.4-4.4 1.7 0 2.6 1 2.9 2.3l1 .5c.6.4.2 1.1-.6 1.5l-1 .4c-1 2.8-3.7 4.5-7.5 4.5-3.3 0-5.6-1-7.4-2.1C4.9 12 3.3 12 2 11.4c1.4-.5 2-1 2.3-1.7C3.5 9.2 3 8.5 2.9 7.6c1.4.2 2.6 1.2 3.3 2.7Z"/>
  <path d="M15.2 11.4c-1.2 0-2.6.8-3.5 1.9M18.8 7.2h.1M2 15.5c1.1-.7 2.2-.7 3.3 0s2.2.7 3.3 0"/>
</svg>`

const style = `
${icon} { width: calc(24px + var(--dsh-content-font-delta, 0px)); height: calc(18px + var(--dsh-content-font-delta, 0px)); }
${icon} > * { display: none; }
${icon}::after {
  content: ''; position: absolute; inset: 0; background: currentColor;
  mask: url("data:image/svg+xml,${encodeURIComponent(seal)}") center / contain no-repeat;
  forced-color-adjust: none;
}
@media (prefers-reduced-motion: no-preference) {
  ${icon}::after { animation: seal-swim 1.8s ease-in-out infinite; }
}
@keyframes seal-swim {
  0%, 100% { transform: translateY(.5px) rotate(4deg); }
  50% { transform: translateY(-1px) rotate(-5deg); }
}
`

function brandText(text) {
  if (text === '深度求索中') return '正在处理'
  if (text === 'Deep diving') return 'Working'
  const zh = text.match(/^深度求索中，用时 (.+) ···$/u)
  if (zh) return `正在处理，用时 ${zh[1]} …`
  const en = text.match(/^Deep diving for (.+) ···$/u)
  return en ? `Working for ${en[1]} …` : text
}

// DSH 的运行行没有独立插槽。只替换该行的原有文本和装饰，沿用它的计时和播报。
export function brandRunningStatus(document) {
  const sheet = document.createElement('style')
  sheet.dataset.sealRunningStyle = ''
  sheet.textContent = style
  document.head.append(sheet)

  const originals = new WeakMap()
  function update(node, restore = false) {
    if (!node) return
    const attribute = node.nodeType === 1
    const current = attribute ? node.getAttribute('data-shimmer-text') : node.data
    if (current == null) return
    const previous = originals.get(node)
    if (restore && current !== previous?.branded) return
    const next = restore ? previous.source : brandText(current)
    if (next === current) return
    if (!restore) originals.set(node, { source: current, branded: next })
    if (attribute) node.setAttribute('data-shimmer-text', next)
    else node.data = next
  }

  function applyRow(row, restore = false) {
    row.toggleAttribute('data-seal-running', !restore)
    update(row.querySelector(':scope > [role="status"]')?.firstChild, restore)
    update(row.querySelector('[data-shimmer] > :first-child > span')?.firstChild, restore)
    update(row.querySelector('[data-shimmer-text]'), restore)
  }

  const observer = new document.defaultView.MutationObserver(records => {
    const rows = new Set()
    for (const { target, addedNodes } of records) {
      const row = (target.nodeType === 1 ? target : target.parentElement)?.closest(runningRow)
      if (row) rows.add(row)
      for (const node of addedNodes) {
        if (node.nodeType !== 1) continue
        if (node.matches(runningRow)) rows.add(node)
        node.querySelectorAll(runningRow).forEach(item => rows.add(item))
      }
    }
    for (const row of rows) if (row.isConnected) applyRow(row)
  })
  document.querySelectorAll(runningRow).forEach(row => applyRow(row))
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-shimmer-text'] })
  return () => {
    observer.disconnect()
    document.querySelectorAll(brandedRow).forEach(row => applyRow(row, true))
    sheet.remove()
  }
}
