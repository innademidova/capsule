// Fashion looks: ideas around one item ("one sweater, many looks"), the stylist assistant (free request),
// and AI photos of a woman wearing a look, shown next to the real item photos.
import { useState } from 'react'
import { supabase, autoLayout, askAI, renderLook, currentWeather, itemTitle, type Item, type Outfit, type AIRequest, type LookIdea, type LooksResult } from './lib'
import { useStore, upsert } from './store'
import { Icon, Header, Photo, AIActions, RequestState } from './ui'
import { go, back } from './App'

const pick = (ids: string[], items: Item[]) => ids.map(id => items.find(i => i.id === id)).filter((i): i is Item => !!i)

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

type Drawing = Record<string, 'busy' | 'error'>
const key = (req: AIRequest, n: number | 'collage') => `${req.id}:${n}`

// Draws every look of an answer at once; each photo appears as soon as it is ready.
// The look function also writes the path into the request, so the photos stay after a reload.
function useDrawing() {
  const { setRequests } = useStore()
  const [drawing, setDrawing] = useState<Drawing>({})
  const draw = async (req: AIRequest, which?: number) => {
    const r = req.result as LooksResult
    await Promise.all(r.looks.map(async (l, n) => {
      if (which != null ? n !== which : l.image_path) return
      setDrawing(d => ({ ...d, [key(req, n)]: 'busy' }))
      try {
        const res = await renderLook({ item_ids: l.item_ids, scene: l.scene, vibe: l.label, palette: r.palette, request_id: req.id, index: n })
        setRequests(list => list.map(x => x.id !== req.id ? x
          : { ...x, result: { ...x.result, looks: (x.result as LooksResult).looks.map((y, i) => i === n ? { ...y, image_path: res.path } : y) } }))
        setDrawing(d => { const c = { ...d }; delete c[key(req, n)]; return c })
      } catch { setDrawing(d => ({ ...d, [key(req, n)]: 'error' })) }
    }))
  }
  // "Style it": all looks in one collage around the piece (one image instead of one per look)
  const drawCollage = async (req: AIRequest, anchor: Item) => {
    const r = req.result as LooksResult
    const k = key(req, 'collage')
    setDrawing(d => ({ ...d, [k]: 'busy' }))
    try {
      const res = await renderLook({ request_id: req.id, many: {
        anchor_id: anchor.id, title: `One ${anchor.kind || 'piece'}`, palette: r.palette,
        looks: r.looks.map(l => ({ label: l.label, item_ids: l.item_ids })),
      } })
      setRequests(list => list.map(x => x.id !== req.id ? x : { ...x, result: { ...x.result, collage_path: res.path } }))
      setDrawing(d => { const c = { ...d }; delete c[k]; return c })
    } catch { setDrawing(d => ({ ...d, [k]: 'error' })) }
  }
  return { drawing, draw, drawCollage }
}

// onDraw is left out on "Style it": there the looks are drawn together in one collage
function LookCard({ look, state, onDraw, onPatch }: { look: LookIdea; state?: 'busy' | 'error'; onDraw?: () => void; onPatch: (p: Partial<LookIdea>) => Promise<void> }) {
  const { items, wishlist, setOutfits } = useStore()
  const its = pick(look.item_ids, [...items, ...wishlist])
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (look.outfit_id) return go(`/o/${look.outfit_id}`)
    setBusy(true)
    const { data, error } = await supabase.from('outfits').insert({
      name: look.label.charAt(0).toUpperCase() + look.label.slice(1), layout: autoLayout(its.filter(i => !i.wishlist)),
      source: 'ai', notes: look.why, image_path: look.image_path ?? null,
    }).select().single()
    setBusy(false)
    if (error) return alert(error.message)
    setOutfits(upsert(data as Outfit))
    await onPatch({ outfit_id: (data as Outfit).id })
    go(`/o/${(data as Outfit).id}`)
  }
  return (
    <div className="card look">
      {look.image_path ? <Photo path={look.image_path} alt={look.label} className="look-post" zoom />
        : state === 'busy' ? <div className="look-wait"><FlatLay items={its} /><p><Icon name="sparkle" /> Dressing you up, about a minute…</p></div>
        : <>
          <FlatLay items={its} />
          {onDraw && <button className="btn sm" onClick={onDraw}><Icon name="sparkle" /> {state === 'error' ? 'Could not draw it. Try again' : 'Show on me'}<span className="cost">(OpenAI ≈9¢)</span></button>}
        </>}
      <p className="look-label">{look.label}</p>
      <p className="small">{look.why}</p>
      <button className="btn sm" onClick={save} disabled={busy}><Icon name="heart" filled={!!look.outfit_id} /> {look.outfit_id ? 'Saved' : 'Save outfit'}</button>
    </div>
  )
}

