import { useRef, useState } from 'react'
import {
  supabase, processPhoto, uploadPhoto, askAI, requeue, CATEGORIES, categoryLabel, itemTitle,
  type AIRequest, type ShopItem, type Item,
} from './lib'
import { useStore, upsert, without } from './store'
import { Icon, Header, Photo, AIActions, RequestState, Chips, Section } from './ui'
import { go, back } from './App'

const PRIORITY: Record<number, string> = { 1: 'Must-have', 2: 'Good to have', 3: 'Someday' }

type Gap = { name: string; category: string; why: string; priority: number }

export function Shop() {
  const { requests, shopping, setRequests, setShopping } = useStore()
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [cat, setCat] = useState<string[]>([])
  const gapsReq = requests.find(r => r.kind === 'gaps')
  const lastGaps = requests.find(r => r.kind === 'gaps' && r.status === 'done')
  const todo = shopping.filter(s => !s.done).sort((a, b) => a.priority - b.priority)
  const done = shopping.filter(s => s.done)

  const analyze = async (mode: 'now' | 'queue') => {
    setBusy(true)
    try { setRequests(upsert(await askAI('gaps', {}, mode))) }
    catch (e) { const r = (e as { request?: AIRequest }).request; if (r) setRequests(upsert(r)); else alert((e as Error).message) }
    setBusy(false)
  }
  const addItem = async (row: Partial<ShopItem>) => {
    const { data, error } = await supabase.from('shopping').insert(row).select().single()
    if (error) return alert(error.message)
    setShopping(upsert(data as ShopItem))
  }
  const toggle = async (s: ShopItem) => {
    const { data } = await supabase.from('shopping').update({ done: !s.done }).eq('id', s.id).select().single()
    if (data) setShopping(upsert(data as ShopItem))
  }
  const remove = async (s: ShopItem) => {
    await supabase.from('shopping').delete().eq('id', s.id); setShopping(without(s.id))
  }
  const inList = (n: string) => shopping.some(s => s.name.toLowerCase() === n.toLowerCase())

  return (
    <div className="screen">
      <Header title="Shopping" />

      <button className="card stylist-cta" onClick={() => go('/buy')}>
        <span className="cta-icon"><Icon name="bag" /></span>
        <span><b>Before you buy</b><span className="muted small">Snap the item in the shop: does it really fit your wardrobe?</span></span>
      </button>

      <div className="card">
        <h3 className="card-title"><Icon name="sparkle" /> Wardrobe check</h3>
        {lastGaps ? <Gaps r={lastGaps} onAdd={g => addItem({ name: g.name, category: g.category, why: g.why, priority: g.priority })} inList={inList} />
          : <p className="muted">The stylist looks at your whole wardrobe and tells you what's missing, what you have too much of, and what to buy first.</p>}
        {gapsReq && gapsReq !== lastGaps && <RequestState req={gapsReq} onRequeue={async x => setRequests(upsert(await requeue(x)))} />}
        <AIActions label={lastGaps ? 'Check again' : 'Check my wardrobe'} onRun={analyze} busy={busy} cost="≈4¢" />
      </div>

      <div className="card">
        <div className="row"><h3 className="card-title grow">Shopping list</h3>
          <button className="icon-btn sm" onClick={() => setAdding(a => !a)} aria-label="Add"><Icon name={adding ? 'x' : 'plus'} /></button></div>
        {adding && (
          <div className="add-shop">
            <input placeholder="e.g. Black ankle boots" value={name} onChange={e => setName(e.target.value)} />
            <Chips options={CATEGORIES} value={cat} onChange={setCat} multi={false} />
            <button className="btn primary sm" disabled={!name.trim()} onClick={async () => {
              await addItem({ name: name.trim(), category: cat[0] ?? null, priority: 2 }); setName(''); setCat([]); setAdding(false)
            }}>Add</button>
          </div>
        )}
        {!todo.length && !adding && <p className="muted small">Nothing yet. Add things from the wardrobe check or saved looks.</p>}
        {todo.map(s => <ShopRow key={s.id} s={s} onToggle={toggle} onRemove={remove} />)}
        {done.length > 0 && <details className="done-list"><summary className="muted small">Bought ({done.length})</summary>
          {done.map(s => <ShopRow key={s.id} s={s} onToggle={toggle} onRemove={remove} />)}</details>}
      </div>
    </div>
  )
}

function ShopRow({ s, onToggle, onRemove }: { s: ShopItem; onToggle: (s: ShopItem) => void; onRemove: (s: ShopItem) => void }) {
  return (
    <div className={'shop-row' + (s.done ? ' done' : '')}>
      <button className={'check' + (s.done ? ' on' : '')} onClick={() => onToggle(s)} aria-label="Bought"><Icon name="check" /></button>
      <div className="grow">
        <b>{s.name}</b>
        <span className="muted small">{[s.category && categoryLabel(s.category), PRIORITY[s.priority]].filter(Boolean).join(' · ')}</span>
        {s.why && <span className="small">{s.why}</span>}
      </div>
      <button className="icon-btn sm" onClick={() => onRemove(s)} aria-label="Remove"><Icon name="x" /></button>
    </div>
  )
}

function Gaps({ r, onAdd, inList }: { r: AIRequest; onAdd: (g: Gap) => void; inList: (n: string) => boolean }) {
  const res = r.result as { summary: string; gaps: Gap[]; too_many: { what: string; why: string }[]; strengths: string[] }
  return (
    <div className="gaps">
      <p>{res.summary}</p>
      {res.gaps.length > 0 && <h4>What's missing</h4>}
      {[...res.gaps].sort((a, b) => a.priority - b.priority).map((g, n) => (
        <div key={n} className="gap">
          <div className="grow"><b>{g.name}</b> <span className={'pill p' + g.priority}>{PRIORITY[g.priority] ?? ''}</span><span className="small">{g.why}</span></div>
          <button className="btn sm" disabled={inList(g.name)} onClick={() => onAdd(g)}>{inList(g.name) ? <Icon name="check" /> : <><Icon name="plus" /> List</>}</button>
        </div>
      ))}
      {res.too_many.length > 0 && <><h4>You have enough of</h4>{res.too_many.map((t, n) => <p key={n} className="small"><b>{t.what}</b> · {t.why}</p>)}</>}
      {res.strengths.length > 0 && <><h4>What already works</h4><ul className="small">{res.strengths.map((s, n) => <li key={n}>{s}</li>)}</ul></>}
      <p className="muted small">Checked {new Date(r.done_at ?? r.created_at).toLocaleDateString()}</p>
    </div>
  )
}

// --- Before you buy ---

const VERDICT = { buy: 'Worth buying', maybe: 'Think it over', skip: 'Better skip' }

export function BeforeBuy() {
  const { items, requests, setRequests } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<{ preview: string; path: string } | null>(null)
  const [note, setNote] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const past = requests.filter(r => r.kind === 'buy')

  const pick = async (f?: File) => {
    if (!f) return
    setBusy(true)
    try { const p = await processPhoto(f); const { photo_path } = await uploadPhoto(p); setPhoto({ preview: p.preview, path: photo_path }) }
    catch (e) { alert((e as Error).message) }
    setBusy(false)
  }
  const run = async (mode: 'now' | 'queue') => {
    if (!photo) return
    setBusy(true)
    try { setRequests(upsert(await askAI('buy', { note, price }, mode, photo.path))); setPhoto(null); setNote(''); setPrice('') }
    catch (e) { const r = (e as { request?: AIRequest }).request; if (r) setRequests(upsert(r)); else alert((e as Error).message) }
    setBusy(false)
  }

  return (
    <div className="screen">
      <Header title="Before you buy" left={<button className="icon-btn" onClick={() => back('/shop')} aria-label="Back"><Icon name="back" /></button>} />
      <div className="form">
        <div className="picker">
          <div className="photo big">{photo ? <img src={photo.preview} alt="" /> : <span className="photo-empty">{busy ? 'Uploading…' : <Icon name="camera" />}</span>}</div>
          <div className="picker-btns"><button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="camera" /> {photo ? 'Change photo' : 'Photo of the item'}</button></div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <Section title="Note (optional)"><input placeholder="e.g. wool, oversized, for the office" value={note} onChange={e => setNote(e.target.value)} /></Section>
        <Section title="Price (optional)"><input placeholder="e.g. 2500 ₴" value={price} onChange={e => setPrice(e.target.value)} /></Section>
        <AIActions label="Check" onRun={run} busy={busy} disabled={!photo} />
      </div>

      {past.map(r => {
        const res = r.result as { verdict: 'buy' | 'maybe' | 'skip'; summary: string; pairs_with: string[]; similar: string[]; outfit_ideas: string[] } | null
        const find = (ids: string[]) => ids.map(id => items.find(i => i.id === id)).filter((i): i is Item => !!i)
        return (
          <div key={r.id} className="card buy-result">
            <div className="row">
              {r.image_path && <Photo path={r.image_path} alt="" className="buy-thumb" />}
              <div className="grow">
                {res ? <span className={'verdict ' + res.verdict}>{VERDICT[res.verdict]}</span> : <span className="muted small">Waiting…</span>}
                {(r.input.note || r.input.price) ? <p className="muted small">{[r.input.note, r.input.price].filter(Boolean).join(' · ') as string}</p> : null}
              </div>
            </div>
            <RequestState req={r} onRequeue={async x => setRequests(upsert(await requeue(x)))} />
            {res && (
              <>
                <p>{res.summary}</p>
                {res.pairs_with.length > 0 && <><h4>Goes with {res.pairs_with.length} of your items</h4><MiniItems items={find(res.pairs_with)} /></>}
                {res.similar.length > 0 && <><h4>You already have similar</h4><MiniItems items={find(res.similar)} /></>}
                {res.outfit_ideas.length > 0 && <><h4>Outfit ideas</h4><ul className="small">{res.outfit_ideas.map((o, n) => <li key={n}>{o}</li>)}</ul></>}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function MiniItems({ items }: { items: Item[] }) {
  return (
    <div className="mini-list">
      {items.map(i => <button key={i.id} className="mini" onClick={() => go(`/i/${i.id}`)}><Photo path={i.thumb_path ?? i.photo_path} alt="" /><span>{itemTitle(i)}</span></button>)}
    </div>
  )
}
