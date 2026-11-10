import { useMemo, useRef, useState } from 'react'
import {
  supabase, CATEGORIES, OCCASIONS, SEASONS, autoLayout, renderLook, today, itemTitle, labelOf,
  type Item, type Outfit, type Placement, type Wear,
} from './lib'
import { useStore, upsert, without } from './store'
import { Icon, Header, Collage, Chips, Section, Photo, AIActions, RequestState, Sheet } from './ui'
import { go, back } from './App'
import { LookPair } from './Looks'

const outfitItems = (o: { layout: Placement[] }, items: Item[]) =>
  o.layout.map(p => items.find(i => i.id === p.item_id)).filter((i): i is Item => !!i)

export async function logWear(item_ids: string[], outfit_id: string | null) {
  const { data, error } = await supabase.from('wear_log').insert({ item_ids, outfit_id, worn_on: today() }).select().single()
  if (error) throw error
  return data as Wear
}

// --- Outfit list ---

export function OutfitList() {
  const { outfits, items } = useStore()
  const [fav, setFav] = useState(false)
  const shown = outfits.filter(o => !fav || o.favorite)
  return (
    <div className="screen">
      <Header title="Outfits" right={
        <button className={'icon-btn' + (fav ? ' fav' : '')} onClick={() => setFav(f => !f)} aria-label="Favorites"><Icon name="heart" filled={fav} /></button>
      } />
      <button className="card stylist-cta" onClick={() => go('/stylist')}>
        <span className="cta-icon"><Icon name="sparkle" /></span>
        <span><b>Ask your stylist</b><span className="muted small">Describe what you need: looks from your own clothes, with a photo on you</span></span>
      </button>
      {outfits.length === 0 ? (
        <div className="empty">
          <Icon name="layers" />
          <h2>No outfits yet</h2>
          <p className="muted">Put together a look from your wardrobe, or ask the stylist for ideas.</p>
          <button className="btn primary" onClick={() => go('/o/new')} disabled={!items.length}><Icon name="plus" /> New outfit</button>
        </div>
      ) : (
        <div className="grid outfits">
          {shown.map(o => (
            <button key={o.id} className="tile" onClick={() => go(`/o/${o.id}`)}>
              {o.image_path ? <Photo path={o.image_path} alt="" className="look-thumb" /> : <Collage layout={o.layout} items={items} />}
              {o.favorite && <span className="tile-fav"><Icon name="heart" filled /></span>}
              <span className="tile-name">{o.name || 'Outfit'}</span>
            </button>
          ))}
        </div>
      )}
      {outfits.length > 0 && <button className="fab" onClick={() => go('/o/new')} aria-label="New outfit"><Icon name="plus" /></button>}
    </div>
  )
}

// --- Outfit card ---

