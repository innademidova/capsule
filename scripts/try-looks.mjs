// Tries the stylist looks and the look photo from the command line (paid: ≈2¢ for ideas, ≈8¢ per photo).
//   node scripts/try-looks.mjs ideas '<json input>'            e.g. '{"item_id":"…","count":4}' or '{"request":"soft autumn looks"}'
//   node scripts/try-looks.mjs photo <out.webp> '<json body>'   e.g. '{"item_ids":["…"],"scene":"…","vibe":"city chic"}'
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2] }
const sb = createClient('https://ajbdkvpyhoyzzzlrlttk.supabase.co', 'sb_publishable_zyycYXIPLQCCxPsccMttlQ_SglhZaMg')
const { error: authError } = await sb.auth.signInWithPassword({ email: process.env.CAPSULE_EMAIL, password: process.env.CAPSULE_PASSWORD })
if (authError) throw authError
const [cmd, a, b] = process.argv.slice(2)
const fail = async e => { let m = e.message; try { m = (await e.context.json()).error ?? m } catch {} ; throw new Error(m) }
if (cmd === 'ideas') {
  const { data: r, error } = await sb.from('ai_requests').insert({ kind: 'looks', input: JSON.parse(a), mode: 'now', status: 'queued' }).select().single()
  if (error) throw error
  const res = await sb.functions.invoke('ai', { body: { id: r.id } })
  if (res.error) await fail(res.error)
  console.log(JSON.stringify(res.data, null, 1))
} else if (cmd === 'photo') {
  const res = await sb.functions.invoke('look', { body: JSON.parse(b) })
  if (res.error) await fail(res.error)
  const { data } = await sb.storage.from('photos').download(res.data.path)
  writeFileSync(a, Buffer.from(await data.arrayBuffer()))
  console.log(`saved ${a} (${res.data.path}) | tokens: text in ${res.data.text_in} image in ${res.data.image_in} out ${res.data.output} | cost ${(res.data.cost_usd * 100).toFixed(2)}¢`)
}
