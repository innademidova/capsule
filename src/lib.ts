import { createClient } from '@supabase/supabase-js'

// Публічний ключ: дані захищені правилами доступу в базі (RLS) і входом за паролем
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
  photo_path: string | null
  thumb_path: string | null
  favorite: boolean
  created_at: string
  updated_at: string
}

export type Option = { id: string; label: string }

export const CATEGORIES: Option[] = [
  { id: 'top', label: 'Tops' },
  { id: 'bottom', label: 'Bottoms' },
  { id: 'dress', label: 'Dresses' },
  { id: 'outerwear', label: 'Outerwear' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'bag', label: 'Bags' },
  { id: 'accessory', label: 'Accessories' },
]
export const categoryLabel = (id: string) => CATEGORIES.find(c => c.id === id)?.label ?? id

// Підказки для поля «тип» залежно від категорії
export const KINDS: Record<string, string[]> = {
  top: ['t-shirt', 'shirt', 'blouse', 'sweater', 'cardigan', 'turtleneck', 'hoodie', 'sweatshirt', 'top', 'tank top', 'bodysuit', 'polo'],
  bottom: ['jeans', 'trousers', 'skirt', 'shorts', 'leggings', 'joggers'],
  dress: ['dress', 'midi dress', 'maxi dress', 'mini dress', 'jumpsuit', 'set'],
  outerwear: ['coat', 'trench coat', 'jacket', 'blazer', 'leather jacket', 'denim jacket', 'puffer', 'vest', 'raincoat'],
  shoes: ['sneakers', 'boots', 'ankle boots', 'loafers', 'heels', 'flats', 'sandals', 'mules', 'ballet flats'],
  bag: ['tote', 'shoulder bag', 'crossbody', 'clutch', 'backpack', 'mini bag'],
  accessory: ['belt', 'scarf', 'hat', 'cap', 'jewelry', 'sunglasses', 'gloves', 'watch', 'hair accessory'],
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

// --- Фото: підписані посилання (бакет приватний) ---

// Посилання живуть добу, тож браузер бере картинки з кешу і не качає їх повторно.
// Запити з багатьох плиток збираються в один пакет.
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

// --- Обробка фото перед завантаженням ---
// Якісне зменшення (поступово, по половині), обрізання прозорих країв у вирізаних речей.
// Повне фото до 1600px, прев'ю для галереї до 600px. WebP (зберігає прозорість),
// якщо браузер не вміє WebP — PNG для прозорих, JPEG для звичайних.

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

// Межі непрозорої частини; null — якщо прозорих пікселів немає
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

// Картинка з буфера обміну (iPhone: «Скопіювати» вирізаний об'єкт у Фото)
export const canPaste = () => typeof navigator !== 'undefined' && !!navigator.clipboard?.read

export async function pasteImage(): Promise<Blob | null> {
  const items = await navigator.clipboard.read()
  for (const it of items) {
    const type = it.types.find(t => t.startsWith('image/'))
    if (type) return it.getType(type)
  }
  return null
}
