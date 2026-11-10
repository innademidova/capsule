// Runs the `garment` Edge Function (same as "Enhance with AI" in the app) on a local photo and saves the PNG.
//   node scripts/garment.mjs <photo> <out.png> ['<piece>'] ['<instruction>' ...]   (REFS=a.jpg,b.jpg adds extra photos; SET=1 draws every piece of a set side by side)
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
const [src, out, piece = 'the main garment in the photo', ...corrections] = process.argv.slice(2)
for (const line of readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2] }
const sb = createClient('https://ajbdkvpyhoyzzzlrlttk.supabase.co', 'sb_publishable_zyycYXIPLQCCxPsccMttlQ_SglhZaMg')
const { data: s, error: authError } = await sb.auth.signInWithPassword({ email: process.env.CAPSULE_EMAIL, password: process.env.CAPSULE_PASSWORD })
if (authError) throw authError
const source = `${s.user.id}/drafts/${randomUUID()}.${src.split('.').pop().toLowerCase()}`
const { error: up } = await sb.storage.from('photos').upload(source, readFileSync(src), { contentType: src.endsWith('.png') ? 'image/png' : 'image/jpeg' })
if (up) throw up
const refs = []
for (const f of (process.env.REFS || '').split(',').filter(Boolean)) {
  const p = `${s.user.id}/drafts/${randomUUID()}.${f.split('.').pop().toLowerCase()}`
  const { error: e } = await sb.storage.from('photos').upload(p, readFileSync(f), { contentType: f.endsWith('.png') ? 'image/png' : 'image/jpeg' })
  if (e) throw e
  refs.push(p)
}
const { data, error } = await sb.functions.invoke('garment', { body: { source_path: source, ref_paths: refs, piece, corrections, set: !!process.env.SET } })
if (error) { console.error(error, await error.context?.text?.()); process.exit(1) }
const { data: blob } = await sb.storage.from('photos').download(data.path)
writeFileSync(out, Buffer.from(await blob.arrayBuffer()))
await sb.storage.from('photos').remove([source, data.path, ...refs])
console.log('saved', out, '| tokens: text in', data.text_in, 'image in', data.image_in, 'out', data.output, '| cost', (data.cost_usd * 100).toFixed(2) + '¢')
