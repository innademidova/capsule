import { useEffect, useMemo, useRef, useState } from 'react'
import {
  supabase, CATEGORIES, OCCASIONS, SEASONS, autoLayout, renderLook, itemTitle, labelOf, processPhoto, removePhotos, canPaste, pasteImage,
  type Item, type Outfit, type Placement,
} from './lib'
import { useStore, upsert, without } from './store'
import { Icon, Header, Collage, Chips, Section, Photo, AIActions, RequestState, Sheet } from './ui'
import { go, back } from './App'
import { t } from './i18n'

const outfitItems = (o: { layout: Placement[] }, items: Item[]) =>
  o.layout.map(p => items.find(i => i.id === p.item_id)).filter((i): i is Item => !!i)

// --- Outfit list ---

type Kind = 'all' | 'ai' | 'mine' | 'worn'

export function OutfitList() {
  const { outfits, items, wishlist } = useStore()
  const all = [...items, ...wishlist]
  const [fav, setFav] = useState(false)
  const [kind, setKind] = useState<Kind>(() => { try { return (sessionStorage.getItem('outfits-kind') as Kind) || 'all' } catch { return 'all' } })
  const [miss, setMiss] = useState(false)
  const pick = (k: Kind) => { setKind(k); try { sessionStorage.setItem('outfits-kind', k) } catch { /* private mode */ } }
  // Outfits that did not work live only under "On me" -> "Didn't work"
  const of = (k: Kind) => outfits.filter(o => k === 'worn' ? isWorn(o) : !o.miss && (k === 'all' || (k === 'ai' ? isAI(o) : !isAI(o) && !isWorn(o))))
  const shown = of(kind).filter(o => (!fav || o.favorite) && (kind !== 'worn' || o.miss === miss))
  const add = () => go(kind === 'worn' ? '/o/photo' : '/o/new')
  return (
    <div className="screen">
      <Header title={t('outfits.title')} right={
        <button className={'icon-btn' + (fav ? ' fav' : '')} onClick={() => setFav(f => !f)} aria-label={t('wardrobe.favorites')}><Icon name="heart" filled={fav} /></button>
      } />
      <button className="card stylist-cta" onClick={() => go('/stylist')}>
        <span className="cta-icon"><Icon name="sparkle" /></span>
        <span><b>{t('outfits.askStylist')}</b><span className="muted small">{t('outfits.askStylistHint')}</span></span>
      </button>
      <div className="seg outfit-filter" role="tablist">
        {(['all', 'ai', 'mine', 'worn'] as const).map(id => (
          <button key={id} role="tab" aria-selected={kind === id} className={kind === id ? 'on' : ''} onClick={() => pick(id)}>
            {t(`outfits.filter.${id}`)} <span className="muted">{of(id).length}</span>
          </button>
        ))}
      </div>
      {kind === 'worn' && of('worn').length > 0 && (
        <div className="switch worn-switch">
          <button className={miss ? '' : 'on'} onClick={() => setMiss(false)}>{t('outfits.good')} <span className="muted">{of('worn').filter(o => !o.miss).length}</span></button>
          <button className={miss ? 'on' : ''} onClick={() => setMiss(true)}>{t('outfits.miss')} <span className="muted">{of('worn').filter(o => o.miss).length}</span></button>
        </div>
      )}
      {kind === 'worn' && !of('worn').length ? (
        <div className="empty">
          <Icon name="camera" />
          <h2>{t('outfits.emptyWorn')}</h2>
          <p className="muted">{t('outfits.emptyWornHint')}</p>
          <button className="btn primary" onClick={add}><Icon name="plus" /> {t('outfits.addPhoto')}</button>
        </div>
      ) : outfits.length === 0 ? (
        <div className="empty">
          <Icon name="layers" />
          <h2>{t('outfits.empty')}</h2>
          <p className="muted">{t('outfits.emptyHint')}</p>
          <button className="btn primary" onClick={() => go('/o/new')} disabled={!items.length}><Icon name="plus" /> {t('outfits.new')}</button>
          <button className="btn" onClick={() => go('/o/photo')}><Icon name="camera" /> {t('outfits.addPhoto')}</button>
        </div>
      ) : !shown.length ? <p className="muted center pad">{t('common.nothingYet')}</p> : (
        <div className="grid outfits">
          {shown.map(o => (
            <button key={o.id} className="tile" onClick={() => go(`/o/${o.id}`)}>
              {o.image_path ? <Photo path={o.image_path} alt="" className="look-thumb" /> : <Collage layout={o.layout} items={all} />}
              {o.favorite && <span className="tile-fav"><Icon name="heart" filled /></span>}
              {o.miss && <span className="tile-miss"><Icon name="ban" /></span>}
              <span className="tile-name">{o.name || (isWorn(o) ? t('outfits.myOutfit') : t('outfits.outfit'))}</span>
            </button>
          ))}
        </div>
      )}
      {outfits.length > 0 && <button className="fab" onClick={add} aria-label={kind === 'worn' ? t('outfits.addPhoto') : t('outfits.new')}><Icon name={kind === 'worn' ? 'camera' : 'plus'} /></button>}
    </div>
  )
}

