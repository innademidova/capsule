// Admin page: edit the dictionaries (brands, materials, colors, types, styles, occasions).
// No roles yet: everyone signed in sees it (it is a single-user app for now).
import { useEffect, useState } from 'react'
import { supabase, CATEGORIES, COLORS, KINDS, STYLES, OCCASIONS, type Item, type Material } from './lib'
import { useStore } from './store'
import { Icon, Header } from './ui'
import { back } from './App'

type Tab = 'brand' | 'material' | 'color' | 'kind' | 'style' | 'occasion'
const TABS: { id: Tab; label: string }[] = [
  { id: 'brand', label: 'Brands' }, { id: 'material', label: 'Materials' }, { id: 'color', label: 'Colors' },
  { id: 'kind', label: 'Types' }, { id: 'style', label: 'Styles' }, { id: 'occasion', label: 'Occasions' },
]
type Row = { id: string; label: string; hex?: string; category?: string; uses: number }

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

export function Admin() {
  const { items, wishlist, reload } = useStore()
  const all: Item[] = [...items, ...wishlist]
  const [tab, setTab] = useState<Tab>('brand')
  const [cat, setCat] = useState('top')
  const [names, setNames] = useState<Record<string, string[]>>({})
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  // Brands and materials live in their own tables; load them when the tab opens
  const loadNames = async (t: 'brand' | 'material') => {
    const { data } = await supabase.from(t === 'brand' ? 'brands' : 'materials').select('name').order('name')
    setNames(x => ({ ...x, [t]: (data ?? []).map(r => r.name as string) }))
  }
  useEffect(() => { if (tab === 'brand' || tab === 'material') loadNames(tab) }, [tab])

  const count = (f: (i: Item) => boolean) => all.filter(f).length
  const rows: Row[] =
    tab === 'brand' ? (names.brand ?? []).map(n => ({ id: n, label: n, uses: count(i => i.brand?.toLowerCase() === n.toLowerCase()) }))
    : tab === 'material' ? (names.material ?? []).map(n => ({ id: n, label: n, uses: count(i => i.materials?.some(m => m.name.toLowerCase() === n.toLowerCase())) }))
    : tab === 'color' ? COLORS.map(c => ({ id: c.id, label: c.label, hex: c.hex, uses: count(i => i.colors.includes(c.id)) }))
    : tab === 'style' ? STYLES.map(c => ({ id: c.id, label: c.label, uses: count(i => i.styles.includes(c.id)) }))
    : tab === 'occasion' ? OCCASIONS.map(c => ({ id: c.id, label: c.label, uses: count(i => i.occasions.includes(c.id)) }))
    : (KINDS[cat] ?? []).map(k => ({ id: k, label: k, category: cat, uses: count(i => i.kind === k) }))
  const shown = rows.filter(r => !q.trim() || r.label.toLowerCase().includes(q.trim().toLowerCase()))

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    try { await f(); if (tab === 'brand' || tab === 'material') await loadNames(tab); await reload() }
    catch (e) { alert((e as Error).message) }
    setBusy(false)
  }

  // Items that use a value get the new name too, so nothing is lost
  const renameMaterial = async (from: string, to: string) => {
    for (const i of all.filter(i => i.materials?.some(m => m.name === from))) {
      const materials: Material[] = i.materials.map(m => m.name === from ? { ...m, name: to } : m)
      fail((await supabase.from('items').update({ materials }).eq('id', i.id)).error)
    }
  }
  const dropFromItems = async (field: 'colors' | 'styles' | 'occasions', id: string) => {
    for (const i of all.filter(i => i[field].includes(id)))
      fail((await supabase.from('items').update({ [field]: i[field].filter(x => x !== id) }).eq('id', i.id)).error)
  }

  const add = (label: string, hex: string) => run(async () => {
    const name = label.trim()
    if (!name) return
    if (tab === 'brand') return fail((await supabase.from('brands').insert({ name })).error)
    if (tab === 'material') return fail((await supabase.from('materials').insert({ name })).error)
    const id = tab === 'kind' ? name.toLowerCase() : slug(name)
    if (rows.some(r => r.id === id)) throw new Error('Already in the list')
    fail((await supabase.from('dict').insert({ type: tab, category: tab === 'kind' ? cat : '', id, label: tab === 'kind' ? id : name, hex: tab === 'color' ? hex : null, sort: rows.length })).error)
  })

  const save = (r: Row, label: string, hex?: string) => run(async () => {
    const name = label.trim()
    if (!name) return
    if (tab === 'brand') {
      fail((await supabase.from('brands').update({ name }).eq('name', r.id)).error)
      fail((await supabase.from('items').update({ brand: name }).eq('brand', r.id)).error)
    } else if (tab === 'material') {
      fail((await supabase.from('materials').update({ name }).eq('name', r.id)).error)
      await renameMaterial(r.id, name)
    } else if (tab === 'kind') {
      const id = name.toLowerCase()
      fail((await supabase.from('dict').update({ id, label: id }).match({ type: 'kind', category: cat, id: r.id })).error)
      fail((await supabase.from('items').update({ kind: id }).eq('kind', r.id)).error)
    } else {
      // Colors, styles, occasions keep their id (stored in items); only the label and colour change
      fail((await supabase.from('dict').update({ label: name, ...(tab === 'color' ? { hex } : {}) }).match({ type: tab, category: '', id: r.id })).error)
    }
  })

  const del = (r: Row) => {
    const keep = tab === 'brand' || tab === 'material' || tab === 'kind'
    const msg = r.uses
      ? keep ? `Delete “${r.label}” from the list? ${r.uses} item(s) keep it, it just stops being suggested.`
        : `“${r.label}” is used by ${r.uses} item(s). Delete it and remove it from them?`
      : `Delete “${r.label}”?`
    if (!confirm(msg)) return
    run(async () => {
      if (tab === 'brand') return fail((await supabase.from('brands').delete().eq('name', r.id)).error)
      if (tab === 'material') return fail((await supabase.from('materials').delete().eq('name', r.id)).error)
      if (tab !== 'kind') await dropFromItems(tab === 'color' ? 'colors' : tab === 'style' ? 'styles' : 'occasions', r.id)
      fail((await supabase.from('dict').delete().match({ type: tab, category: tab === 'kind' ? cat : '', id: r.id })).error)
    })
  }

  return (
    <div className="screen">
      <Header title="Dictionaries" left={<button className="icon-btn" onClick={() => back('/me')} aria-label="Back"><Icon name="back" /></button>} />
      <div className="cat-row">
        {TABS.map(t => <button key={t.id} className={'cat' + (tab === t.id ? ' on' : '')} onClick={() => { setTab(t.id); setQ('') }}>{t.label}</button>)}
      </div>
      {tab === 'kind' && (
        <div className="cat-row">
          {CATEGORIES.map(c => <button key={c.id} className={'cat' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>{c.label}</button>)}
        </div>
      )}
      <div className="form">
        <AddRow key={tab + cat} color={tab === 'color'} busy={busy} onAdd={add}
          placeholder={tab === 'kind' ? `New type for ${CATEGORIES.find(c => c.id === cat)?.label.toLowerCase()}` : `New ${TABS.find(t => t.id === tab)!.label.toLowerCase().replace(/s$/, '')}`} />
        {rows.length > 8 && <input placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />}
        <div className="dict-list">
          {shown.map(r => <DictRowEdit key={tab + cat + r.id} row={r} color={tab === 'color'} busy={busy} onSave={save} onDelete={del} />)}
          {!shown.length && <p className="muted small">Nothing here yet.</p>}
        </div>
        <p className="hint">Renaming updates every item that uses it. Changes reach the AI right away.</p>
      </div>
    </div>
  )
}

