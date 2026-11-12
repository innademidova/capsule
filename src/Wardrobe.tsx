import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  supabase, CATEGORIES, COLORS, SEASONS, STYLES, OCCASIONS, KINDS, categoryLabel, labelOf, itemTitle,
  processPhoto, uploadPhoto, removePhotos, canPaste, pasteImage, askAI, whiteToAlpha, generateGarment, splitSet, cents, compositionText, BRANDS, MATERIALS, type Material, type Item, type Processed, type AIRequest,
} from './lib'
import { Chips, Icon, Photo, Header, Section, Swatch, Collage } from './ui'
import { go, back } from './App'
import { useStore, upsert } from './store'

// --- List ---

export type Filters = {
  category: string; q: string; colors: string[]; seasons: string[]; styles: string[]; occasions: string[]; fav: boolean
}
export const emptyFilters: Filters = { category: '', q: '', colors: [], seasons: [], styles: [], occasions: [], fav: false }

const anyOf = (want: string[], have: string[]) => !want.length || want.some(w => have.includes(w))

export function WardrobeList({ items, filters, setFilters, wish }: {
  items: Item[]; filters: Filters; setFilters: (f: Filters) => void; wish?: boolean
}) {
  const [open, setOpen] = useState(false)
  const f = filters
  const set = (patch: Partial<Filters>) => setFilters({ ...f, ...patch })
  const extra = f.colors.length + f.seasons.length + f.styles.length + f.occasions.length + (f.fav ? 1 : 0)

  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return items.filter(i =>
      (!f.category || i.category === f.category) && (!f.fav || i.favorite) &&
      anyOf(f.colors, i.colors) && anyOf(f.seasons, i.seasons) && anyOf(f.styles, i.styles) && anyOf(f.occasions, i.occasions) &&
      (!q || [i.name, i.kind, i.brand, i.notes].some(s => s?.toLowerCase().includes(q))))
  }, [items, f])

  const count = (cat: string) => items.filter(i => i.category === cat).length
  const newPath = wish ? '/i/new/wish' : '/i/new'

  return (
    <div className="screen">
      <Header title={wish ? 'Wishlist' : 'Wardrobe'} right={
        <button className="icon-btn" onClick={() => setOpen(o => !o)} aria-label="Filters">
          <Icon name="filter" />{extra > 0 && <span className="dot">{extra}</span>}
        </button>
      } />

      <div className="switch">
        <button className={wish ? '' : 'on'} onClick={() => wish && location.replace('#/')}>Wardrobe</button>
        <button className={wish ? 'on' : ''} onClick={() => !wish && location.replace('#/wish')}>Wishlist</button>
      </div>

      <div className="search">
        <Icon name="search" />
        <input placeholder="Search" value={f.q} onChange={e => set({ q: e.target.value })} />
        {f.q && <button className="icon-btn sm" onClick={() => set({ q: '' })} aria-label="Clear"><Icon name="x" /></button>}
      </div>

      <div className="cat-row">
        <button className={'cat' + (!f.category ? ' on' : '')} onClick={() => set({ category: '' })}>
          All <span>{items.length}</span>
        </button>
        {CATEGORIES.map(c => (
          <button key={c.id} className={'cat' + (f.category === c.id ? ' on' : '')} onClick={() => set({ category: f.category === c.id ? '' : c.id })}>
            {c.label} <span>{count(c.id)}</span>
          </button>
        ))}
      </div>

      {open && (
        <div className="card filters">
          <Section title="Color"><Chips options={COLORS} value={f.colors} onChange={colors => set({ colors })} swatches /></Section>
          <Section title="Season"><Chips options={SEASONS} value={f.seasons} onChange={seasons => set({ seasons })} /></Section>
          <Section title="Style"><Chips options={STYLES} value={f.styles} onChange={styles => set({ styles })} /></Section>
          <Section title="Occasion"><Chips options={OCCASIONS} value={f.occasions} onChange={occasions => set({ occasions })} /></Section>
          <div className="row">
            <button className={'chip' + (f.fav ? ' on' : '')} onClick={() => set({ fav: !f.fav })}><Icon name="heart" filled={f.fav} /> Favorites</button>
            <span className="grow" />
            {extra > 0 && <button className="btn ghost sm" onClick={() => set({ colors: [], seasons: [], styles: [], occasions: [], fav: false })}>Reset</button>}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          <Icon name="hanger" />
          <h2>{wish ? 'Your wishlist is empty' : 'Your wardrobe is empty'}</h2>
          <p className="muted">{wish ? 'Add pieces you dream of. They stay separate from your wardrobe until you buy them.' : 'Add your first piece: a photo of the item, ideally cut out from the background.'}</p>
          <button className="btn primary" onClick={() => go(newPath)}><Icon name="plus" /> Add item</button>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted center pad">Nothing matches these filters.</p>
      ) : (
        <div className="grid">
          {shown.map(i => (
            <button key={i.id} className="tile" onClick={() => go(`/i/${i.id}`)}>
              <Photo path={i.thumb_path ?? i.photo_path} alt={itemTitle(i)} />
              {i.favorite && <span className="tile-fav"><Icon name="heart" filled /></span>}
              <span className="tile-name">{itemTitle(i)}</span>
              <span className="tile-colors">{i.colors.slice(0, 4).map(c => <Swatch key={c} id={c} size={10} />)}</span>
            </button>
          ))}
        </div>
      )}

      <button className="fab" onClick={() => go(newPath)} aria-label="Add item"><Icon name="plus" /></button>
    </div>
  )
}