export function OutfitDetail({ outfit }: { outfit: Outfit }) {
  const { items, wear, setOutfits, setWear } = useStore()
  const list = outfitItems(outfit, items)
  const worn = wear.filter(w => w.outfit_id === outfit.id)
  const wornToday = worn.some(w => w.worn_on === today())

  const patch = async (p: Partial<Outfit>) => {
    const { data, error } = await supabase.from('outfits').update(p).eq('id', outfit.id).select().single()
    if (!error) setOutfits(upsert(data as Outfit))
  }
  const del = async () => {
    if (!confirm('Delete this outfit?')) return
    const { error } = await supabase.from('outfits').delete().eq('id', outfit.id)
    if (error) return alert(error.message)
    setOutfits(without(outfit.id)); back('/outfits')
  }
  const wore = async () => {
    try { const w = await logWear(list.map(i => i.id), outfit.id); setWear(x => [w, ...x]) } catch (e) { alert((e as Error).message) }
  }
  // AI photo of a woman wearing these pieces
  const [drawing, setDrawing] = useState(false)
  const draw = async () => {
    setDrawing(true)
    try { const r = await renderLook({ item_ids: list.map(i => i.id), vibe: outfit.name ?? '' }); await patch({ image_path: r.path }) }
    catch (e) { alert((e as Error).message) }
    setDrawing(false)
  }

  return (
    <div className="screen">
      <Header title="" left={<button className="icon-btn" onClick={() => back('/outfits')} aria-label="Back"><Icon name="back" /></button>}
        right={<>
          <button className={'icon-btn' + (outfit.favorite ? ' fav' : '')} onClick={() => patch({ favorite: !outfit.favorite })} aria-label="Favorite"><Icon name="heart" filled={outfit.favorite} /></button>
          <button className="icon-btn" onClick={() => go(`/o/${outfit.id}/edit`)} aria-label="Edit"><Icon name="edit" /></button>
        </>} />
      <div className="detail">
        {outfit.image_path ? <LookPair image={outfit.image_path} items={list} /> : <Collage layout={outfit.layout} items={items} className="big" />}
        <div className="detail-info">
          {outfit.source === 'ai' && <p className="eyebrow">Stylist idea</p>}
          <h2 className="title">{outfit.name || 'Outfit'}</h2>
          {(outfit.occasions.length > 0 || outfit.seasons.length > 0) && (
            <p className="muted">{[...outfit.occasions.map(o => labelOf(OCCASIONS, o)), ...outfit.seasons.map(s => labelOf(SEASONS, s))].join(' · ')}</p>
          )}
          {outfit.notes && <div className="card notes">{outfit.notes}</div>}
          <button className="btn" onClick={draw} disabled={drawing || !list.length}>
            <Icon name="sparkle" /> {drawing ? 'Drawing, about a minute…' : outfit.image_path ? 'Draw again' : 'Show on me'}<span className="cost">≈7¢</span>
          </button>
          <button className="btn primary" onClick={wore} disabled={wornToday}>
            <Icon name="check" /> {wornToday ? 'Worn today' : 'I wore this today'}
          </button>
          {worn.length > 0 && <p className="muted small">Worn {worn.length}× · last {worn[0].worn_on}</p>}
          <div className="card">
            <h3 className="card-title">Pieces</h3>
            <div className="mini-list">
              {list.map(i => (
                <button key={i.id} className="mini" onClick={() => go(`/i/${i.id}`)}>
                  <Photo path={i.thumb_path ?? i.photo_path} alt="" /><span>{itemTitle(i)}</span>
                </button>
              ))}
            </div>
          </div>
          <button className="btn ghost danger" onClick={del}><Icon name="trash" /> Delete outfit</button>
        </div>
      </div>
    </div>
  )
}

// --- Outfit builder ---

