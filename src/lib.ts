import { createClient } from '@supabase/supabase-js'

// Publishable key: data is protected by database access rules (RLS) and password login
export const supabase = createClient(
  'https://ajbdkvpyhoyzzzlrlttk.supabase.co',
  'sb_publishable_zyycYXIPLQCCxPsccMttlQ_SglhZaMg',
)

export type Item = {
  id: string
  name: string | null
  category: string
  kind: string | null
  colors: string[]
  seasons: string[]
  styles: string[]
  occasions: string[]
  brand: string | null
  notes: string | null
  link: string | null
  materials: Material[]
  photo_path: string | null
  thumb_path: string | null
  favorite: boolean
  wishlist: boolean
  created_at: string
  updated_at: string
}

export type Option = { id: string; label: string }

// One line of the composition label; pct is optional (unknown share)
export type Material = { name: string; pct: number | null }
// "95% Cotton · 5% Elastane", largest share first
export const compositionText = (m: Material[]) =>
  [...m].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)).map(x => x.pct != null ? `${x.pct}% ${x.name}` : x.name).join(' · ')

export const CATEGORIES: Option[] = [
  { id: 'top', label: 'Tops' },
  { id: 'bottom', label: 'Bottoms' },
  { id: 'dress', label: 'Dresses' },
  { id: 'outerwear', label: 'Outerwear' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'bag', label: 'Bags' },
  { id: 'accessory', label: 'Accessories' },
  { id: 'swim', label: 'Swimwear' },
]
export const categoryLabel = (id: string) => CATEGORIES.find(c => c.id === id)?.label ?? id

// Suggestions for the "type" field, by category
export const KINDS: Record<string, string[]> = {
  top: ['t-shirt', 'shirt', 'blouse', 'sweater', 'cardigan', 'turtleneck', 'hoodie', 'sweatshirt', 'top', 'tank top', 'bodysuit', 'polo'],
  bottom: ['jeans', 'trousers', 'skirt', 'shorts', 'leggings', 'joggers'],
  dress: ['dress', 'midi dress', 'maxi dress', 'mini dress', 'jumpsuit', 'set'],
  outerwear: ['coat', 'trench coat', 'jacket', 'blazer', 'leather jacket', 'denim jacket', 'puffer', 'vest', 'raincoat'],
  shoes: ['sneakers', 'boots', 'ankle boots', 'loafers', 'heels', 'flats', 'sandals', 'mules', 'ballet flats'],
  bag: ['tote', 'shoulder bag', 'crossbody', 'clutch', 'backpack', 'mini bag'],
  accessory: ['belt', 'sunglasses', 'glasses', 'necklace', 'earrings', 'bracelet', 'ring', 'watch', 'scarf', 'hat', 'cap', 'gloves', 'hair accessory', 'brooch'],
  swim: ['swimsuit', 'bikini', 'cover-up', 'beach dress'],
}

export const COLORS: (Option & { hex: string })[] = [
  { id: 'black', label: 'Black', hex: '#141414' },
  { id: 'white', label: 'White', hex: '#ffffff' },
  { id: 'cream', label: 'Cream', hex: '#f1e8d6' },
  { id: 'beige', label: 'Beige', hex: '#d8c3a3' },
  { id: 'camel', label: 'Camel', hex: '#b88a5a' },
  { id: 'brown', label: 'Brown', hex: '#6b4a33' },
  { id: 'grey', label: 'Grey', hex: '#9a9ca1' },
  { id: 'navy', label: 'Navy', hex: '#1f2a48' },
  { id: 'blue', label: 'Blue', hex: '#3567c8' },
  { id: 'light-blue', label: 'Light blue', hex: '#a8c7ec' },
  { id: 'denim', label: 'Denim', hex: '#56789f' },
  { id: 'green', label: 'Green', hex: '#3d7a4c' },
  { id: 'olive', label: 'Olive', hex: '#6d6b3b' },
  { id: 'red', label: 'Red', hex: '#c42b2b' },
  { id: 'burgundy', label: 'Burgundy', hex: '#6b1c2c' },
  { id: 'pink', label: 'Pink', hex: '#f1a7c0' },
  { id: 'purple', label: 'Purple', hex: '#7b58bf' },
  { id: 'butter-yellow', label: 'Butter yellow', hex: '#f3e3a0' },
  { id: 'yellow', label: 'Yellow', hex: '#f0c74a' },
  { id: 'orange', label: 'Orange', hex: '#e27b2a' },
  { id: 'silver', label: 'Silver', hex: '#c4c6ca' },
  { id: 'gold', label: 'Gold', hex: '#cfa94a' },
  { id: 'print', label: 'Print', hex: 'conic-gradient(#e27b2a, #f0c74a, #3d7a4c, #3567c8, #7b58bf, #e27b2a)' },
]
export const colorOf = (id: string) => COLORS.find(c => c.id === id)

