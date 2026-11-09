// Adds an item to the wardrobe and prepares its photo with cutout.mjs.
//   node scripts/add-item.mjs <photo> '<JSON with items fields>'   (WARM/MINL/TOL/KEEP env vars are passed on to cutout)
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
const [src, json] = process.argv.slice(2)
for (const line of readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2] }
const sb = createClient('https://ajbdkvpyhoyzzzlrlttk.supabase.co', 'sb_publishable_zyycYXIPLQCCxPsccMttlQ_SglhZaMg')
const { data: s, error: authError } = await sb.auth.signInWithPassword({ email: process.env.CAPSULE_EMAIL, password: process.env.CAPSULE_PASSWORD })
if (authError) throw authError
const id = crypto.randomUUID()
const photo_path = `${s.user.id}/${id}.webp`, thumb_path = `${s.user.id}/${id}_thumb.webp`
const r = await sb.from('items').insert({ id, ...JSON.parse(json), photo_path, thumb_path })
if (r.error) throw r.error
try {
  execFileSync('node', ['scripts/cutout.mjs', src, id], { stdio: 'inherit' })
} catch (e) { await sb.from('items').delete().eq('id', id); throw e }
