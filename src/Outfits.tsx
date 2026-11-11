import { useEffect, useMemo, useRef, useState } from 'react'
import {
  supabase, CATEGORIES, OCCASIONS, SEASONS, autoLayout, renderLook, itemTitle, labelOf,
  type Item, type Outfit, type Placement,
} from './lib'
import { useStore, upsert, without } from './store'
import { Icon, Header, Collage, Chips, Section, Photo, AIActions, RequestState, Sheet } from './ui'
import { go, back } from './App'

const outfitItems = (o: { layout: Placement[] }, items: Item[]) =>
  o.layout.map(p => items.find(i => i.id === p.item_id)).filter((i): i is Item => !!i)

// --- Outfit list ---

export function OutfitList() {
  const { outfits, items } = useStore()
  const [fav, setFav] = useState(false)
  const [kind, setKind] = useState<'all' | 'ai' | 'mine'>('all')
  const shown = outfits.filter(o => (!fav || o.favorite) && (kind === 'all' || (kind === 'ai') === isAI(o)))
  return (
    <div className="screen">
      <Header title="Outfits" right={
        <button className={'icon-btn' + (fav ? ' fav' : '')} onClick={() => setFav(f => !f)} aria-label="Favorites"><Icon name="heart" filled={fav} /></button>
      } />
      <button className="card stylist-cta" onClick={() => go('/stylist')}>
        <span className="cta-icon"><Icon name="sparkle" /></span>
        <span><b>Ask your stylist</b><span className="muted small">Describe what you need: looks from your own clothes, with a photo on you</span></span>
      </button>
      {outfits.length > 0 && (
        <div className="seg outfit-filter" role="tablist">
          {([['all', 'All'], ['ai', 'AI generated'], ['mine', 'Made by me']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={kind === id} className={kind === id ? 'on' : ''} onClick={() => setKind(id)}>
              {label} <span className="muted">{outfits.filter(o => id === 'all' || (id === 'ai') === isAI(o)).length}</span>
            </button>
          ))}
        </div>
      )}
      {outfits.length > 0 && !shown.length && <p className="muted center pad">Nothing here yet.</p>}
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

// An outfit counts as AI generated when the AI drew it (photo of a woman) or the stylist suggested it
const isAI = (o: Outfit) => !!o.image_path || o.source === 'ai'

// Set by the editor's "Generate with AI": the outfit card starts drawing as soon as it opens
let drawOnOpen: string | null = null

// --- Outfit card ---

export function OutfitDetail({ outfit }: { outfit: Outfit }) {
  const { items, setOutfits } = useStore()
  const list = outfitItems(outfit, items)

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
  // AI photo of a woman wearing these pieces
  const [drawing, setDrawing] = useState(false)
  const draw = async () => {
    setDrawing(true)
    try { const r = await renderLook({ item_ids: list.map(i => i.id), vibe: outfit.name ?? '' }); await patch({ image_path: r.path }) }
    catch (e) { alert((e as Error).message) }
    setDrawing(false)
  }
  useEffect(() => {
    if (drawOnOpen === outfit.id) { drawOnOpen = null; draw() }
  }, [outfit.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="screen">
      <Header title="" left={<button className="icon-btn" onClick={() => back('/outfits')} aria-label="Back"><Icon name="back" /></button>}
        right={<>
          <button className={'icon-btn' + (outfit.favorite ? ' fav' : '')} onClick={() => patch({ favorite: !outfit.favorite })} aria-label="Favorite"><Icon name="heart" filled={outfit.favorite} /></button>
          <button className="icon-btn" onClick={() => go(`/o/${outfit.id}/edit`)} aria-label="Edit"><Icon name="edit" /></button>
        </>} />
      <div className="detail">
        {outfit.image_path ? <Photo path={outfit.image_path} alt="" className="look-post" /> : <Collage layout={outfit.layout} items={items} className="big" />}
        <div className="detail-info">
          {outfit.source === 'ai' && <p className="eyebrow">Stylist idea</p>}
          <h2 className="title">{outfit.name || 'Outfit'}</h2>
          {(outfit.occasions.length > 0 || outfit.seasons.length > 0) && (
            <p className="muted">{[...outfit.occasions.map(o => labelOf(OCCASIONS, o)), ...outfit.seasons.map(s => labelOf(SEASONS, s))].join(' · ')}</p>
          )}
          {outfit.notes && <div className="card notes">{outfit.notes}</div>}
          <button className="btn" onClick={draw} disabled={drawing || !list.length}>
            <Icon name="sparkle" /> {drawing ? 'Drawing, about a minute…' : outfit.image_path ? 'Draw again' : 'Show on me'}<span className="cost">(OpenAI ≈9¢)</span>
          </button>
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
  // Moving a piece, or resizing it by a corner handle (the opposite corner stays in place)
  const drag = useRef<{ id: string; sx: number; sy: number; x: number; y: number; w: number; h: number; corner?: Corner } | null>(null)

  const upd = (id: string, p: Partial<Placement>) => setLayout(l => l.map(x => x.item_id === id ? { ...x, ...p } : x))
  const selected = layout.find(p => p.item_id === sel)
  const maxZ = Math.max(0, ...layout.map(p => p.z))

  const toggleItem = (it: Item) => {
    if (layout.some(p => p.item_id === it.id)) { setLayout(l => l.filter(p => p.item_id !== it.id)); return }
    const [p] = autoLayout([...layout.map(p => items.find(i => i.id === p.item_id)!).filter(Boolean), it]).slice(-1)
    setLayout(l => [...l, { ...p, z: maxZ + 1 }]); setSel(it.id)
  }

  const down = (e: React.PointerEvent, p: Placement, corner?: Corner) => {
    e.preventDefault(); e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId)
    const r = board.current?.getBoundingClientRect()
    const box = (e.currentTarget as Element).closest('.board-item')?.getBoundingClientRect()
    const h = r && box ? (box.height / r.height) * 100 : p.w
    setSel(p.item_id); drag.current = { id: p.item_id, sx: e.clientX, sy: e.clientY, x: p.x, y: p.y, w: p.w, h, corner }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current; const r = board.current?.getBoundingClientRect()
    if (!d || !r) return
    const dx = ((e.clientX - d.sx) / r.width) * 100, dy = ((e.clientY - d.sy) / r.height) * 100
    if (!d.corner) return upd(d.id, { x: d.x + dx, y: d.y + dy })
    // Follow the larger of the two movements, scaled to keep the proportions
    const sx = d.corner.includes('e') ? 1 : -1, sy = d.corner.includes('s') ? 1 : -1
    const grow = Math.abs(dx) * d.h > Math.abs(dy) * d.w ? sx * dx : (sy * dy * d.w) / d.h
    const w = Math.min(100, Math.max(8, d.w + grow)), h = (d.h * w) / d.w
    upd(d.id, { w, x: d.corner.includes('w') ? d.x + d.w - w : d.x, y: d.corner.includes('n') ? d.y + d.h - h : d.y })
  }

  const byId = new Map(items.map(i => [i.id, i]))
  // Save as is (the collage), or save and let the AI draw a woman wearing it in the reference format
  const save = async (withAI = false) => {
    if (!layout.length) return
    setBusy(true)
    const row = { name: name.trim() || null, layout, occasions, seasons }
    const q = outfit ? supabase.from('outfits').update(row).eq('id', outfit.id) : supabase.from('outfits').insert(row)
    const { data, error } = await q.select().single()
    if (error) { alert(error.message); setBusy(false); return }
    setOutfits(upsert(data as Outfit))
    if (withAI) drawOnOpen = (data as Outfit).id
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
              <button className="btn sm" onClick={() => upd(selected.item_id, { z: maxZ + 1 })}><Icon name="layers" /> Front</button>
              <button className="btn sm danger" onClick={() => { setLayout(l => l.filter(p => p.item_id !== selected.item_id)); setSel(null) }}><Icon name="trash" /> Remove</button>
            </div>
          ) : <p className="hint">Drag pieces to arrange them. Tap one, then pull a corner to resize it.</p>}
        </div>
        <div className="form">
          <button className="btn wide" onClick={() => setPicker(true)}><Icon name="plus" /> Add pieces</button>
          <Section title="Name"><input placeholder="e.g. Friday office look" value={name} onChange={e => setName(e.target.value)} /></Section>
          <Section title="Occasion"><Chips options={OCCASIONS} value={occasions} onChange={setOccasions} /></Section>
          <Section title="Season"><Chips options={SEASONS} value={seasons} onChange={setSeasons} /></Section>
          <div className="save-row">
            <button className="btn wide" onClick={() => save()} disabled={busy || !layout.length}><Icon name="check" /> {busy ? 'Saving…' : 'Save outfit'}</button>
            <button className="btn primary wide" onClick={() => save(true)} disabled={busy || !layout.length}>
              <Icon name="sparkle" /> Generate with AI<span className="cost">(OpenAI ≈9¢)</span>
            </button>
          </div>
          <p className="hint">“Save outfit” keeps this collage. “Generate with AI” saves it and draws you wearing it, in the look format.</p>
        </div>
      </div>
      {picker && <ItemPicker chosen={layout.map(p => p.item_id)} onToggle={toggleItem} onClose={() => setPicker(false)} />}
    </div>
  )
}

type Corner = 'nw' | 'ne' | 'sw' | 'se'

function BoardItem({ p, item, on, onDown }: { p: Placement; item?: Item; on: boolean; onDown: (e: React.PointerEvent, p: Placement, corner?: Corner) => void }) {
  if (!item) return null
  return (
    <div className={'board-item' + (on ? ' on' : '')} style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, zIndex: p.z }}
      onPointerDown={e => onDown(e, p)}>
      <Photo path={item.thumb_path ?? item.photo_path} alt="" className="bare" />
      {on && (['nw', 'ne', 'sw', 'se'] as Corner[]).map(c => (
        <span key={c} className={`handle ${c}`} onPointerDown={e => onDown(e, p, c)} aria-label="Resize">
          <svg viewBox="0 0 12 12"><path d="M3 9 9 3M3 9V5.5M3 9h3.5M9 3H5.5M9 3v3.5" /></svg>
        </span>
      ))}
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