// Her own photo of what she wore
const isWorn = (o: Outfit) => o.source === 'worn'
// An outfit counts as AI generated when the AI drew it (photo of a woman) or the stylist suggested it
const isAI = (o: Outfit) => !isWorn(o) && (!!o.image_path || o.source === 'ai')

// Set by the editor's "Generate with AI": the outfit card starts drawing as soon as it opens
let drawOnOpen: string | null = null

// --- Outfit card ---

export function OutfitDetail({ outfit }: { outfit: Outfit }) {
  const { items, wishlist, setOutfits } = useStore()
  const all = [...items, ...wishlist]
  const list = outfitItems(outfit, all)

  const patch = async (p: Partial<Outfit>) => {
    const { data, error } = await supabase.from('outfits').update(p).eq('id', outfit.id).select().single()
    if (!error) setOutfits(upsert(data as Outfit))
  }
  const del = async () => {
    if (!confirm(t('outfits.confirmDelete'))) return
    const { error } = await supabase.from('outfits').delete().eq('id', outfit.id)
    if (error) return alert(error.message)
    if (worn) await removePhotos(outfit.image_path)
    setOutfits(without(outfit.id)); back('/outfits')
  }
  const worn = isWorn(outfit)
  const title = outfit.name || (worn ? t('outfits.myOutfit') : t('outfits.outfit'))
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
      <Header title="" left={<button className="icon-btn" onClick={() => back('/outfits')} aria-label={t('common.back')}><Icon name="back" /></button>}
        right={<>
          <button className={'icon-btn' + (outfit.favorite ? ' fav' : '')} onClick={() => patch({ favorite: !outfit.favorite })} aria-label={t('common.favorite')}><Icon name="heart" filled={outfit.favorite} /></button>
          <button className="icon-btn" onClick={() => go(`/o/${outfit.id}/edit`)} aria-label={t('common.edit')}><Icon name="edit" /></button>
        </>} />
      <div className="detail">
        {outfit.image_path ? <Photo path={outfit.image_path} alt={title} className="look-post" zoom /> : <Collage layout={outfit.layout} items={all} className="big" />}
        <div className="detail-info">
          {outfit.source === 'ai' && <p className="eyebrow">{t('outfits.stylistIdea')}</p>}
          {worn && <p className="eyebrow">{[outfit.miss ? t('outfits.miss') : t('outfits.filter.worn'), outfit.worn_on && new Date(outfit.worn_on).toLocaleDateString()].filter(Boolean).join(' · ')}</p>}
          <h2 className="title">{title}</h2>
          {(outfit.occasions.length > 0 || outfit.seasons.length > 0) && (
            <p className="muted">{[...outfit.occasions.map(o => labelOf(OCCASIONS, o)), ...outfit.seasons.map(s => labelOf(SEASONS, s))].join(' · ')}</p>
          )}
          {outfit.notes && (outfit.miss
            ? <div className="card notes miss-notes"><h3 className="card-title"><Icon name="ban" /> {t('outfits.missTitle')}</h3>{outfit.notes}</div>
            : <div className="card notes">{outfit.notes}</div>)}
          {worn ? (
            <button className="btn" onClick={() => patch({ miss: !outfit.miss })}>
              <Icon name={outfit.miss ? 'check' : 'ban'} /> {outfit.miss ? t('outfits.markGood') : t('outfits.markMiss')}
            </button>
          ) : (
            <button className="btn" onClick={draw} disabled={drawing || !list.length}>
              <Icon name="sparkle" /> {drawing ? t('outfits.drawing') : outfit.image_path ? t('outfits.drawAgain') : t('outfits.showOnMe')}<span className="cost">(OpenAI ≈9¢)</span>
            </button>
          )}
          {(list.length > 0 || !worn) && <div className="card">
            <h3 className="card-title">{t('outfits.pieces')}</h3>
            <div className="mini-list">
              {list.map(i => (
                <button key={i.id} className="mini" onClick={() => go(`/i/${i.id}`)}>
                  <Photo path={i.thumb_path ?? i.photo_path} alt="" /><span>{itemTitle(i)}</span>
                  {i.wishlist && <span className="mini-wish">{t('wardrobe.wishlist')}</span>}
                </button>
              ))}
            </div>
          </div>}
          <button className="btn ghost danger" onClick={del}><Icon name="trash" /> {t('outfits.delete')}</button>
        </div>
      </div>
    </div>
  )
}