// One AI answer: headline, palette, looks, what is missing
function LooksView({ req, eyebrow, drawing, onDraw, onCollage }: {
  req: AIRequest; eyebrow?: string; drawing: Drawing; onDraw: (n: number) => void; onCollage?: () => void
}) {
  const { setRequests, items, setOutfits } = useStore()
  const r = req.result as LooksResult | null
  const patch = async (n: number, p: Partial<LookIdea>) => {
    const result = { ...r!, looks: r!.looks.map((l, i) => i === n ? { ...l, ...p } : l) }
    const { data, error } = await supabase.from('ai_requests').update({ result }).eq('id', req.id).select().single()
    if (error) throw error
    setRequests(upsert(data as AIRequest))
  }
  // The collage as an AI outfit: the picture plus the anchor piece, so it shows up under that piece too
  const [savingCollage, setSavingCollage] = useState(false)
  const saveCollage = async () => {
    if (!r?.collage_path) return
    if (r.collage_outfit_id) return go(`/o/${r.collage_outfit_id}`)
    setSavingCollage(true)
    const anchor = String(req.input.item_id ?? '')
    const kind = items.find(i => i.id === anchor)?.kind || 'piece'
    const { data, error } = await supabase.from('outfits').insert({
      name: `One ${kind}, many looks`, layout: anchor ? [{ item_id: anchor, x: 20, y: 20, w: 60, z: 1 }] : [],
      source: 'ai', notes: r.looks.map(l => l.label).join(' · '), image_path: r.collage_path,
    }).select().single()
    if (error) { setSavingCollage(false); return alert(error.message) }
    setOutfits(upsert(data as Outfit))
    const result = { ...r, collage_outfit_id: (data as Outfit).id }
    const { data: saved } = await supabase.from('ai_requests').update({ result }).eq('id', req.id).select().single()
    if (saved) setRequests(upsert(saved as AIRequest))
    setSavingCollage(false)
  }
  return (
    <div className="idea-block">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <RequestState req={req} hideModel={!!onCollage} />
      {req.status === 'done' && r && <>
        <div className="looks-head">
          <h2 className="looks-title">{r.title}</h2>
          <Palette colors={r.palette} />
        </div>
        {r.note && <p className="muted small">{r.note}</p>}
        {onCollage && (r.collage_path ? <>
            <Photo path={r.collage_path} alt={r.title} className="look-post collage-post" zoom />
            <button className="btn wide collage-save" onClick={saveCollage} disabled={savingCollage}>
              <Icon name="heart" filled={!!r.collage_outfit_id} /> {r.collage_outfit_id ? 'Saved to outfits' : 'Save to outfits'}
            </button>
          </>
          : drawing[key(req, 'collage')] === 'busy' ? <div className="photo look-post collage-post collage-wait"><p><Icon name="sparkle" /> Drawing all looks on you in one picture, about a minute…</p></div>
          : <button className="btn wide" onClick={onCollage}><Icon name="sparkle" /> {drawing[key(req, 'collage')] === 'error' ? 'Could not draw the collage. Try again' : 'Draw all looks in one picture'}<span className="cost">(OpenAI ≈17¢)</span></button>)}
        <div className="looks">
          {r.looks.map((l, n) => <LookCard key={n} look={l} state={drawing[key(req, n)]} onDraw={onCollage ? undefined : () => onDraw(n)} onPatch={p => patch(n, p)} />)}
        </div>
        {r.missing.length > 0 && <p className="muted small">Would make these looks even better: {r.missing.join(', ')}</p>}
      </>}
    </div>
  )
}

