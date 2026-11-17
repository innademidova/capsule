// Fashion looks: ideas around one item ("Style it": one look at a time), the stylist assistant (free request),
// and AI photos of a woman wearing a look, shown next to the real item photos.
import { useState } from 'react'
import { supabase, autoLayout, askAI, renderLook, currentWeather, itemTitle, kindLabel, type Item, type Outfit, type AIRequest, type LookIdea, type LooksResult } from './lib'
import { useStore, upsert } from './store'
import { Icon, Header, Photo, AIActions, RequestState } from './ui'
import { go, back } from './App'
import { t } from './i18n'

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
const key = (req: AIRequest, n: number) => `${req.id}:${n}`

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
  return { drawing, draw }
}

function LookCard({ look, state, onDraw, onPatch }: { look: LookIdea; state?: 'busy' | 'error'; onDraw: () => void; onPatch: (p: Partial<LookIdea>) => Promise<void> }) {
  const { items, wishlist, setOutfits } = useStore()
  const its = pick(look.item_ids, [...items, ...wishlist])
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (look.outfit_id) return go(`/o/${look.outfit_id}`)
    setBusy(true)
    const { data, error } = await supabase.from('outfits').insert({
      name: look.label.charAt(0).toUpperCase() + look.label.slice(1), layout: autoLayout(its),
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
        : state === 'busy' ? <div className="look-wait"><FlatLay items={its} /><p><Icon name="sparkle" /> {t('looks.dressing')}</p></div>
        : <>
          <FlatLay items={its} />
          <button className="btn sm" onClick={onDraw}><Icon name="sparkle" /> {state === 'error' ? t('looks.drawError') : t('outfits.showOnMe')}<span className="cost">(OpenAI ≈9¢)</span></button>
        </>}
      <p className="look-label">{look.label}</p>
      <p className="small">{look.why}</p>
      <button className="btn sm" onClick={save} disabled={busy}><Icon name="heart" filled={!!look.outfit_id} /> {look.outfit_id ? t('common.saved') : t('outfits.save')}</button>
    </div>
  )
}

// One AI answer: headline, palette, looks, what is missing
function LooksView({ req, eyebrow, drawing, onDraw }: { req: AIRequest; eyebrow?: string; drawing: Drawing; onDraw: (n: number) => void }) {
  const { setRequests } = useStore()
  const r = req.result as LooksResult | null
  const patch = async (n: number, p: Partial<LookIdea>) => {
    const result = { ...r!, looks: r!.looks.map((l, i) => i === n ? { ...l, ...p } : l) }
    const { data, error } = await supabase.from('ai_requests').update({ result }).eq('id', req.id).select().single()
    if (error) throw error
    setRequests(upsert(data as AIRequest))
  }
  return (
    <div className="idea-block">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <RequestState req={req} />
      {req.status === 'done' && r && <>
        <div className="looks-head">
          <h2 className="looks-title">{r.title}</h2>
          <Palette colors={r.palette} />
        </div>
        {r.note && <p className="muted small">{r.note}</p>}
        <div className="looks">
          {r.looks.map((l, n) => <LookCard key={n} look={l} state={drawing[key(req, n)]} onDraw={() => onDraw(n)} onPatch={p => patch(n, p)} />)}
        </div>
        {r.missing.length > 0 && <p className="muted small">{t('looks.missing', { list: r.missing.join(', ') })}</p>}
      </>}
    </div>
  )
}

// Ask for looks, then draw each of them right away
function useLooks() {
  const { setRequests } = useStore()
  const { drawing, draw } = useDrawing()
  const [busy, setBusy] = useState(false)
  const ask = async (input: Record<string, unknown>) => {
    setBusy(true)
    try {
      const req = await askAI('looks', input, 'now')
      setRequests(upsert(req)); setBusy(false)
      await draw(req)
    } catch (e) {
      const r = (e as { request?: AIRequest }).request; if (r) setRequests(upsert(r)); else alert((e as Error).message)
      setBusy(false)
    }
  }
  return { busy, ask, drawing, draw }
}

// --- Feature 1: one item, its looks one at a time ---
// Each tap asks the stylist for ONE new look with the piece and draws it on her (2026-11-18: several looks in one
// collage confused the image model). The looks she already got are passed on, so the next one is different.

export function StyleItem({ item }: { item: Item }) {
  const { requests } = useStore()
  const [wish, setWish] = useState('')
  const { busy, ask, drawing, draw } = useLooks()
  const past = requests.filter(r => r.kind === 'looks' && r.input.item_id === item.id)
  const avoid = past.flatMap(r => r.status === 'done' ? (r.result as LooksResult).looks.map(l => ({ label: l.label, item_ids: l.item_ids })) : []).slice(0, 12)
  return (
    <div className="screen">
      <Header title="" left={<button className="icon-btn" onClick={() => back(`/i/${item.id}`)} aria-label={t('common.back')}><Icon name="back" /></button>} />
      <div className="style-hero">
        <p className="eyebrow">{t('looks.one', { piece: item.kind ? kindLabel(item.kind) : t('looks.piece') })}</p>
        <h2 className="looks-title big">{t('looks.many')}</h2>
        <Photo path={item.photo_path} alt={itemTitle(item)} className="big" />
      </div>
      <div className="form">
        <input placeholder={t('looks.wishPlaceholder')} value={wish} onChange={e => setWish(e.target.value)} />
        <AIActions label={past.length ? t('looks.anotherLook') : t('looks.getLook')} cost="OpenAI ≈10¢"
          onRun={() => { ask({ item_id: item.id, count: 1, request: wish.trim() || null, avoid }); setWish('') }} busy={busy} />
      </div>
      {past.map(r => <LooksView key={r.id} req={r} eyebrow={r.input.request ? String(r.input.request) : undefined} drawing={drawing} onDraw={n => draw(r, n)} />)}
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
    try { setWeather(await currentWeather()) } catch { alert(t('looks.weatherError')) }
    setWBusy(false)
  }
  return (
    <div className="screen">
      <Header title={t('looks.stylist')} left={<button className="icon-btn" onClick={() => back('/outfits')} aria-label={t('common.back')}><Icon name="back" /></button>} />
      <div className="form">
        {items.length < 3 && <p className="queued err">{t('looks.needItems')}</p>}
        <textarea rows={3} placeholder={t('looks.requestPlaceholder')} value={request} onChange={e => setRequest(e.target.value)} />
        <div className="row">
          <input placeholder={t('looks.weatherPlaceholder')} value={weather} onChange={e => setWeather(e.target.value)} />
          <button className="btn sm" onClick={getWeather} disabled={wBusy}><Icon name="sun" /> {wBusy ? '…' : t('looks.now')}</button>
        </div>
        <AIActions label={t('looks.getLooks')} cost="OpenAI ≈29¢" onRun={() => ask({ request: request.trim(), weather: weather.trim() || null, count: 3 })} busy={busy} disabled={items.length < 3 || !request.trim()} />
      </div>
      {past.map(r => <LooksView key={r.id} req={r} eyebrow={[r.input.request, r.input.weather].filter(Boolean).join(' · ')} drawing={drawing} onDraw={n => draw(r, n)} />)}
    </div>
  )
}
