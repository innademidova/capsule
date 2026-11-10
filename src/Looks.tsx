// Fashion looks: ideas around one item ("one sweater, many looks"), the stylist assistant (free request),
// and AI photos of a woman wearing a look, shown next to the real item photos.
import { useState } from 'react'
import { supabase, autoLayout, askAI, requeue, renderLook, currentWeather, itemTitle, type Item, type Outfit, type AIRequest, type LookIdea, type LooksResult } from './lib'
import { useStore, upsert } from './store'
import { Icon, Header, Photo, AIActions, RequestState } from './ui'
import { go, back } from './App'

const pick = (ids: string[], items: Item[]) => ids.map(id => items.find(i => i.id === id)).filter((i): i is Item => !!i)

// AI photo on the left, the real pieces on the right (like a styling post, without texts)
export function LookPair({ image, items }: { image: string; items: Item[] }) {
  return (
    <div className="look-pair">
      <Photo path={image} alt="" className="look-img" />
      <div className={'look-pieces' + (items.length > 4 ? ' many' : '')}>
        {items.map(i => <button key={i.id} onClick={() => go(`/i/${i.id}`)}><Photo path={i.thumb_path ?? i.photo_path} alt={itemTitle(i)} /></button>)}
      </div>
    </div>
  )
}

// Pieces of a look laid out flat, before there is a photo
function FlatLay({ items }: { items: Item[] }) {
  return (
    <div className="look-flat">
      {items.map(i => <button key={i.id} onClick={() => go(`/i/${i.id}`)}><Photo path={i.thumb_path ?? i.photo_path} alt={itemTitle(i)} /></button>)}
    </div>
  )
}

export function Palette({ colors }: { colors: string[] }) {
  return <div className="palette">{colors.map(c => <span key={c} style={{ background: c }} />)}</div>
}

function LookCard({ look, onPatch }: { look: LookIdea; onPatch: (p: Partial<LookIdea>) => Promise<void> }) {
  const { items, wishlist, setOutfits } = useStore()
  const its = pick(look.item_ids, [...items, ...wishlist])
  const [busy, setBusy] = useState('')
  const draw = async () => {
    setBusy('draw')
    try { const r = await renderLook({ item_ids: its.map(i => i.id), scene: look.scene, vibe: look.label }); await onPatch({ image_path: r.path }) }
    catch (e) { alert((e as Error).message) }
    setBusy('')
  }
  const save = async () => {
    if (look.outfit_id) return go(`/o/${look.outfit_id}`)
    setBusy('save')
    const { data, error } = await supabase.from('outfits').insert({
      name: look.label.charAt(0).toUpperCase() + look.label.slice(1), layout: autoLayout(its.filter(i => !i.wishlist)),
      source: 'ai', notes: look.why, image_path: look.image_path ?? null,
    }).select().single()
    setBusy('')
    if (error) return alert(error.message)
    setOutfits(upsert(data as Outfit))
    await onPatch({ outfit_id: (data as Outfit).id })
    go(`/o/${(data as Outfit).id}`)
  }
  return (
    <div className="card look">
      {look.image_path ? <LookPair image={look.image_path} items={its} /> : <FlatLay items={its} />}
      <p className="look-label">{look.label}</p>
      <p className="small">{look.why}</p>
      <div className="row wrap">
        <button className="btn sm" onClick={draw} disabled={!!busy}>
          <Icon name="sparkle" /> {busy === 'draw' ? 'Drawing, about a minute…' : look.image_path ? 'Draw again' : 'Show on me'}<span className="cost">≈7¢</span>
        </button>
        <button className="btn sm" onClick={save} disabled={!!busy}><Icon name="heart" filled={!!look.outfit_id} /> {look.outfit_id ? 'Saved' : 'Save outfit'}</button>
      </div>
    </div>
  )
}

