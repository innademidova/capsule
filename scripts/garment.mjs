// Runs the `garment` Edge Function (same as "Enhance with AI" in the app) on a local photo and saves the PNG.
//   node scripts/garment.mjs <photo> <out.png> ['<piece>'] ['<correction>' ...]
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
const { data, error } = await sb.functions.invoke('garment', { body: { source_path: source, piece, corrections } })
if (error) { console.error(error, await error.context?.text?.()); process.exit(1) }
const { data: blob } = await sb.storage.from('photos').download(data.path)
writeFileSync(out, Buffer.from(await blob.arrayBuffer()))
await sb.storage.from('photos').remove([source, data.path])
console.log('saved', out)
