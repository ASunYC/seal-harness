const runningRow = '[data-chat-running]'
const brandedRow = `${runningRow}[data-seal-running]`
const icon = `${brandedRow} > :last-child:has(> [data-shimmer]) > [aria-hidden="true"]`
const seal = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 20" fill="none" stroke="black" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">
  <path d="M11.3 2.5C5.9 1.8 2 4.8 2 9.4c0 4.7 4.2 7.5 10.4 7.5 5.3 0 8.5-2.1 12.1-3.4 1.5-.5 2.6-.1 3.4.7.7.8 1.8 1 2.5.4-.5-.8-1.1-1.4-1.8-2 .9-.4 1.5-1 1.4-1.8-1.3.5-2.3.6-3.4.2-2.4-.9-3.6-3.2-6.2-4.6-2.7-1.5-5.7-2.9-9.1-3.3Z"/>
  <path d="M4.4 6.7c.7-.7 1.7-.8 2.4-.4m2.1-.5c.7-.5 1.6-.5 2.3-.1M5.6 12.8c1.6 1.6 3.7 2.3 6.4 2.3"/>
  <circle cx="7" cy="8.1" r=".7" fill="black" stroke="none"/><circle cx="10.5" cy="7.5" r=".7" fill="black" stroke="none"/>
  <path d="M9.3 10.2c.7-.6 1.6-.6 2.1 0-.4.8-1.5 1-2.1 0Z" fill="black" stroke="none"/>
</svg>`
const flipper = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 20" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14.4 8.4c2.3-2.8 4.8-4.3 7.2-3.6 1.9.5 3.5 1.7 4.5 2.8-1.5 1.1-3.7 1.9-5.7 1.6-2.3-.4-4.2-1.2-6-1.3"/>
</svg>`

const style = `
${icon} { position: relative; width: calc(32px + var(--dsh-content-font-delta, 0px)); height: calc(20px + var(--dsh-content-font-delta, 0px)); flex: none; }
${icon} > * { display: none; }
${icon}::before, ${icon}::after {
  content: ''; position: absolute; inset: 0; background: currentColor;
  forced-color-adjust: none;
}
${icon}::before {
  mask: url("data:image/svg+xml,${encodeURIComponent(seal)}") center / contain no-repeat;
}
${icon}::after {
  mask: url("data:image/svg+xml,${encodeURIComponent(flipper)}") center / contain no-repeat;
  transform-origin: 45% 42%;
}
@media (prefers-reduced-motion: no-preference) {
  ${icon}::after { animation: seal-pat 1.4s ease-in-out infinite; }
}
@keyframes seal-pat {
  0%, 44%, 100% { transform: rotate(-8deg); }
  22%, 66% { transform: rotate(23deg); }
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
