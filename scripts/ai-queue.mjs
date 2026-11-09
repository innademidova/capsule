// Free AI queue: requests from the app are processed by Claude Code.
//   node scripts/ai-queue.mjs export <dir>   → <dir>/ctx.json + photos to look at
//   node scripts/ai-queue.mjs apply <res.json>  → res.json: {"results":[{"id":"…","result":{…}}]}
// Login comes from .env.local (CAPSULE_EMAIL, CAPSULE_PASSWORD).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

for (const line of existsSync('.env.local') ? readFileSync('.env.local', 'utf8').split('\n') : []) {
  const m = line.match(/^(\w+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const sb = createClient('https://ajbdkvpyhoyzzzlrlttk.supabase.co', 'sb_publishable_zyycYXIPLQCCxPsccMttlQ_SglhZaMg')
const { error: le } = await sb.auth.signInWithPassword({ email: process.env.CAPSULE_EMAIL, password: process.env.CAPSULE_PASSWORD })
if (le) { console.error('Login failed:', le.message); process.exit(1) }

const [cmd, arg] = process.argv.slice(2)

async function save(dir, path) {
  if (!path) return null
  const file = join(dir, path.replaceAll('/', '_'))
  if (!existsSync(file)) {
    const { data, error } = await sb.storage.from('photos').download(path)
    if (error) return null
    writeFileSync(file, Buffer.from(await data.arrayBuffer()))
  }
  return file
}

if (cmd === 'export') {
  const dir = arg ?? 'queue-export'; mkdirSync(dir, { recursive: true })
  const [q, items, ins, prof, wear] = await Promise.all([
    sb.from('ai_requests').select('*').eq('status', 'queued').order('created_at'),
    sb.from('items').select('*').eq('wishlist', false).order('created_at'),
    sb.from('inspirations').select('*').order('created_at'),
    sb.from('style_profile').select('*').maybeSingle(),
    sb.from('wear_log').select('item_ids'),
  ])
  const worn = {}; (wear.data ?? []).forEach(w => w.item_ids.forEach(id => { worn[id] = (worn[id] ?? 0) + 1 }))
  const requests = []
  for (const r of q.data ?? []) {
    const x = { ...r, local_image: await save(dir, r.image_path) }
    if (r.kind === 'inspo') {
      const i = (ins.data ?? []).find(i => i.id === r.input.inspiration_id)
      x.inspiration = i ? { note: i.note, local_image: await save(dir, i.image_path) } : null
    }
    if (r.kind === 'tag' && !r.image_path) {
      // bulk tagging: items without tags
      x.untagged = []
      for (const it of (items.data ?? []).filter(i => !i.colors.length || !i.kind || !i.seasons.length || !i.styles.length || !i.occasions.length))
        x.untagged.push({ id: it.id, category: it.category, kind: it.kind, name: it.name, local_image: await save(dir, it.photo_path) })
    }
    requests.push(x)
  }
  const ctx = {
    requests,
    wardrobe: (items.data ?? []).map(i => ({ ...i, worn: worn[i.id] ?? 0 })),
    inspirations: (ins.data ?? []).map(i => ({ id: i.id, note: i.note, analysis: i.analysis })),
    style_profile: prof.data ?? null,
  }
  writeFileSync(join(dir, 'ctx.json'), JSON.stringify(ctx, null, 1))
  console.log(`${requests.length} queued request(s): ${requests.map(r => r.kind).join(', ') || '—'}  →  ${join(dir, 'ctx.json')}`)
} else if (cmd === 'apply') {
  const { results } = JSON.parse(readFileSync(arg, 'utf8'))
  for (const { id, result } of results) {
    const { error } = await sb.from('ai_requests').update({ status: 'done', result }).eq('id', id)
    console.log(id, error ? 'ERROR ' + error.message : 'done')
  }
} else {
  console.log('Usage: node scripts/ai-queue.mjs export <dir> | apply <res.json>')
}
