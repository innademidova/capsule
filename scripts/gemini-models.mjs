// Gemini diagnostics via the gemini-models Edge Function.
// node scripts/gemini-models.mjs            list models
// node scripts/gemini-models.mjs a b c      send each model a tiny JSON request (free-tier check)
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const line of readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2] }
const sb = createClient('https://ajbdkvpyhoyzzzlrlttk.supabase.co', 'sb_publishable_zyycYXIPLQCCxPsccMttlQ_SglhZaMg')
const { error } = await sb.auth.signInWithPassword({ email: process.env.CAPSULE_EMAIL, password: process.env.CAPSULE_PASSWORD })
if (error) throw error
const probe = process.argv.slice(2)
const { data, error: e2 } = await sb.functions.invoke('gemini-models', probe.length ? { body: { models: probe } } : { method: 'GET' })
if (e2) { console.log(await e2.context?.text?.()); process.exit(1) }
if (probe.length) { for (const r of data) console.log(JSON.stringify(r)); process.exit(0) }
for (const m of data) if (m.methods?.includes('generateContent')) console.log(m.name, '|', m.display, '| in', m.input, 'out', m.output, '| thinking', m.thinking)