// --- Outfit builder ---

export function OutfitEditor({ outfit, preset }: { outfit?: Outfit; preset?: string[] }) {
  const { items: own, wishlist, setOutfits } = useStore()
  // Outfits she puts together herself may use wishlist pieces too (the AI stylist still sees only the wardrobe)
  const items = useMemo(() => [...own, ...wishlist], [own, wishlist])
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
      <Header title={outfit ? t('outfits.edit') : t('outfits.new')}
        left={<button className="icon-btn" onClick={() => back(outfit ? `/o/${outfit.id}` : '/outfits')} aria-label={t('common.back')}><Icon name="back" /></button>} />
      <div className="editor">
        <div className="editor-board">
          <div className="collage big board" ref={board} onPointerMove={move} onPointerUp={() => { drag.current = null }}
            onPointerDown={e => { if (e.target === e.currentTarget) setSel(null) }}>
            {[...layout].sort((a, b) => a.z - b.z).map(p => <BoardItem key={p.item_id} p={p} item={byId.get(p.item_id)} on={sel === p.item_id} onDown={down} />)}
            {!layout.length && <span className="board-empty">{t('outfits.boardEmpty')}</span>}
          </div>
          {selected ? (
            <div className="board-tools">
              <button className="btn sm" onClick={() => upd(selected.item_id, { z: maxZ + 1 })}><Icon name="layers" /> {t('outfits.front')}</button>
              <button className="btn sm danger" onClick={() => { setLayout(l => l.filter(p => p.item_id !== selected.item_id)); setSel(null) }}><Icon name="trash" /> {t('common.remove')}</button>
            </div>
          ) : <p className="hint">{t('outfits.boardHint')}</p>}
        </div>
        <div className="form">
          <button className="btn wide" onClick={() => setPicker(true)}><Icon name="plus" /> {t('outfits.addPieces')}</button>
          <Section title={t('field.name')}><input placeholder={t('outfits.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} /></Section>
          <Section title={t('field.occasion')}><Chips options={OCCASIONS} value={occasions} onChange={setOccasions} /></Section>
          <Section title={t('field.season')}><Chips options={SEASONS} value={seasons} onChange={setSeasons} /></Section>
          <div className="save-row">
            <button className="btn wide" onClick={() => save()} disabled={busy || !layout.length}><Icon name="check" /> {busy ? t('common.saving') : t('outfits.save')}</button>
            <button className="btn primary wide" onClick={() => save(true)} disabled={busy || !layout.length}>
              <Icon name="sparkle" /> {t('outfits.generate')}<span className="cost">(OpenAI ≈9¢)</span>
            </button>
          </div>
          <p className="hint">{t('outfits.saveHint')}</p>
        </div>
      </div>
      {picker && <ItemPicker chosen={layout.map(p => p.item_id)} onToggle={toggleItem} onClose={() => setPicker(false)} />}
    </div>
  )
}

// --- Her own outfit photo: what she wore, which pieces, whether it worked and why not ---

export function WornForm({ outfit }: { outfit?: Outfit }) {
  const { items, wishlist, setOutfits } = useStore()
  const all = useMemo(() => [...items, ...wishlist], [items, wishlist])
  const [file, setFile] = useState<{ blob: Blob; url: string } | null>(null)
  const [name, setName] = useState(outfit?.name ?? '')
  const [wornOn, setWornOn] = useState(outfit?.worn_on ?? '')
  const [occasions, setOccasions] = useState<string[]>(outfit?.occasions ?? [])
  const [seasons, setSeasons] = useState<string[]>(outfit?.seasons ?? [])
  const [ids, setIds] = useState<string[]>(outfit?.layout.map(p => p.item_id) ?? [])
  const [miss, setMiss] = useState(outfit?.miss ?? false)
  const [notes, setNotes] = useState(outfit?.notes ?? '')
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url) }, [file])
  const take = (blob?: Blob | null) => blob && setFile({ blob, url: URL.createObjectURL(blob) })
  const paste = async () => { try { take(await pasteImage()) } catch (e) { alert((e as Error).message) } }
  const chosen = ids.map(id => all.find(i => i.id === id)).filter((i): i is Item => !!i)

  const save = async () => {
    if (!file && !outfit?.image_path) return alert(t('outfits.needPhoto'))
    setBusy(true)
    try {
      let image_path = outfit?.image_path ?? null
      if (file) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error(t('error.signIn'))
        const p = await processPhoto(file.blob)
        const path = `${user.id}/worn/${crypto.randomUUID()}.${p.full.type.split('/')[1] || 'webp'}`
        const { error } = await supabase.storage.from('photos').upload(path, p.full, { contentType: p.full.type })
        if (error) throw error
        image_path = path
      }
      const row = { name: name.trim() || null, image_path, layout: autoLayout(chosen), occasions, seasons,
        notes: notes.trim() || null, source: 'worn', miss, worn_on: wornOn || null }
      const q = outfit ? supabase.from('outfits').update(row).eq('id', outfit.id) : supabase.from('outfits').insert(row)
      const { data, error } = await q.select().single()
      if (error) throw error
      if (file && outfit?.image_path) await removePhotos(outfit.image_path)
      setOutfits(upsert(data as Outfit))
      if (outfit) back(`/o/${outfit.id}`); else location.replace(`#/o/${(data as Outfit).id}`)
    } catch (e) { alert((e as Error).message); setBusy(false) }
  }

  return (
    <div className="screen">
      <Header title={outfit ? t('outfits.editPhoto') : t('outfits.addPhoto')}
        left={<button className="icon-btn" onClick={() => back(outfit ? `/o/${outfit.id}` : '/outfits')} aria-label={t('common.back')}><Icon name="back" /></button>} />
      <div className="editor">
        <div className="editor-board">
          {file ? <img className="worn-preview" src={file.url} alt="" />
            : outfit?.image_path ? <Photo path={outfit.image_path} alt="" className="look-post" />
            : <button className="worn-drop" onClick={() => fileRef.current?.click()}><Icon name="camera" /><span>{t('outfits.choosePhoto')}</span></button>}
          <div className="board-tools">
            <button className="btn sm" onClick={() => fileRef.current?.click()}><Icon name="image" /> {file || outfit?.image_path ? t('outfits.otherPhoto') : t('outfits.choosePhoto')}</button>
            {canPaste() && <button className="btn sm" onClick={paste}><Icon name="paste" /> {t('outfits.pastePhoto')}</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { take(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <div className="form">
          <Section title={t('field.name')}><input placeholder={t('outfits.photoNamePlaceholder')} value={name} onChange={e => setName(e.target.value)} /></Section>
          <Section title={t('outfits.wornOn')}><input type="date" value={wornOn} onChange={e => setWornOn(e.target.value)} /></Section>
          <Section title={t('outfits.wornPieces')}>
            {chosen.length > 0 && (
              <div className="mini-list">
                {chosen.map(i => <span key={i.id} className="mini"><Photo path={i.thumb_path ?? i.photo_path} alt="" /><span>{itemTitle(i)}</span></span>)}
              </div>
            )}
            <button className="btn wide" onClick={() => setPicker(true)}><Icon name="plus" /> {t('outfits.addPieces')}</button>
            <p className="hint">{t('outfits.wornPiecesHint')}</p>
          </Section>
          <Section title={t('field.occasion')}><Chips options={OCCASIONS} value={occasions} onChange={setOccasions} /></Section>
          <Section title={t('field.season')}><Chips options={SEASONS} value={seasons} onChange={setSeasons} /></Section>
          <div className="switch worn-verdict">
            <button className={miss ? '' : 'on'} onClick={() => setMiss(false)}><Icon name="check" /> {t('outfits.good')}</button>
            <button className={miss ? 'on' : ''} onClick={() => setMiss(true)}><Icon name="ban" /> {t('outfits.miss')}</button>
          </div>
          <Section title={miss ? t('outfits.missTitle') : t('field.notes')}>
            <textarea rows={miss ? 5 : 3} placeholder={miss ? t('outfits.missPlaceholder') : t('outfits.notesPlaceholder')} value={notes} onChange={e => setNotes(e.target.value)} />
          </Section>
          <button className="btn primary wide" onClick={save} disabled={busy || (!file && !outfit?.image_path)}>
            <Icon name="check" /> {busy ? t('common.saving') : t('outfits.savePhoto')}
          </button>
        </div>
      </div>
      {picker && <ItemPicker chosen={ids} onToggle={i => setIds(x => x.includes(i.id) ? x.filter(y => y !== i.id) : [...x, i.id])} onClose={() => setPicker(false)} />}
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
        <span key={c} className={`handle ${c}`} onPointerDown={e => onDown(e, p, c)} aria-label={t('outfits.resize')}>
          <svg viewBox="0 0 12 12"><path d="M3 9 9 3M3 9V5.5M3 9h3.5M9 3H5.5M9 3v3.5" /></svg>
        </span>
      ))}
    </div>
  )
}