export const SEASONS: Option[] = [
  { id: 'spring', label: 'Spring' }, { id: 'summer', label: 'Summer' },
  { id: 'autumn', label: 'Autumn' }, { id: 'winter', label: 'Winter' },
]
export const STYLES: Option[] = [
  { id: 'casual', label: 'Casual' }, { id: 'classic', label: 'Classic' }, { id: 'minimal', label: 'Minimal' },
  { id: 'elegant', label: 'Elegant' }, { id: 'business', label: 'Business' }, { id: 'sporty', label: 'Sporty' },
  { id: 'romantic', label: 'Romantic' }, { id: 'edgy', label: 'Edgy' }, { id: 'boho', label: 'Boho' },
]
export const OCCASIONS: Option[] = [
  { id: 'everyday', label: 'Everyday' }, { id: 'work', label: 'Work' }, { id: 'evening', label: 'Evening' },
  { id: 'party', label: 'Party' }, { id: 'date', label: 'Date' }, { id: 'travel', label: 'Travel' },
  { id: 'sport', label: 'Sport' }, { id: 'home', label: 'Home' },
]
export const labelOf = (list: Option[], id: string) => list.find(o => o.id === id)?.label ?? id

export const itemTitle = (i: Item) => i.name || i.kind || categoryLabel(i.category)

// --- Photos: signed URLs (the bucket is private) ---

// URLs live for a day, so the browser serves images from cache instead of downloading them again.
// Requests from many tiles are collected into one batch.
const urlCache = new Map<string, { url: string; exp: number }>()
let pending = new Set<string>()
let flush: Promise<void> | null = null

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now()
  paths.forEach(p => { const c = urlCache.get(p); if (!c || c.exp < now) pending.add(p) })
  if (pending.size) {
    flush ??= new Promise<void>(r => setTimeout(r, 0)).then(async () => {
      const batch = [...pending]; pending = new Set(); flush = null
      const { data } = await supabase.storage.from('photos').createSignedUrls(batch, 60 * 60 * 24)
      data?.forEach(d => {
        if (d.signedUrl && d.path) urlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 1000 * 60 * 60 * 23 })
      })
    })
    await flush
  }
  const out: Record<string, string> = {}
  paths.forEach(p => { const c = urlCache.get(p); if (c) out[p] = c.url })
  return out
}

// --- Photo processing before upload ---
// High-quality stepped downscale (halving each step), trims transparent edges of cut-out items.
// Full photo up to 1600px, gallery preview up to 600px. WebP (keeps transparency);
// if the browser cannot encode WebP: PNG for transparent images, JPEG for regular ones.

const FULL = 1600
const THUMB = 600

function canvasOf(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h))
  return c
}

function downscale(src: CanvasImageSource & { width: number; height: number }, max: number) {
  let cur: HTMLCanvasElement | (CanvasImageSource & { width: number; height: number }) = src
  let w = src.width, h = src.height
  const target = Math.min(1, max / Math.max(w, h))
  const tw = w * target, th = h * target
  while (w / 2 >= tw) {
    w /= 2; h /= 2
    const c = canvasOf(w, h); const ctx = c.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cur, 0, 0, c.width, c.height); cur = c
  }
  const c = canvasOf(tw, th); const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cur, 0, 0, c.width, c.height)
  return c
}

