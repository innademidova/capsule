// Sideways chip rows (categories, the Looking for filter, mini item lists, segment bars) on a computer:
// the mouse wheel scrolls them smoothly left and right, and they can be dragged with the left button.
// A short press still taps the chip; a press that moved is a drag, and its click is swallowed.
const ROWS = '.cat-row, .chips, .mini-list, .seg'

const rowOf = (t: EventTarget | null) => (t as Element | null)?.closest?.(ROWS) as HTMLElement | null
const scrollable = (row: HTMLElement) => row.scrollWidth > row.clientWidth + 1

// Wheel: a mouse notch glides, a trackpad follows the fingers; at the end of the row the page scrolls again
const aim = new WeakMap<HTMLElement, { to: number; at: number }>()
document.addEventListener('wheel', e => {
  const row = rowOf(e.target)
  if (!row || !scrollable(row) || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
  const max = row.scrollWidth - row.clientWidth
  const last = aim.get(row)
  const from = last && performance.now() - last.at < 400 ? last.to : row.scrollLeft
  const to = Math.max(0, Math.min(max, from + e.deltaY))
  if (to === from) return
  e.preventDefault()
  if (Math.abs(e.deltaY) < 40) { aim.delete(row); row.scrollLeft = to; return }
  aim.set(row, { to, at: performance.now() })
  row.scrollTo({ left: to, behavior: 'smooth' })
}, { passive: false })

// Drag with the left mouse button
let drag: { row: HTMLElement; id: number; x: number; left: number; moved: boolean } | null = null
document.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return
  const row = rowOf(e.target)
  if (row && scrollable(row)) drag = { row, id: e.pointerId, x: e.clientX, left: row.scrollLeft, moved: false }
})
document.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return
  const dx = e.clientX - drag.x
  if (!drag.moved) {
    if (Math.abs(dx) < 6) return
    drag.moved = true
    drag.row.classList.add('dragging')
    window.getSelection()?.removeAllRanges()
  }
  drag.row.scrollLeft = drag.left - dx
})
const end = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return
  if (drag.moved) {
    drag.row.classList.remove('dragging')
    const swallow = (c: Event) => { c.preventDefault(); c.stopPropagation() }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
  }
  drag = null
}
document.addEventListener('pointerup', end)
document.addEventListener('pointercancel', end)
// No ghost picture when a thumbnail in a row is dragged
document.addEventListener('dragstart', e => { if (rowOf(e.target)) e.preventDefault() })
// The grab cursor only where there is something to drag
document.addEventListener('mouseover', e => {
  const row = rowOf(e.target)
  if (row) row.classList.toggle('can-drag', scrollable(row))
})
