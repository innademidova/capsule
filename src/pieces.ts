// Find the separate pieces in an AI image of a set (suit, co-ord): each piece is an opaque island
// surrounded by transparent space. Pure function on RGBA data so it can be tested outside the browser.

export type Box = { x0: number; y0: number; x1: number; y1: number }

const SOLID = 128 // alpha above this counts as fabric; the soft glow around a piece stays below it
const MIN_SHARE = 0.04 // islands smaller than this share of all fabric are bits of a nearby piece

// Returns a label per pixel (0 = empty, 1..n = piece) and each piece's bounding box, left to right
export function labelPieces(rgba: Uint8ClampedArray, W: number, H: number) {
  const raw = new Int32Array(W * H)
  const areas: number[] = [0]
  const boxes: Box[] = [{ x0: 0, y0: 0, x1: 0, y1: 0 }]
  const stack: number[] = []
  for (let p = 0; p < W * H; p++) {
    if (raw[p] || rgba[p * 4 + 3] <= SOLID) continue
    const id = areas.length
    const b = { x0: W, y0: H, x1: 0, y1: 0 }
    let area = 0
    raw[p] = id; stack.push(p)
    while (stack.length) {
      const q = stack.pop()!, x = q % W, y = (q - x) / W
      area++
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x
      if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const n = ny * W + nx
        if (!raw[n] && rgba[n * 4 + 3] > SOLID) { raw[n] = id; stack.push(n) }
      }
    }
    areas.push(area); boxes.push(b)
  }

  const total = areas.reduce((s, a) => s + a, 0)
  const big = areas.map((a, i) => i > 0 && a >= total * MIN_SHARE ? i : 0).filter(Boolean)
  // Each small island joins the nearest big piece (distance between boxes)
  const gap = (a: Box, b: Box) => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1))
  const owner = areas.map((_, i) => i === 0 ? 0 : big.includes(i) ? i
    : big.reduce((best, j) => gap(boxes[i], boxes[j]) < gap(boxes[i], boxes[best]) ? j : best, big[0] ?? 0))

  // Final pieces, numbered left to right (top to bottom when they share a column)
  const order = [...big].sort((a, b) => (boxes[a].x0 + boxes[a].x1) - (boxes[b].x0 + boxes[b].x1) || boxes[a].y0 - boxes[b].y0)
  const num = new Map(order.map((id, k) => [id, k + 1]))
  const out: Box[] = order.map(() => ({ x0: W, y0: H, x1: 0, y1: 0 }))
  const labels = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p++) {
    const k = raw[p] ? num.get(owner[raw[p]]) ?? 0 : 0
    if (!k) continue
    labels[p] = k
    const b = out[k - 1], x = p % W, y = (p - x) / W
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x
    if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y
  }
  return { labels, boxes: out }
}