function AddRow({ color, busy, placeholder, onAdd }: { color: boolean; busy: boolean; placeholder: string; onAdd: (label: string, hex: string) => Promise<void> }) {
  const [label, setLabel] = useState('')
  const [hex, setHex] = useState('#cccccc')
  const submit = async () => { await onAdd(label, hex); setLabel('') }
  return (
    <div className="dict-row add">
      {color && <input type="color" value={hex} onChange={e => setHex(e.target.value)} aria-label="Colour" />}
      <input placeholder={placeholder} value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      <button className="btn sm primary" onClick={submit} disabled={busy || !label.trim()}><Icon name="plus" /> Add</button>
    </div>
  )
}

function DictRowEdit({ row, color, busy, onSave, onDelete }: {
  row: Row; color: boolean; busy: boolean; onSave: (r: Row, label: string, hex?: string) => void; onDelete: (r: Row) => void
}) {
  const [label, setLabel] = useState(row.label)
  const [hex, setHex] = useState(row.hex ?? '#cccccc')
  const changed = label.trim() !== row.label || (color && hex !== row.hex)
  return (
    <div className="dict-row">
      {color && <input type="color" value={hex} onChange={e => setHex(e.target.value)} aria-label="Colour" />}
      <input value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && changed && onSave(row, label, hex)} />
      <span className="muted small uses">{row.uses || ''}</span>
      {changed
        ? <button className="icon-btn" onClick={() => onSave(row, label, hex)} disabled={busy} aria-label="Save"><Icon name="check" /></button>
        : <button className="icon-btn" onClick={() => onDelete(row)} disabled={busy} aria-label="Delete"><Icon name="trash" /></button>}
    </div>
  )
}