// Bounds of the opaque part; null if there are no transparent pixels
function opaqueBounds(c: HTMLCanvasElement) {
  const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
  let minX = width, minY = height, maxX = -1, maxY = -1, transparent = false
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3]
      if (a > 12) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      } else transparent = true
    }
  }
  if (!transparent || maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function toBlob(c: HTMLCanvasElement, type: string, q?: number) {
  return new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not process the photo'))), type, q))
}

async function encode(c: HTMLCanvasElement, alpha: boolean) {
  const webp = await toBlob(c, 'image/webp', 0.9)
  if (webp.type === 'image/webp') return webp
  return alpha ? toBlob(c, 'image/png') : toBlob(c, 'image/jpeg', 0.9)
}

export type Processed = { full: Blob; thumb: Blob; preview: string; cutout: boolean }

export async function processPhoto(file: Blob): Promise<Processed> {
  const bitmap = await createImageBitmap(file)
  let work = downscale(bitmap, 2400)
  bitmap.close?.()
  const box = opaqueBounds(work)
  if (box) {
    const pad = Math.round(Math.max(box.w, box.h) * 0.04)
    const c = canvasOf(box.w + pad * 2, box.h + pad * 2)
    c.getContext('2d')!.drawImage(work, box.x, box.y, box.w, box.h, pad, pad, box.w, box.h)
    work = c
  }
  const full = await encode(downscale(work, FULL), !!box)
  const thumb = await encode(downscale(work, THUMB), !!box)
  return { full, thumb, preview: URL.createObjectURL(full), cutout: !!box }
}

const extOf = (b: Blob) => (b.type === 'image/webp' ? 'webp' : b.type === 'image/png' ? 'png' : 'jpg')

export async function uploadPhoto(p: Processed) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Please sign in again')
  const id = crypto.randomUUID()
  const photo_path = `${user.id}/${id}.${extOf(p.full)}`
  const thumb_path = `${user.id}/${id}_thumb.${extOf(p.thumb)}`
  for (const [path, blob] of [[photo_path, p.full], [thumb_path, p.thumb]] as const) {
    const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: blob.type })
    if (error) throw error
  }
  return { photo_path, thumb_path }
}

export async function removePhotos(...paths: (string | null)[]) {
  const list = paths.filter((p): p is string => !!p)
  if (list.length) await supabase.storage.from('photos').remove(list)
}

// Creates an item draft from a photo of a person (garment function); returns its storage path and exact cost
export async function generateGarment(body: { source_path: string; ref_paths?: string[]; previous_path?: string; piece: string; corrections: string[] }) {
  const res = await supabase.functions.invoke('garment', { body })
  if (res.error) {
    let msg = res.error.message
    try { msg = (await (res.error as { context?: Response }).context?.json())?.error ?? msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.data as { path: string; cost_usd: number; text_in: number; image_in: number; output: number }
}

// If the model returned a white background instead of a transparent one, remove it with a flood fill from the edges
export async function whiteToAlpha(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const { width: W, height: H } = bitmap
  const c = canvasOf(W, H), ctx = c.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  const img = ctx.getImageData(0, 0, W, H), d = img.data
  if (d[3] < 250 || d[W * 4 - 1] < 250 || d[(H - 1) * W * 4 + 3] < 250) return file
  const isWhite = (p: number) => Math.min(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]) >= 244
  const seen = new Uint8Array(W * H), stack: number[] = []
  const push = (p: number) => { if (!seen[p] && isWhite(p)) { seen[p] = 1; stack.push(p) } }
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1) }
  while (stack.length) {
    const p = stack.pop()!, x = p % W
    d[p * 4 + 3] = 0
    if (x > 0) push(p - 1)
    if (x < W - 1) push(p + 1)
    if (p >= W) push(p - W)
    if (p < (H - 1) * W) push(p + W)
  }
  ctx.putImageData(img, 0, 0)
  return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Could not process the image')), 'image/png'))
}

// Image from the clipboard (iPhone: "Copy" on a lifted subject in Photos)
export const canPaste = () => typeof navigator !== 'undefined' && !!navigator.clipboard?.read

export async function pasteImage(): Promise<Blob | null> {
  const items = await navigator.clipboard.read()
  for (const it of items) {
    const type = it.types.find(t => t.startsWith('image/'))
    if (type) return it.getType(type)
  }
  return null
}

// ===== Stages 2-5 =====

export type Placement = { item_id: string; x: number; y: number; w: number; z: number }
export type Outfit = {
  id: string; name: string | null; layout: Placement[]; occasions: string[]; seasons: string[]
  notes: string | null; favorite: boolean; source: string; created_at: string; updated_at: string
}
export type Wear = { id: string; worn_on: string; outfit_id: string | null; item_ids: string[] }
export type InspoPiece = { piece: string; category: string; status: 'have' | 'similar' | 'missing'; item_ids: string[]; note: string }
export type InspoAnalysis = { summary: string; formula: string; pieces: InspoPiece[]; to_buy: string[]; tags: string[] }
export type Inspiration = { id: string; image_path: string; thumb_path: string | null; note: string | null; analysis: InspoAnalysis | null; created_at: string }
export type StyleProfile = { summary: string | null; formulas: { title: string; recipe: string }[]; palette: string[]; key_pieces: string[]; based_on: number; updated_at: string }
export type ShopItem = { id: string; name: string; category: string | null; why: string | null; priority: number; done: boolean; created_at: string }
export type AIRequest = {
  id: string; kind: string; input: Record<string, unknown>; image_path: string | null; mode: string
  status: 'queued' | 'done' | 'error'; result: any; error: string | null; created_at: string; done_at: string | null
  cost_usd?: number | null
}
export type OutfitIdea = { title: string; item_ids: string[]; why: string; tip: string }