export function OutfitEditor({ outfit, preset }: { outfit?: Outfit; preset?: string[] }) {
  const { items, setOutfits } = useStore()
  const [layout, setLayout] = useState<Placement[]>(() =>
    outfit?.layout ?? (preset ? autoLayout(preset.map(id => items.find(i => i.id === id)).filter((i): i is Item => !!i)) : []))
  const [name, setName] = useState(outfit?.name ?? '')
  const [occasions, setOccasions] = useState<string[]>(outfit?.occasions ?? [])
  const [seasons, setSeasons] = useState<string[]>(outfit?.seasons ?? [])
  const [sel, setSel] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const board = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; sx: number; sy: number; x: number; y: number } | null>(null)

  const upd = (id: string, p: Partial<Placement>) => setLayout(l => l.map(x => x.item_id === id ? { ...x, ...p } : x))
  const selected = layout.find(p => p.item_id === sel)
  const maxZ = Math.max(0, ...layout.map(p => p.z))

  const toggleItem = (it: Item) => {
    if (layout.some(p => p.item_id === it.id)) { setLayout(l => l.filter(p => p.item_id !== it.id)); return }
    const [p] = autoLayout([...layout.map(p => items.find(i => i.id === p.item_id)!).filter(Boolean), it]).slice(-1)
    setLayout(l => [...l, { ...p, z: maxZ + 1 }]); setSel(it.id)
  }

  const down = (e: React.PointerEvent, p: Placement) => {
    e.preventDefault(); (e.target as Element).setPointerCapture(e.pointerId)
    setSel(p.item_id); drag.current = { id: p.item_id, sx: e.clientX, sy: e.clientY, x: p.x, y: p.y }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current; const r = board.current?.getBoundingClientRect()
    if (!d || !r) return
    upd(d.id, { x: d.x + ((e.clientX - d.sx) / r.width) * 100, y: d.y + ((e.clientY - d.sy) / r.height) * 100 })
  }

  const byId = new Map(items.map(i => [i.id, i]))
  const save = async () => {
    if (!layout.length) return
    setBusy(true)
    const row = { name: name.trim() || null, layout, occasions, seasons }
    const q = outfit ? supabase.from('outfits').update(row).eq('id', outfit.id) : supabase.from('outfits').insert(row)
    const { data, error } = await q.select().single()
    if (error) { alert(error.message); setBusy(false); return }
    setOutfits(upsert(data as Outfit))
    if (outfit) back(`/o/${outfit.id}`); else location.replace(`#/o/${(data as Outfit).id}`)
  }

  return (
    <div className="screen">
      <Header title={outfit ? 'Edit outfit' : 'New outfit'}
        left={<button className="icon-btn" onClick={() => back(outfit ? `/o/${outfit.id}` : '/outfits')} aria-label="Back"><Icon name="back" /></button>} />
      <div className="editor">
        <div className="editor-board">
          <div className="collage big board" ref={board} onPointerMove={move} onPointerUp={() => { drag.current = null }}
            onPointerDown={e => { if (e.target === e.currentTarget) setSel(null) }}>
            {[...layout].sort((a, b) => a.z - b.z).map(p => <BoardItem key={p.item_id} p={p} item={byId.get(p.item_id)} on={sel === p.item_id} onDown={down} />)}
            {!layout.length && <span className="board-empty">Tap “Add pieces” to start</span>}
          </div>
          {selected ? (
            <div className="board-tools">
              <button className="icon-btn" onClick={() => upd(selected.item_id, { w: Math.max(10, selected.w - 6) })} aria-label="Smaller"><Icon name="minus" /></button>
              <button className="icon-btn" onClick={() => upd(selected.item_id, { w: Math.min(95, selected.w + 6) })} aria-label="Bigger"><Icon name="plus" /></button>
              <button className="btn sm" onClick={() => upd(selected.item_id, { z: maxZ + 1 })}><Icon name="layers" /> Front</button>
              <button className="btn sm danger" onClick={() => { setLayout(l => l.filter(p => p.item_id !== selected.item_id)); setSel(null) }}><Icon name="trash" /> Remove</button>
            </div>
          ) : <p className="hint">Drag pieces to arrange them. Tap one to resize or remove it.</p>}
        </div>
        <div className="form">
          <button className="btn wide" onClick={() => setPicker(true)}><Icon name="plus" /> Add pieces</button>
          <Section title="Name"><input placeholder="e.g. Friday office look" value={name} onChange={e => setName(e.target.value)} /></Section>
          <Section title="Occasion"><Chips options={OCCASIONS} value={occasions} onChange={setOccasions} /></Section>
          <Section title="Season"><Chips options={SEASONS} value={seasons} onChange={setSeasons} /></Section>
          <button className="btn primary wide" onClick={save} disabled={busy || !layout.length}>{busy ? 'Saving…' : 'Save outfit'}</button>
        </div>
      </div>
      {picker && <ItemPicker chosen={layout.map(p => p.item_id)} onToggle={toggleItem} onClose={() => setPicker(false)} />}
    </div>
  )
}

function BoardItem({ p, item, on, onDown }: { p: Placement; item?: Item; on: boolean; onDown: (e: React.PointerEvent, p: Placement) => void }) {
  if (!item) return null
  return (
    <div className={'board-item' + (on ? ' on' : '')} style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, zIndex: p.z }}
      onPointerDown={e => onDown(e, p)}>
      <Photo path={item.thumb_path ?? item.photo_path} alt="" className="bare" />
    </div>
  )
}

function ItemPicker({ chosen, onToggle, onClose }: { chosen: string[]; onToggle: (i: Item) => void; onClose: () => void }) {
  const { items } = useStore()
  const [cat, setCat] = useState('')
  const shown = items.filter(i => !cat || i.category === cat)
  return (
    <Sheet title="Add pieces" onClose={onClose}>
      <div className="cat-row">
        <button className={'cat' + (!cat ? ' on' : '')} onClick={() => setCat('')}>All</button>
        {CATEGORIES.filter(c => items.some(i => i.category === c.id)).map(c => (
          <button key={c.id} className={'cat' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>{c.label}</button>
        ))}
      </div>
      <div className="grid picker-grid">
        {shown.map(i => (
          <button key={i.id} className={'tile' + (chosen.includes(i.id) ? ' chosen' : '')} onClick={() => onToggle(i)}>
            <Photo path={i.thumb_path ?? i.photo_path} alt="" />
            {chosen.includes(i.id) && <span className="tick"><Icon name="check" /></span>}
            <span className="tile-name">{itemTitle(i)}</span>
          </button>
        ))}
      </div>
      <button className="btn primary wide" onClick={onClose}>Done</button>
    </Sheet>
  )
}
