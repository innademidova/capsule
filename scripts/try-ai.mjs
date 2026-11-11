// Runs any text AI task the way the app does (a row in ai_requests + the ai function) and prints which model answered.
//   node scripts/try-ai.mjs <kind> '<json input>' [image_path]     e.g. tag '{"category":null}' <uid>/items/x.webp
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2] }
const sb = createClient('https://ajbdkvpyhoyzzzlrlttk.supabase.co', 'sb_publishable_zyycYXIPLQCCxPsccMttlQ_SglhZaMg')
const { error } = await sb.auth.signInWithPassword({ email: process.env.CAPSULE_EMAIL, password: process.env.CAPSULE_PASSWORD })
if (error) throw error
const [kind, input = '{}', image_path = null] = process.argv.slice(2)
if (kind === 'item') {
  // helper: print an item's photo path by id prefix
  const { data } = await sb.from('items').select('id,category,kind,name,brand,photo_path')
  console.log(data.filter(i => i.id.startsWith(input)))
  process.exit(0)
}
const { data: req, error: e1 } = await sb.from('ai_requests').insert({ kind, input: JSON.parse(input), mode: 'now', image_path, status: 'queued' }).select().single()
if (e1) throw e1
const t = Date.now()
const res = await sb.functions.invoke('ai', { body: { id: req.id } })
const secs = ((Date.now() - t) / 1000).toFixed(1)
if (res.error) { console.log('ERROR', secs + 's', await res.error.context?.text?.()); await sb.from('ai_requests').delete().eq('id', req.id); process.exit(1) }
console.log(`${res.data.model} · ${secs}s · $${res.data.cost_usd}`)
if (res.data.skipped?.length) console.log('skipped:', res.data.skipped)
console.log(JSON.stringify(res.data.result, null, 1).slice(0, 2500))
// a test run must not show up in the app
await sb.from('ai_requests').delete().eq('id', req.id)