// One AI answer: headline, palette, looks, what is missing
export function LooksView({ req, eyebrow }: { req: AIRequest; eyebrow?: string }) {
  const { setRequests } = useStore()
  const r = req.result as LooksResult | null
  // Photos and saved outfits are stored back into the request, so they stay after a reload
  const patch = async (n: number, p: Partial<LookIdea>) => {
    const result = { ...r!, looks: r!.looks.map((l, i) => i === n ? { ...l, ...p } : l) }
    const { data, error } = await supabase.from('ai_requests').update({ result }).eq('id', req.id).select().single()
    if (error) throw error
    setRequests(upsert(data as AIRequest))
  }
  return (
    <div className="idea-block">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <RequestState req={req} onRequeue={async x => setRequests(upsert(await requeue(x)))} />
      {req.status === 'done' && r && <>
        <div className="looks-head">
          <h2 className="looks-title">{r.title}</h2>
          <Palette colors={r.palette} />
        </div>
        {r.note && <p className="muted small">{r.note}</p>}
        <div className="looks">
          {r.looks.map((l, n) => <LookCard key={n} look={l} onPatch={p => patch(n, p)} />)}
        </div>
        {r.missing.length > 0 && <p className="muted small">Would make these looks even better: {r.missing.join(', ')}</p>}
      </>}
    </div>
  )
}

// --- Feature 1: one item, many looks ---

export function StyleItem({ item }: { item: Item }) {
  const { requests, setRequests } = useStore()
  const [wish, setWish] = useState('')
  const [busy, setBusy] = useState(false)
  const past = requests.filter(r => r.kind === 'looks' && r.input.item_id === item.id)
  const run = async (mode: 'now' | 'queue') => {
    setBusy(true)
    try { setRequests(upsert(await askAI('looks', { item_id: item.id, count: 4, request: wish.trim() || null }, mode))); setWish('') }
    catch (e) { const r = (e as { request?: AIRequest }).request; if (r) setRequests(upsert(r)); else alert((e as Error).message) }
    setBusy(false)
  }
  return (
    <div className="screen">
      <Header title="" left={<button className="icon-btn" onClick={() => back(`/i/${item.id}`)} aria-label="Back"><Icon name="back" /></button>} />
      <div className="style-hero">
        <p className="eyebrow">One {item.kind || 'piece'}</p>
        <h2 className="looks-title big">many looks</h2>
        <Photo path={item.photo_path} alt={itemTitle(item)} className="big" />
      </div>
      <div className="form">
        <input placeholder="Wish (optional): e.g. for autumn, more relaxed" value={wish} onChange={e => setWish(e.target.value)} />
        <AIActions label={past.length ? 'New looks' : 'Get looks'} cost="≈1¢" onRun={run} busy={busy} />
      </div>
      {past.map(r => <LooksView key={r.id} req={r} eyebrow={r.input.request ? String(r.input.request) : undefined} />)}
    </div>
  )
}

// --- Feature 3: the stylist assistant ---

export function Assistant() {
  const { items, requests, setRequests } = useStore()
  const [request, setRequest] = useState('')
  const [weather, setWeather] = useState('')
  const [busy, setBusy] = useState(false)
  const [wBusy, setWBusy] = useState(false)
  const past = requests.filter(r => r.kind === 'looks' && !r.input.item_id)
  const getWeather = async () => {
    setWBusy(true)
    try { setWeather(await currentWeather()) } catch { alert('Could not get the weather. Allow location access or type it in.') }
    setWBusy(false)
  }
  const run = async (mode: 'now' | 'queue') => {
    setBusy(true)
    try { setRequests(upsert(await askAI('looks', { request: request.trim(), weather: weather.trim() || null, count: 3 }, mode))) }
    catch (e) { const r = (e as { request?: AIRequest }).request; if (r) setRequests(upsert(r)); else alert((e as Error).message) }
    setBusy(false)
  }
  return (
    <div className="screen">
      <Header title="Stylist" left={<button className="icon-btn" onClick={() => back('/outfits')} aria-label="Back"><Icon name="back" /></button>} />
      <div className="form">
        {items.length < 3 && <p className="queued err">Add at least a few items to your wardrobe first.</p>}
        <textarea rows={3} placeholder="What do you need? e.g. soft looks for autumn, +15, in pastel shades" value={request} onChange={e => setRequest(e.target.value)} />
        <div className="row">
          <input placeholder="Weather (optional), e.g. +15°C, sunny" value={weather} onChange={e => setWeather(e.target.value)} />
          <button className="btn sm" onClick={getWeather} disabled={wBusy}><Icon name="sun" /> {wBusy ? '…' : 'Now'}</button>
        </div>
        <AIActions label="Get looks" cost="≈1¢" onRun={run} busy={busy} disabled={items.length < 3 || !request.trim()} />
      </div>
      {past.map(r => <LooksView key={r.id} req={r} eyebrow={[r.input.request, r.input.weather].filter(Boolean).join(' · ')} />)}
    </div>
  )
}