// Ask for looks, then draw them right away: each look apart, or (with an anchor piece) all in one collage
function useLooks(anchor?: Item) {
  const { setRequests } = useStore()
  const { drawing, draw, drawCollage } = useDrawing()
  const [busy, setBusy] = useState(false)
  const ask = async (input: Record<string, unknown>) => {
    setBusy(true)
    try {
      const req = await askAI('looks', input, 'now')
      setRequests(upsert(req)); setBusy(false)
      await (anchor ? drawCollage(req, anchor) : draw(req))
    } catch (e) {
      const r = (e as { request?: AIRequest }).request; if (r) setRequests(upsert(r)); else alert((e as Error).message)
      setBusy(false)
    }
  }
  return { busy, ask, drawing, draw, drawCollage }
}

// --- Feature 1: one item, many looks ---

export function StyleItem({ item }: { item: Item }) {
  const { requests } = useStore()
  const [wish, setWish] = useState('')
  // How many looks around the piece; the last choice is remembered on this device
  const [count, setCount] = useState(() => { try { return Number(localStorage.getItem('style-it-count')) || 4 } catch { return 4 } })
  const chooseCount = (n: number) => { setCount(n); try { localStorage.setItem('style-it-count', String(n)) } catch { /* private mode */ } }
  const { busy, ask, drawing, draw, drawCollage } = useLooks(item)
  const past = requests.filter(r => r.kind === 'looks' && r.input.item_id === item.id)
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
        <div className="seg looks-count" role="radiogroup" aria-label="Number of looks">
          {[3, 4, 5, 6].map(n => <button key={n} type="button" role="radio" aria-checked={count === n} className={count === n ? 'on' : ''} onClick={() => chooseCount(n)} disabled={busy}>{n} looks</button>)}
        </div>
        <AIActions label={past.length ? 'New looks' : 'Get looks'} cost="OpenAI ≈19¢" onRun={() => { ask({ item_id: item.id, count, request: wish.trim() || null }); setWish('') }} busy={busy} />
      </div>
      {past.map(r => <LooksView key={r.id} req={r} eyebrow={r.input.request ? String(r.input.request) : undefined} drawing={drawing}
        onDraw={n => draw(r, n)} onCollage={() => drawCollage(r, item)} />)}
    </div>
  )
}

// --- Feature 3: the stylist assistant ---

export function Assistant() {
  const { items, requests } = useStore()
  const [request, setRequest] = useState('')
  const [weather, setWeather] = useState('')
  const { busy, ask, drawing, draw } = useLooks()
  const [wBusy, setWBusy] = useState(false)
  const past = requests.filter(r => r.kind === 'looks' && !r.input.item_id)
  const getWeather = async () => {
    setWBusy(true)
    try { setWeather(await currentWeather()) } catch { alert('Could not get the weather. Allow location access or type it in.') }
    setWBusy(false)
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
        <AIActions label="Get looks" cost="OpenAI ≈29¢" onRun={() => ask({ request: request.trim(), weather: weather.trim() || null, count: 3 })} busy={busy} disabled={items.length < 3 || !request.trim()} />
      </div>
      {past.map(r => <LooksView key={r.id} req={r} eyebrow={[r.input.request, r.input.weather].filter(Boolean).join(' · ')} drawing={drawing} onDraw={n => draw(r, n)} />)}
    </div>
  )
}