// AI request: "now" goes straight to the Edge Function (paid), "queue" waits for Claude Code (free)
export async function askAI(kind: string, input: Record<string, unknown>, mode: 'now' | 'queue', image_path?: string | null) {
  const { data, error } = await supabase.from('ai_requests')
    .insert({ kind, input, mode, image_path: image_path ?? null, status: 'queued' }).select().single()
  if (error) throw error
  const req = data as AIRequest
  if (mode === 'queue') return req
  const res = await supabase.functions.invoke('ai', { body: { id: req.id } })
  if (res.error) {
    let msg = res.error.message
    try { msg = (await (res.error as { context?: Response }).context?.json())?.error ?? msg } catch { /* ignore */ }
    throw Object.assign(new Error(msg), { request: { ...req, status: 'error', error: msg } as AIRequest })
  }
  return { ...req, status: 'done', result: res.data.result, cost_usd: res.data.cost_usd ?? null, done_at: new Date().toISOString() } as AIRequest
}

export async function requeue(req: AIRequest) {
  const { data } = await supabase.from('ai_requests').update({ status: 'queued', mode: 'queue', error: null }).eq('id', req.id).select().single()
  return data as AIRequest
}

// Automatic outfit layout on the canvas, by category
const SLOTS: Record<string, { x: number; y: number; w: number }[]> = {
  outerwear: [{ x: 2, y: 3, w: 46 }],
  top: [{ x: 30, y: 3, w: 40 }, { x: 52, y: 3, w: 34 }],
  dress: [{ x: 28, y: 2, w: 44 }],
  bottom: [{ x: 30, y: 38, w: 38 }],
  shoes: [{ x: 56, y: 74, w: 32 }, { x: 8, y: 76, w: 28 }],
  bag: [{ x: 68, y: 42, w: 30 }],
  swim: [{ x: 24, y: 4, w: 52 }],
  accessory: [{ x: 4, y: 56, w: 22 }, { x: 74, y: 22, w: 22 }, { x: 72, y: 62, w: 20 }],
}
export function autoLayout(items: Item[]): Placement[] {
  const used: Record<string, number> = {}
  const hasOuter = items.some(i => i.category === 'outerwear')
  return items.map((it, z) => {
    const n = used[it.category] = (used[it.category] ?? -1) + 1
    const slots = SLOTS[it.category] ?? SLOTS.accessory
    let s = slots[Math.min(n, slots.length - 1)]
    if (it.category === 'top' && !hasOuter && n === 0) s = { x: 14, y: 3, w: 44 }
    if (it.category === 'bottom' && !hasOuter) s = { x: 18, y: 38, w: 40 }
    return { item_id: it.id, ...s, z }
  })
}

// Current weather (Open-Meteo, no key needed)
export async function currentWeather(): Promise<string> {
  const pos = await new Promise<GeolocationPosition>((res, rej) =>
    navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000, maximumAge: 30 * 60 * 1000 }))
  const { latitude: la, longitude: lo } = pos.coords
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la.toFixed(2)}&longitude=${lo.toFixed(2)}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`)
  const d = await r.json()
  const code = d.current.weather_code as number
  const sky = code === 0 ? 'clear' : code <= 3 ? 'cloudy' : code <= 48 ? 'fog' : code <= 67 ? 'rain' : code <= 77 ? 'snow' : code <= 82 ? 'showers' : 'storm'
  return `${Math.round(d.current.temperature_2m)}°C (feels ${Math.round(d.current.apparent_temperature)}°C, today ${Math.round(d.daily.temperature_2m_min[0])}…${Math.round(d.daily.temperature_2m_max[0])}°C), ${sky}, wind ${Math.round(d.current.wind_speed_10m)} km/h`
}

export const today = () => new Date().toLocaleDateString('sv-SE')

// Exact cost as cents with two decimals, e.g. 0.0583 -> "5.83¢"
export const cents = (usd: number) => `${(usd * 100).toFixed(2)}¢`