function ItemPicker({ chosen, onToggle, onClose }: { chosen: string[]; onToggle: (i: Item) => void; onClose: () => void }) {
  const { items: own, wishlist } = useStore()
  const [wish, setWish] = useState(false)
  const [cat, setCat] = useState('')
  const items = wish ? wishlist : own
  const shown = items.filter(i => !cat || i.category === cat)
  // A new source or category starts from the top of the list
  const toTop = () => document.querySelector('.sheet-body')?.scrollTo(0, 0)
  const pick = (w: boolean) => { setWish(w); setCat(''); toTop() }
  const pickCat = (c: string) => { setCat(c); toTop() }
  return (
    <Sheet title={t('outfits.addPieces')} onClose={onClose} sticky
      top={<>
        {wishlist.length > 0 && (
          <div className="seg picker-source" role="tablist">
            <button role="tab" aria-selected={!wish} className={wish ? '' : 'on'} onClick={() => pick(false)}>
              {t('wardrobe.title')}<span className="seg-count">{own.length}</span>
            </button>
            <button role="tab" aria-selected={wish} className={wish ? 'on' : ''} onClick={() => pick(true)}>
              {t('wardrobe.wishlist')}<span className="seg-count">{wishlist.length}</span>
            </button>
          </div>
        )}
        <div className="cat-row">
          <button className={'cat' + (!cat ? ' on' : '')} onClick={() => pickCat('')}>{t('common.all')}</button>
          {CATEGORIES.filter(c => items.some(i => i.category === c.id)).map(c => (
            <button key={c.id} className={'cat' + (cat === c.id ? ' on' : '')} onClick={() => pickCat(c.id)}>{c.label}</button>
          ))}
        </div>
      </>}
      foot={<button className="btn primary wide" onClick={onClose}>{t('common.done')}</button>}>
      <div className="grid picker-grid">
        {shown.map(i => (
          <button key={i.id} className={'tile' + (chosen.includes(i.id) ? ' chosen' : '')} onClick={() => onToggle(i)}>
            <Photo path={i.thumb_path ?? i.photo_path} alt="" />
            {chosen.includes(i.id) && <span className="tick"><Icon name="check" /></span>}
            <span className="tile-name">{itemTitle(i)}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