// --- Item card ---

export function ItemDetail({ item, onChange, onDelete }: { item: Item; onChange: (i: Item) => void; onDelete: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  const { outfits, items } = useStore()
  const home = item.wishlist ? '/wish' : '/'
  const inOutfits = outfits.filter(o => o.layout.some(p => p.item_id === item.id))
  const mates = item.set_id ? items.filter(i => i.set_id === item.set_id && i.id !== item.id) : []

  const toggleFav = async () => {
    const { data, error } = await supabase.from('items').update({ favorite: !item.favorite }).eq('id', item.id).select().single()
    if (!error) onChange(data as Item)
  }
  // Bought a wishlist item: it moves to the wardrobe
  const bought = async () => {
    setBusy(true)
    const { data, error } = await supabase.from('items').update({ wishlist: false }).eq('id', item.id).select().single()
    if (error) alert(error.message); else onChange(data as Item)
    setBusy(false)
  }
  const del = async () => {
    if (!confirm(`Delete “${itemTitle(item)}”?`)) return
    setBusy(true)
    const { error } = await supabase.from('items').delete().eq('id', item.id)
    if (error) { alert(error.message); setBusy(false); return }
    await removePhotos(item.photo_path, item.thumb_path)
    onDelete(item.id)
    back(home)
  }

  const tags = (title: string, ids: string[], list: { id: string; label: string }[]) =>
    ids.length > 0 && (
      <div className="kv"><span className="muted">{title}</span><span>{ids.map(id => labelOf(list, id)).join(', ')}</span></div>
    )

  return (
    <div className="screen">
      <Header title="" left={<button className="icon-btn" onClick={() => back(home)} aria-label="Back"><Icon name="back" /></button>}
        right={<>
          <button className={'icon-btn' + (item.favorite ? ' fav' : '')} onClick={toggleFav} aria-label="Favorite"><Icon name="heart" filled={item.favorite} /></button>
          <button className="icon-btn" onClick={() => go(`/i/${item.id}/edit`)} aria-label="Edit"><Icon name="edit" /></button>
        </>} />
      <div className="detail">
        <Photo path={item.photo_path} alt={itemTitle(item)} className="big" />
        <div className="detail-info">
          <p className="eyebrow">{categoryLabel(item.category)}{item.kind && item.name ? ` · ${item.kind}` : ''}</p>
          <h2 className="title">{itemTitle(item)}</h2>
          {item.brand && <p className="muted">{item.brand}</p>}
          {item.materials?.length > 0 && <p className="muted small">{compositionText(item.materials)}</p>}
          {item.colors.length > 0 && (
            <div className="color-list">
              {item.colors.map(c => <span key={c} className="color-tag"><Swatch id={c} size={14} />{labelOf(COLORS, c)}</span>)}
            </div>
          )}
          <div className="card kvs">
            {tags('Season', item.seasons, SEASONS)}
            {tags('Style', item.styles, STYLES)}
            {tags('Occasion', item.occasions, OCCASIONS)}
            {!item.seasons.length && !item.styles.length && !item.occasions.length && <p className="muted small">No tags yet</p>}
          </div>
          {item.notes && <div className="card notes">{item.notes}</div>}
          {item.link && (
            <a className="btn" href={item.link} target="_blank" rel="noopener noreferrer"><Icon name="link" /> Open in shop<span className="cost">{hostOf(item.link)}</span></a>
          )}
          <button className="btn wide ai-fill" onClick={() => go(`/style/${item.id}`)}><Icon name="sparkle" /> Style it: looks with this piece</button>
          {item.wishlist ? (
            <button className="btn primary" onClick={bought} disabled={busy}><Icon name="check" /> I bought it</button>
          ) : <>
            <div className="row wrap">
              <button className="btn primary" onClick={() => go(`/o/new/${item.id}`)}><Icon name="layers" /> Build outfit</button>
            </div>
          </>}
          {mates.length > 0 && (
            <div className="card">
              <h3 className="card-title">Part of a set</h3>
              <div className="set-mates">
                {mates.map(m => <button key={m.id} onClick={() => go(`/i/${m.id}`)}><Photo path={m.thumb_path ?? m.photo_path} alt={itemTitle(m)} /><span>{itemTitle(m)}</span></button>)}
              </div>
              {!item.wishlist && <button className="btn" onClick={() => go(`/o/new/${[item.id, ...mates.map(m => m.id)].join(',')}`)}><Icon name="layers" /> Outfit with the whole set</button>}
            </div>
          )}
          {inOutfits.length > 0 && (
            <div className="card">
              <h3 className="card-title">In {inOutfits.length} outfit{inOutfits.length > 1 ? 's' : ''}</h3>
              <div className="mini-outfits">
                {inOutfits.map(o => <button key={o.id} onClick={() => go(`/o/${o.id}`)}><Collage layout={o.layout} items={items} /></button>)}
              </div>
            </div>
          )}
          <button className="btn ghost danger" onClick={del} disabled={busy}><Icon name="trash" /> Delete item</button>
        </div>
      </div>
    </div>
  )
}

// --- Add / edit ---

type Draft = Omit<Item, 'id' | 'created_at' | 'updated_at' | 'favorite' | 'wishlist' | 'photo_path' | 'thumb_path' | 'set_id'>
// One piece cut out of an AI image of a set; tags come from AI per piece
type Part = { path: string; url: string; blob: Blob; tags: Draft | null }

const toDraft = (i?: Item): Draft => ({
  name: i?.name ?? '', category: i?.category ?? '', kind: i?.kind ?? '', colors: i?.colors ?? [], seasons: i?.seasons ?? [],
  styles: i?.styles ?? [], occasions: i?.occasions ?? [], brand: i?.brand ?? '', notes: i?.notes ?? '', link: i?.link ?? '', materials: i?.materials ?? [],
})

// "zara.com/..." -> "https://zara.com/..."; empty -> null
const normLink = (v?: string | null) => { const t = v?.trim(); return !t ? null : /^https?:\/\//i.test(t) ? t : `https://${t}` }
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }

// Composition editor: rows of material + optional percent, like a care label
function MaterialsInput({ value, names, onChange }: { value: Material[]; names: string[]; onChange: (m: Material[]) => void }) {
  const rows = value.length ? value : [{ name: '', pct: null }]
  const put = (i: number, patch: Partial<Material>) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  const total = rows.reduce((s, r) => s + (r.pct ?? 0), 0)
  const withPct = rows.filter(r => r.name.trim() && r.pct != null).length
  return (
    <div className="materials">
      {rows.map((r, i) => (
        <div key={i} className="material-row">
          <input list="materials" placeholder="e.g. Cotton" value={r.name} onChange={e => put(i, { name: e.target.value })} />
          <label className="pct">
            <input type="number" inputMode="numeric" min={0} max={100} placeholder="%" value={r.pct ?? ''}
              onChange={e => put(i, { pct: e.target.value === '' ? null : Math.max(0, Math.min(100, Math.round(+e.target.value))) })} />
            <span>%</span>
          </label>
          <button type="button" className="icon-btn" aria-label="Remove material" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon name="x" /></button>
        </div>
      ))}
      <datalist id="materials">{names.map(n => <option key={n} value={n} />)}</datalist>
      <div className="material-foot">
        <button type="button" className="btn ghost" onClick={() => onChange([...rows, { name: '', pct: rows.length && total < 100 && withPct ? 100 - total : null }])}><Icon name="plus" /> Add material</button>
        {withPct > 0 && <span className={'hint' + (total === 100 ? '' : ' warn')}>Total {total}%{total !== 100 ? ' (a label adds up to 100)' : ''}</span>}
      </div>
    </div>
  )
}

export function ItemForm({ item, wish, onSaved }: { item?: Item; wish?: boolean; onSaved: (i: Item) => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(item))
  const [photo, setPhoto] = useState<Processed | null>(null)
  const [uploaded, setUploaded] = useState<{ photo_path: string; thumb_path: string } | null>(null)
  const [tagging, setTagging] = useState(false)
  const [processing, setProcessing] = useState(false)
  const { setRequests } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  // AI draft made from the chosen photo; it replaces the photo only when the form is saved
  const [gen, setGen] = useState<{ source: string; draft: string; piece: string; corrections: string[]; refs: string[]; image: number; tags: number; tries: number; set: boolean } | null>(null)
  // Set mode: AI draws every piece of a suit/co-ord in one image (same colour), the app cuts it into items
  const [setMode, setSetMode] = useState(false)
  const [parts, setParts] = useState<Part[]>([])
  const partsRef = useRef<Part[]>([])
  partsRef.current = parts
  // Extra photos of the same garment (back, close-up, true colour) waiting for the next AI run
  const [extra, setExtra] = useState<{ blob: Blob; url: string }[]>([])
  const extraRef = useRef<HTMLInputElement>(null)
  const [genBusy, setGenBusy] = useState('')
  const [fix, setFix] = useState('')
  const genAfterPick = useRef(false)
  const set = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }))
  // My brand and material lists (admin defaults + my changes), loaded with the app
  const [brands, setBrands] = useState<string[]>(() => [...BRANDS])
  const [materialNames, setMaterialNames] = useState<string[]>(() => [...MATERIALS])

  const take = async (blob: Blob | null | undefined) => {
    if (!blob) return
    setProcessing(true); setError('')
    let processed: Processed | null = null
    try { processed = await processPhoto(blob); setPhoto(processed); setUploaded(null) }
    catch { setError('Could not read this image. Try another one.') }
    setProcessing(false)
    if (processed && genAfterPick.current) { genAfterPick.current = false; startGen(processed) }
  }
  // On a new item that already has a photo (or an AI draft), a pasted image is an extra photo for the AI;
  // "Change photo" is the way to replace the main one
  const pasteTarget = useRef<(b: Blob) => void>(() => {})
  pasteTarget.current = b => { if (!item && (photo || gen)) addExtra([b]); else take(b) }
  const paste = async () => {
    try {
      const img = await pasteImage()
      if (!img) setError('No image in the clipboard. Copy a cut-out in Photos first.')
      else pasteTarget.current(img)
    } catch { setError('Paste was not allowed. Try again and tap “Paste”.') }
  }
  // Paste from the keyboard (Cmd+V on a computer)
  useEffect(() => {
    const on = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter(x => x.type.startsWith('image/'))
      if (files.length) { e.preventDefault(); files.forEach(f => pasteTarget.current(f)) }
    }
    window.addEventListener('paste', on)
    return () => window.removeEventListener('paste', on)
  }, [])

  const fillEmpty = (t: Draft) => setD(x => ({
    ...x, category: x.category || t.category, kind: x.kind || t.kind, name: x.name || t.name,
    colors: x.colors.length ? x.colors : t.colors, seasons: x.seasons.length ? x.seasons : t.seasons,
    styles: x.styles.length ? x.styles : t.styles, occasions: x.occasions.length ? x.occasions : t.occasions,
    brand: x.brand?.trim() || t.brand || '',
    materials: x.materials.some(m => m.name.trim()) ? x.materials : (t.materials ?? []),
  }))

  const addExtra = async (files: FileList | Blob[] | null) => {
    for (const f of Array.from(files ?? [])) {
      try { const p = await processPhoto(f); setExtra(x => [...x, { blob: p.full, url: p.preview }]) }
      catch { setError('Could not read this image. Try another one.') }
    }
  }
  const uploadExtra = async (uid: string) => {
    const paths: string[] = []
    for (const e of extra) {
      const path = `${uid}/drafts/${crypto.randomUUID()}.${e.blob.type.split('/')[1]}`
      const up = await supabase.storage.from('photos').upload(path, e.blob, { contentType: e.blob.type })
      if (up.error) { await removePhotos(...paths); throw up.error }
      paths.push(path)
    }
    return paths
  }

  const startGen = async (p: Processed) => {
    setGenBusy('Creating the image, this can take a minute or two…'); setError('')
    let source = '', refs: string[] = []
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Please sign in again')
      source = `${user.id}/drafts/${crypto.randomUUID()}.${p.full.type.split('/')[1]}`
      const up = await supabase.storage.from('photos').upload(source, p.full, { contentType: p.full.type })
      if (up.error) { source = ''; throw up.error }
      refs = await uploadExtra(user.id)
      const piece = setMode
        ? `every piece of the matching set in the photo${d.name?.trim() ? `: ${d.name.trim()}` : ' (for example the jacket or vest and the trousers or skirt)'}`
        : d.name?.trim() || `the main garment in the photo${d.category ? ` (${categoryLabel(d.category)})` : ''}`
      // Optional instructions typed before the first run count as the first correction
      const first = fix.trim() ? [fix.trim()] : []
      const g = await generateGarment({ source_path: source, ref_paths: refs, piece, corrections: first, set: setMode })
      const draft = g.path
      setGen({ source, draft, piece, corrections: first, refs, image: g.cost_usd ?? 0, tags: 0, tries: 1, set: setMode }); setFix(''); setExtra([])
      if (setMode) { await cutParts(user.id, draft, source, refs, first); setGenBusy(''); return }
      setGenBusy('Filling in the details…')
      // Tags are a bonus: if this fails, the fields can be filled by hand
      try {
        // The original photos go along: a logo or care label there gives the brand and composition
        const r = await askAI('tag', { category: d.category || null, extra_paths: [source, ...refs], notes: first.join('; ') || null }, 'now', draft)
        setRequests(upsert(r)); fillEmpty(r.result as Draft)
        setGen(x => x && { ...x, tags: x.tags + (r.cost_usd ?? 0) })
      } catch { /* fill by hand */ }
    } catch (err) {
      if (source) await removePhotos(source, ...refs)
      setError((err as Error).message)
    }
    setGenBusy('')
  }

  // Cut the set image into pieces, upload each (AI needs a path to look at) and let AI describe each one
  const cutParts = async (uid: string, draft: string, source: string, refs: string[], notes: string[]) => {
    setGenBusy('Cutting the set into pieces…')
    await removePhotos(...partsRef.current.map(p => p.path)); setParts([])
    try {
      const { data: blob, error: dl } = await supabase.storage.from('photos').download(draft)
      if (dl || !blob) throw dl ?? new Error('Could not read the image')
      const blobs = await splitSet(await whiteToAlpha(blob))
      const list: Part[] = []
      for (const b of blobs) {
        const path = `${uid}/drafts/${crypto.randomUUID()}.png`
        const up = await supabase.storage.from('photos').upload(path, b, { contentType: 'image/png' })
        if (up.error) throw up.error
        list.push({ path, url: URL.createObjectURL(b), blob: b, tags: null })
      }
      setParts(list)
      if (list.length < 2) { setError('The pieces touch each other in this image, so they could not be separated. Tap Regenerate.'); return }
      setGenBusy('Filling in the details…')
      const found = await Promise.all(list.map(p =>
        askAI('tag', { category: null, extra_paths: [source, ...refs], notes: ['This image is one piece of a set', ...notes].join('; ') }, 'now', p.path)
          .then(r => { setRequests(upsert(r)); return r }).catch(() => null)))
      setParts(list.map((p, i) => ({ ...p, tags: (found[i]?.result as Draft) ?? null })))
      setGen(x => x && { ...x, tags: x.tags + found.reduce((s, r) => s + (r?.cost_usd ?? 0), 0) })
      // Brand and composition found on a label go to the shared fields, unless she typed them
      const t = found.map(r => r?.result as Draft | undefined)
      setD(x => ({
        ...x, brand: x.brand?.trim() || t.find(y => y?.brand)?.brand || '',
        materials: x.materials.some(m => m.name.trim()) ? x.materials : t.find(y => y?.materials?.length)?.materials ?? [],
      }))
    } catch (err) { setError((err as Error).message) }
  }
  const setPart = (i: number, patch: Partial<Draft>) =>
    setParts(x => x.map((p, j) => j === i ? { ...p, tags: { ...(p.tags ?? toDraft()), ...patch } } : p))

  const createFromPhoto = () => {
    if (photo) startGen(photo)
    else { genAfterPick.current = true; fileRef.current?.click() }
  }

  // Corrections accumulate, and the previous attempt goes to the model along with the original
  const regenerate = async () => {
    if (!gen) return
    const note = fix.trim()
    const corrections = note ? [...gen.corrections, note] : gen.corrections
    setGenBusy('Creating the image, this can take a minute or two…'); setError('')
    let added: string[] = []
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Please sign in again')
      added = await uploadExtra(user.id)
      const refs = [...gen.refs, ...added]
      // Without any new note or photo it is a fresh try; otherwise the model fixes its previous attempt
      const g = await generateGarment({ source_path: gen.source, ref_paths: refs, piece: gen.piece, corrections, previous_path: note || added.length ? gen.draft : undefined, set: gen.set })
      await removePhotos(gen.draft)
      setGen({ ...gen, draft: g.path, corrections, refs, image: gen.image + (g.cost_usd ?? 0), tries: gen.tries + 1 }); setFix(''); setExtra([])
      if (gen.set) await cutParts(user.id, g.path, gen.source, refs, corrections)
    } catch (err) { await removePhotos(...added); setError((err as Error).message) }
    setGenBusy('')
  }

  const discardGen = async () => {
    if (gen) await removePhotos(gen.source, gen.draft, ...gen.refs, ...partsRef.current.map(p => p.path))
    setGen(null); setFix(''); setExtra([]); setParts([])
  }

  // AI looks at the photo and fills in the fields (only empty ones, the rest stay untouched)
  const autoFill = async () => {
    setTagging(true); setError('')
    try {
      let path = item?.photo_path ?? null
      if (gen) path = gen.draft
      else if (photo) {
        const up = uploaded ?? await uploadPhoto(photo)
        setUploaded(up); path = up.photo_path
      }
      const r = await askAI('tag', { category: d.category || null }, 'now', path)
      setRequests(upsert(r))
      fillEmpty(r.result as Draft)
    } catch (err) {
      const r = (err as { request?: AIRequest }).request; if (r) setRequests(upsert(r))
      setError((err as Error).message)
    }
    setTagging(false)
  }

  // Remember new brands and materials in MY lists (dict_user); the same name in another case counts as known.
  // Upsert: if I had hidden that default, using it again brings it back.
  const remember = async (brand: string | null, materials: Material[]) => {
    const row = (type: 'brand' | 'material', label: string) => ({ type, category: '', id: label.trim().toLowerCase(), label: label.trim(), hex: null, sort: null, hidden: false })
    if (brand && !brands.some(b => b.toLowerCase() === brand.toLowerCase())) {
      await supabase.from('dict_user').upsert(row('brand', brand)); setBrands(x => [...x, brand]); BRANDS.push(brand)
    }
    const fresh = [...new Set(materials.map(m => m.name))].filter(m => !materialNames.some(n => n.toLowerCase() === m.toLowerCase()))
    if (fresh.length) { await supabase.from('dict_user').upsert(fresh.map(m => row('material', m))); setMaterialNames(x => [...x, ...fresh]); MATERIALS.push(...fresh) }
  }
  const cleanMaterials = (m: Material[]) => m.map(x => ({ name: x.name.trim(), pct: x.pct })).filter(x => x.name)

  // A set becomes one item per piece, linked by set_id; the shared fields apply to all, AI fills the rest
  const saveSet = async () => {
    if (!gen) return
    if (parts.length < 2) { setError('Regenerate first: the pieces could not be separated.'); return }
    if (parts.some(p => !p.tags?.category)) { setError('Choose a category for each piece'); return }
    setBusy(true); setError('')
    try {
      const set_id = crypto.randomUUID()
      const shared = cleanMaterials(d.materials)
      const saved: Item[] = []
      for (const p of parts) {
        const t = p.tags!
        const paths = await uploadPhoto(await processPhoto(p.blob))
        const row = {
          ...paths, set_id,
          name: t.name?.trim() || null, category: t.category, kind: t.kind?.trim().toLowerCase() || null, colors: t.colors ?? [],
          seasons: d.seasons.length ? d.seasons : t.seasons ?? [], styles: d.styles.length ? d.styles : t.styles ?? [],
          occasions: d.occasions.length ? d.occasions : t.occasions ?? [],
          brand: d.brand?.trim() || t.brand?.trim() || null,
          materials: shared.length ? shared : cleanMaterials(t.materials ?? []),
          notes: d.notes?.trim() || null, link: normLink(d.link),
          ...(wish ? { wishlist: true } : {}),
        }
        const { data, error } = await supabase.from('items').insert(row).select().single()
        if (error) throw error
        saved.push(data as Item)
        await remember(row.brand, row.materials)
      }
      await removePhotos(gen.source, gen.draft, ...gen.refs, ...parts.map(p => p.path))
      saved.forEach(onSaved)
      location.replace(`#/i/${saved[0].id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (gen?.set) { await saveSet(); return }
    if (!d.category) { setError('Choose a category'); return }
    if (!item && !photo && !gen) { setError('Add a photo'); return }
    setBusy(true); setError('')
    try {
      let paths = {}
      if (gen) {
        const { data: blob, error: dl } = await supabase.storage.from('photos').download(gen.draft)
        if (dl || !blob) throw dl ?? new Error('Could not read the image')
        paths = await uploadPhoto(await processPhoto(await whiteToAlpha(blob)))
      } else if (photo) paths = uploaded ?? await uploadPhoto(photo)
      const row = {
        ...d, ...paths,
        name: d.name?.trim() || null, kind: d.kind?.trim().toLowerCase() || null,
        brand: d.brand?.trim() || null, notes: d.notes?.trim() || null, link: normLink(d.link),
        materials: cleanMaterials(d.materials),
        ...(!item && wish ? { wishlist: true } : {}),
      }
      const q = item ? supabase.from('items').update(row).eq('id', item.id) : supabase.from('items').insert(row)
      const { data, error } = await q.select().single()
      if (error) throw error
      await remember(row.brand, row.materials)
      if (item && photo) await removePhotos(item.photo_path, item.thumb_path)
      if (gen) await removePhotos(gen.source, gen.draft, ...gen.refs, uploaded?.photo_path ?? null, uploaded?.thumb_path ?? null)
      onSaved(data as Item)
      if (item) back(`/i/${item.id}`)
      else location.replace(`#/i/${(data as Item).id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
      setBusy(false)
    }
  }

  return (
    <form className="screen" onSubmit={submit}>
      <Header title={item ? 'Edit item' : 'New item'}
        left={<button type="button" className="icon-btn" onClick={async () => { await discardGen(); back(item ? `/i/${item.id}` : wish ? '/wish' : '/') }} aria-label="Back"><Icon name="back" /></button>} />

      <div className="form">
        <div className="picker">
          {gen ? <Photo path={gen.draft} alt="" className="big" />
            : photo ? <div className="photo big"><img src={photo.preview} alt="" /></div>
            : item ? <Photo path={item.photo_path} alt="" className="big" />
            : <div className="photo big"><span className="photo-empty">{processing ? 'Processing…' : <Icon name="camera" />}</span></div>}
          {gen ? <>
            {gen.set && parts.length > 0 && (
              <div className="set-parts">
                {parts.map((p, i) => (
                  <div key={p.path} className="set-part">
                    <div className="set-part-img"><img src={p.url} alt="" /></div>
                    <input placeholder="Name" value={p.tags?.name ?? ''} onChange={e => setPart(i, { name: e.target.value })} disabled={!!genBusy} />
                    <select value={p.tags?.category ?? ''} onChange={e => setPart(i, { category: e.target.value })} disabled={!!genBusy}>
                      <option value="">Category…</option>
                      {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
            <Section title="What to fix">
              <textarea rows={2} placeholder="e.g. make it red, remove the belt, no cut-out on the back" value={fix} onChange={e => setFix(e.target.value)} disabled={!!genBusy} />
            </Section>
            <div className="refs">
              {extra.map((e, i) => (
                <div key={e.url} className="ref"><img src={e.url} alt="" />
                  <button type="button" aria-label="Remove photo" onClick={() => setExtra(x => x.filter((_, j) => j !== i))}><Icon name="x" /></button>
                </div>
              ))}
              <button type="button" className="ref add" onClick={() => extraRef.current?.click()} disabled={!!genBusy || gen.refs.length + extra.length >= 8}><Icon name="plus" /><span>Photo</span></button>
              {canPaste() && <button type="button" className="ref add" onClick={paste} disabled={!!genBusy}><Icon name="paste" /><span>Paste</span></button>}
            </div>
            <p className="hint">Extra photos of the same piece help: the back, a close-up, the true colour. About +1¢ each.</p>
            {gen.corrections.length > 0 && <p className="hint">Already asked: {gen.corrections.join(' · ')}</p>}
            <p className="hint">Spent so far: {cents(gen.image + gen.tags)} (image{gen.tries > 1 ? ` ×${gen.tries}` : ''} {cents(gen.image)}, details {cents(gen.tags)})</p>
            <div className="picker-btns">
              <button type="button" className="btn" onClick={regenerate} disabled={!!genBusy}><Icon name="sparkle" /> Regenerate<span className="cost">(Nano Banana ≈7¢)</span></button>
              <button type="button" className="btn ghost" onClick={discardGen} disabled={!!genBusy}>{gen.set ? 'Start over' : 'Use original photo'}</button>
            </div>
          </> : <>
          <div className="picker-btns">
            <button type="button" className="btn" onClick={() => { genAfterPick.current = false; fileRef.current?.click() }} disabled={processing || !!genBusy}>
              <Icon name="image" /> {photo || item ? 'Change photo' : 'Choose photo'}
            </button>
            {canPaste() && (item || !photo) && <button type="button" className="btn" onClick={paste} disabled={processing}><Icon name="paste" /> Paste</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { take(e.target.files?.[0]); e.target.value = '' }} />
          {photo && !photo.cutout && <p className="hint">The background is still there. That's fine, but a cut-out looks neater in outfits.</p>}
          {!photo && !item && (
            <p className="hint">Tip: in the Photos app, touch and hold the item until it lifts, tap <b>Copy</b>, then tap <b>Paste</b> here. iPhone removes the background for you.</p>
          )}
          {!item && <>
            <Section title="Instructions for AI">
              <textarea rows={2} placeholder="e.g. make it red, only the skirt, without the belt" value={fix} onChange={e => setFix(e.target.value)} disabled={processing || !!genBusy} />
            </Section>
            <div className="refs">
              {extra.map((e, i) => (
                <div key={e.url} className="ref"><img src={e.url} alt="" />
                  <button type="button" aria-label="Remove photo" onClick={() => setExtra(x => x.filter((_, j) => j !== i))}><Icon name="x" /></button>
                </div>
              ))}
              <button type="button" className="ref add" onClick={() => extraRef.current?.click()} disabled={!!genBusy || 0 + extra.length >= 8}><Icon name="plus" /><span>Photo</span></button>
              {canPaste() && <button type="button" className="ref add" onClick={paste} disabled={!!genBusy}><Icon name="paste" /><span>Paste</span></button>}
            </div>
            <p className="hint">Extra photos of the same piece help: the back, a close-up, the true colour. About +1¢ each.</p>
            <label className="check-row">
              <input type="checkbox" checked={setMode} onChange={e => setSetMode(e.target.checked)} disabled={processing || !!genBusy} />
              <span><b>It's a set</b> (suit, co-ord): AI draws all pieces in one image so the colour matches, then each piece is saved as its own item</span>
            </label>
            <button type="button" className="btn wide ai-fill" onClick={createFromPhoto} disabled={processing || !!genBusy}>
              <Icon name="sparkle" /> Enhance with AI<span className="cost">(Nano Banana ≈7¢)</span>
            </button>
          </>}
          </>}
          <input ref={extraRef} type="file" accept="image/*" multiple hidden onChange={e => { addExtra(e.target.files); e.target.value = '' }} />
          {genBusy && <p className="hint">{genBusy}</p>}
        </div>

        {(photo || item) && !gen && (
          <button type="button" className="btn wide ai-fill" onClick={autoFill} disabled={tagging || processing}>
            <Icon name="sparkle" /> {tagging ? 'Looking at the photo…' : 'Fill in with AI'}<span className="cost">(OpenAI ≈0.4¢)</span>
          </button>
        )}

        {gen?.set ? <p className="hint">These details apply to every piece of the set. Leave a field empty and AI fills it for each piece.</p> : <>
        <Section title="Category">
          <Chips options={CATEGORIES} value={d.category ? [d.category] : []} multi={false} onChange={v => set({ category: v[0] ?? '' })} />
        </Section>

        <Section title="Type">
          <input list="kinds" placeholder="e.g. sweater, jeans, loafers" value={d.kind ?? ''} onChange={e => set({ kind: e.target.value })} />
          <datalist id="kinds">{(KINDS[d.category] ?? Object.values(KINDS).flat()).map(k => <option key={k} value={k} />)}</datalist>
        </Section>

        <Section title="Name">
          <input placeholder="e.g. Cream cable-knit sweater" value={d.name ?? ''} onChange={e => set({ name: e.target.value })} />
        </Section>

        </>}

        <Section title="Composition">
          <MaterialsInput value={d.materials} names={materialNames} onChange={materials => set({ materials })} />
        </Section>

        <Section title="Brand">
          <input list="brands" placeholder="e.g. SOLMAR" value={d.brand ?? ''} onChange={e => set({ brand: e.target.value })} />
          <datalist id="brands">{brands.map(b => <option key={b} value={b} />)}</datalist>
        </Section>

        {(wish || item?.wishlist) && (
          <Section title="Link">
            <input type="url" inputMode="url" placeholder="https://shop…" value={d.link ?? ''} onChange={e => set({ link: e.target.value })} />
          </Section>
        )}

        {!gen?.set && <Section title="Colors"><Chips options={COLORS} value={d.colors} onChange={colors => set({ colors })} swatches /></Section>}
        <Section title="Season"><Chips options={SEASONS} value={d.seasons} onChange={seasons => set({ seasons })} /></Section>
        <Section title="Style"><Chips options={STYLES} value={d.styles} onChange={styles => set({ styles })} /></Section>
        <Section title="Occasion"><Chips options={OCCASIONS} value={d.occasions} onChange={occasions => set({ occasions })} /></Section>

        <Section title="Notes">
          <textarea rows={3} placeholder="Fit, fabric, what it goes with…" value={d.notes ?? ''} onChange={e => set({ notes: e.target.value })} />
        </Section>

        {error && <p className="error">{error}</p>}
        <button className="btn primary wide" disabled={busy || processing || !!genBusy}>{busy ? 'Saving…' : item ? 'Save changes' : gen?.set ? `Add ${parts.length} items${wish ? ' to wishlist' : ''}` : wish ? 'Add to wishlist' : 'Add to wardrobe'}</button>
      </div>
    </form>
  )
}
