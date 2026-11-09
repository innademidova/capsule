// Removes a light background: flood fill from the edges (similar light pixels become transparent), soft edge, trim.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { createClient } = createRequire(process.cwd() + '/')('@supabase/supabase-js')
const sharp = createRequire(process.env.HOME + '/projects/perfume-diary/')('sharp')
const [src, id, preview] = process.argv.slice(2)
const meta = await sharp(src).metadata()
const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width: W, height: H } = info
const lum = i => (data[i] + data[i + 1] + data[i + 2]) / 3
const sat = i => Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])
// background colour = median of the edge pixels; background = pixels close to it
const border = []
for (let x = 0; x < W; x += 4) border.push(x, (H - 1) * W + x)
for (let y = 0; y < H; y += 4) border.push(y * W, y * W + W - 1)
const med = c => { const v = border.map(p => data[p * 4 + c]).sort((a, b) => a - b); return v[v.length >> 1] }
const ref = [med(0), med(1), med(2)]
const local = p => { const i = p * 4; return Math.hypot(data[i] - ref[0], data[i + 1] - ref[1], data[i + 2] - ref[2]) }
const TOL = +(process.env.TOL || 26)
const like = new Uint8Array(W * H); for (let p = 0; p < W * H; p++) like[p] = process.env.WARM
  // WARM=1: light warm garment on a grey background; separate them by warmth (r-b), not brightness
  ? (data[p * 4] - data[p * 4 + 2] < 11 && data[p * 4 + 1] > (+process.env.MINL || 190) ? 1 : 0)
  : (local(p) < TOL ? 1 : 0)
// components of similar pixels: background if it touches the edge or is a large hole (a cutout in the garment)
const bg = new Uint8Array(W * H), seen = new Uint8Array(W * H)
for (let s0 = 0; s0 < W * H; s0++) { if (!like[s0] || seen[s0]) continue
  const comp = [s0], st = [s0]; seen[s0] = 1; let edge = false
  while (st.length) { const p = st.pop(), x = p % W, y = (p / W) | 0
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true
    for (const n of [x > 0 && p - 1, x < W - 1 && p + 1, y > 0 && p - W, y < H - 1 && p + W]) if (n !== false && like[n] && !seen[n]) { seen[n] = 1; st.push(n); comp.push(n) } }
  if (edge || comp.length > W * H * 0.004) for (const p of comp) bg[p] = 1 }
// soft edge: alpha = share of non-background pixels in the 3x3 neighbourhood
for (let p = 0; p < W * H; p++) { const x = p % W, y = (p / W) | 0; let c = 0, t = 0
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; t++; if (!bg[yy * W + xx]) c++ }
  data[p * 4 + 3] = Math.round(255 * c / t) }
// KEEP=1: the photo already has a transparent background, cut nothing
const cut = process.env.KEEP ? await sharp(src).ensureAlpha().png().toBuffer() : await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer()
const trimmed = await sharp(cut).trim().toBuffer()
const render = max => sharp(trimmed).extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer().then(b => sharp(b).resize(max, max, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90, alphaQuality: 100 }).toBuffer())
if (preview) { await sharp(await render(600)).flatten({ background: '#f2f1ee' }).png().toFile(preview); process.exit() }
for (const line of readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2] }
const sb = createClient('https://ajbdkvpyhoyzzzlrlttk.supabase.co', 'sb_publishable_zyycYXIPLQCCxPsccMttlQ_SglhZaMg')
await sb.auth.signInWithPassword({ email: process.env.CAPSULE_EMAIL, password: process.env.CAPSULE_PASSWORD })
const { data: it } = await sb.from('items').select('photo_path,thumb_path').eq('id', id).single()
for (const [p, m] of [[it.photo_path, 1600], [it.thumb_path, 600]]) { const r = await sb.storage.from('photos').upload(p, await render(m), { contentType: 'image/webp', upsert: true }); if (r.error) throw r.error }
console.log('updated', id)
