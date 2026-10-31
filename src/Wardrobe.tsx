import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  supabase, CATEGORIES, COLORS, SEASONS, STYLES, OCCASIONS, KINDS, categoryLabel, labelOf, itemTitle,
  processPhoto, uploadPhoto, removePhotos, canPaste, pasteImage, askAI, today, type Item, type Processed, type AIRequest,
} from './lib'
import { Chips, Icon, Photo, Header, Section, Swatch, Collage } from './ui'
import { go, back } from './App'
import { useStore, upsert } from './store'
import { logWear } from './Outfits'

// --- Список ---

export type Filters = {
  category: string; q: string; colors: string[]; seasons: string[]; styles: string[]; occasions: string[]; fav: boolean
}
export const emptyFilters: Filters = { category: '', q: '', colors: [], seasons: [], styles: [], occasions: [], fav: false }

const anyOf = (want: string[], have: string[]) => !want.length || want.some(w => have.includes(w))

export function WardrobeList({ items, filters, setFilters }: {
  items: Item[]; filters: Filters; setFilters: (f: Filters) => void
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

  return (
    <div className="screen">
      <Header title="Wardrobe" right={
        <button className="icon-btn" onClick={() => setOpen(o => !o)} aria-label="Filters">
          <Icon name="filter" />{extra > 0 && <span className="dot">{extra}</span>}
        </button>
      } />

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
          <h2>Your wardrobe is empty</h2>
          <p className="muted">Add your first piece: a photo of the item, ideally cut out from the background.</p>
          <button className="btn primary" onClick={() => go('/i/new')}><Icon name="plus" /> Add item</button>
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

      <button className="fab" onClick={() => go('/i/new')} aria-label="Add item"><Icon name="plus" /></button>
    </div>
  )
}

// --- Картка речі ---

export function ItemDetail({ item, onChange, onDelete }: { item: Item; onChange: (i: Item) => void; onDelete: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  const { wear, outfits, items, setWear } = useStore()
  const worn = wear.filter(w => w.item_ids.includes(item.id))
  const wornToday = worn.some(w => w.worn_on === today())
  const inOutfits = outfits.filter(o => o.layout.some(p => p.item_id === item.id))
  const wore = async () => {
    try { const w = await logWear([item.id], null); setWear(x => [w, ...x]) } catch (e) { alert((e as Error).message) }
  }

  const toggleFav = async () => {
    const { data, error } = await supabase.from('items').update({ favorite: !item.favorite }).eq('id', item.id).select().single()
    if (!error) onChange(data as Item)
  }
  const del = async () => {
    if (!confirm(`Delete “${itemTitle(item)}”?`)) return
    setBusy(true)
    const { error } = await supabase.from('items').delete().eq('id', item.id)
    if (error) { alert(error.message); setBusy(false); return }
    await removePhotos(item.photo_path, item.thumb_path)
    onDelete(item.id)
    back('/')
  }

  const tags = (title: string, ids: string[], list: { id: string; label: string }[]) =>
    ids.length > 0 && (
      <div className="kv"><span className="muted">{title}</span><span>{ids.map(id => labelOf(list, id)).join(', ')}</span></div>
    )

  return (
    <div className="screen">
      <Header title="" left={<button className="icon-btn" onClick={() => back('/')} aria-label="Back"><Icon name="back" /></button>}
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
          <div className="row wrap">
            <button className="btn primary" onClick={wore} disabled={wornToday}><Icon name="check" /> {wornToday ? 'Worn today' : 'Wore it today'}</button>
            <button className="btn" onClick={() => go(`/o/new/${item.id}`)}><Icon name="layers" /> Build outfit</button>
          </div>
          <p className="muted small">{worn.length ? `Worn ${worn.length}× · last ${worn[0].worn_on}` : 'Not worn yet'}</p>
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

// --- Додавання / редагування ---

type Draft = Omit<Item, 'id' | 'created_at' | 'updated_at' | 'favorite' | 'photo_path' | 'thumb_path'>

const toDraft = (i?: Item): Draft => ({
  name: i?.name ?? '', category: i?.category ?? '', kind: i?.kind ?? '', colors: i?.colors ?? [], seasons: i?.seasons ?? [],
  styles: i?.styles ?? [], occasions: i?.occasions ?? [], brand: i?.brand ?? '', notes: i?.notes ?? '',
})

export function ItemForm({ item, onSaved }: { item?: Item; onSaved: (i: Item) => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(item))
  const [photo, setPhoto] = useState<Processed | null>(null)
  const [uploaded, setUploaded] = useState<{ photo_path: string; thumb_path: string } | null>(null)
  const [tagging, setTagging] = useState(false)
  const [processing, setProcessing] = useState(false)
  const { setRequests } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }))

  const take = async (blob: Blob | null | undefined) => {
    if (!blob) return
    setProcessing(true); setError('')
    try { setPhoto(await processPhoto(blob)); setUploaded(null) }
    catch { setError('Could not read this image. Try another one.') }
    setProcessing(false)
  }
  const paste = async () => {
    try {
      const img = await pasteImage()
      if (!img) setError('No image in the clipboard. Copy a cut-out in Photos first.')
      else take(img)
    } catch { setError('Paste was not allowed. Try again and tap “Paste”.') }
  }
  // Вставка з клавіатури (Cmd+V на комп'ютері)
  useEffect(() => {
    const on = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith('image/'))
      if (f) { e.preventDefault(); take(f) }
    }
    window.addEventListener('paste', on)
    return () => window.removeEventListener('paste', on)
  }, [])

  // ІІ дивиться на фото і заповнює поля (порожні — завжди, решту не чіпає)
  const autoFill = async () => {
    setTagging(true); setError('')
    try {
      let path = item?.photo_path ?? null
      if (photo) {
        const up = uploaded ?? await uploadPhoto(photo)
        setUploaded(up); path = up.photo_path
      }
      const r = await askAI('tag', { category: d.category || null }, 'now', path)
      setRequests(upsert(r))
      const t = r.result as Draft
      setD(x => ({
        ...x, category: x.category || t.category, kind: x.kind || t.kind, name: x.name || t.name,
        colors: x.colors.length ? x.colors : t.colors, seasons: x.seasons.length ? x.seasons : t.seasons,
        styles: x.styles.length ? x.styles : t.styles, occasions: x.occasions.length ? x.occasions : t.occasions,
      }))
    } catch (err) {
      const r = (err as { request?: AIRequest }).request; if (r) setRequests(upsert(r))
      setError((err as Error).message)
    }
    setTagging(false)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!d.category) { setError('Choose a category'); return }
    if (!item && !photo) { setError('Add a photo'); return }
    setBusy(true); setError('')
    try {
      let paths = {}
      if (photo) paths = uploaded ?? await uploadPhoto(photo)
      const row = {
        ...d, ...paths,
        name: d.name?.trim() || null, kind: d.kind?.trim().toLowerCase() || null,
        brand: d.brand?.trim() || null, notes: d.notes?.trim() || null,
      }
      const q = item ? supabase.from('items').update(row).eq('id', item.id) : supabase.from('items').insert(row)
      const { data, error } = await q.select().single()
      if (error) throw error
      if (item && photo) await removePhotos(item.photo_path, item.thumb_path)
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
        left={<button type="button" className="icon-btn" onClick={() => back(item ? `/i/${item.id}` : '/')} aria-label="Back"><Icon name="back" /></button>} />

      <div className="form">
        <div className="picker">
          {photo ? <div className="photo big"><img src={photo.preview} alt="" /></div>
            : item ? <Photo path={item.photo_path} alt="" className="big" />
            : <div className="photo big"><span className="photo-empty">{processing ? 'Processing…' : <Icon name="camera" />}</span></div>}
          <div className="picker-btns">
            <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={processing}>
              <Icon name="image" /> {photo || item ? 'Change photo' : 'Choose photo'}
            </button>
            {canPaste() && <button type="button" className="btn" onClick={paste} disabled={processing}><Icon name="paste" /> Paste</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { take(e.target.files?.[0]); e.target.value = '' }} />
          {photo && !photo.cutout && <p className="hint">The background is still there. That's fine, but a cut-out looks neater in outfits.</p>}
          {!photo && !item && (
            <p className="hint">Tip: in the Photos app, touch and hold the item until it lifts, tap <b>Copy</b>, then tap <b>Paste</b> here. iPhone removes the background for you.</p>
          )}
        </div>

        {(photo || item) && (
          <button type="button" className="btn wide ai-fill" onClick={autoFill} disabled={tagging || processing}>
            <Icon name="sparkle" /> {tagging ? 'Looking at the photo…' : 'Fill in with AI'}<span className="cost">≈1¢</span>
          </button>
        )}

        <Section title="Category">
          <Chips options={CATEGORIES} value={d.category ? [d.category] : []} multi={false} onChange={v => set({ category: v[0] ?? '' })} />
        </Section>

        <Section title="Type">
          <input list="kinds" placeholder="e.g. sweater, jeans, loafers" value={d.kind ?? ''} onChange={e => set({ kind: e.target.value })} />
          <datalist id="kinds">{(KINDS[d.category] ?? Object.values(KINDS).flat()).map(k => <option key={k} value={k} />)}</datalist>
        </Section>

        <Section title="Name (optional)">
          <input placeholder="e.g. Cream cable-knit sweater" value={d.name ?? ''} onChange={e => set({ name: e.target.value })} />
        </Section>

        <Section title="Colors"><Chips options={COLORS} value={d.colors} onChange={colors => set({ colors })} swatches /></Section>
        <Section title="Season"><Chips options={SEASONS} value={d.seasons} onChange={seasons => set({ seasons })} /></Section>
        <Section title="Style"><Chips options={STYLES} value={d.styles} onChange={styles => set({ styles })} /></Section>
        <Section title="Occasion"><Chips options={OCCASIONS} value={d.occasions} onChange={occasions => set({ occasions })} /></Section>

        <Section title="Brand"><input placeholder="Optional" value={d.brand ?? ''} onChange={e => set({ brand: e.target.value })} /></Section>
        <Section title="Notes">
          <textarea rows={3} placeholder="Fit, fabric, what it goes with…" value={d.notes ?? ''} onChange={e => set({ notes: e.target.value })} />
        </Section>

        {error && <p className="error">{error}</p>}
        <button className="btn primary wide" disabled={busy || processing}>{busy ? 'Saving…' : item ? 'Save changes' : 'Add to wardrobe'}</button>
      </div>
    </form>
  )
}
