// Dictionary editors (brands, materials, colors, types, styles, occasions), the look format picture and the user list.
// Two scopes, both enforced by RLS in the database:
//   'user'   my lists = the admin defaults + my own changes (dict_user). Changing or removing a default only
//            touches my overrides; the default itself stays for everyone else.
//   'global' the defaults themselves (dict_global, app_settings); admins only.
import { useEffect, useState } from 'react'
import { supabase, CATEGORIES, TEMPLATES, processPhoto, renderLook, removePhotos, type Item, type Material, type DictType, type TemplateId } from './lib'
import { useStore } from './store'
import { Icon, Photo } from './ui'

export type Scope = 'user' | 'global'
const TYPES: { id: DictType; label: string }[] = [
  { id: 'brand', label: 'Brands' }, { id: 'material', label: 'Materials' }, { id: 'color', label: 'Colors' },
  { id: 'kind', label: 'Types' }, { id: 'style', label: 'Styles' }, { id: 'occasion', label: 'Occasions' },
]
// Items keep colors, styles and occasions by id (renaming changes only the label);
// brands, materials and kinds by their text (renaming changes the id and the items)
const BY_ID: DictType[] = ['color', 'style', 'occasion']
const ITEM_FIELD = { color: 'colors', style: 'styles', occasion: 'occasions' } as const

type G = { type: DictType; category: string; id: string; label: string; hex: string | null; sort: number }
type U = { type: DictType; category: string; id: string; label: string | null; hex: string | null; sort: number | null; hidden: boolean }
type Row = { id: string; label: string; hex: string | null; source: 'default' | 'edited' | 'own'; uses: number }

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

export function DictEditor({ scope }: { scope: Scope }) {
  const { items, wishlist, reload } = useStore()
  const all: Item[] = [...items, ...wishlist]
  const [type, setType] = useState<DictType>('brand')
  const [cat, setCat] = useState('top')
  const [glob, setGlob] = useState<G[]>([])
  const [mine, setMine] = useState<U[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [g, u] = await Promise.all([
      supabase.from('dict_global').select('type,category,id,label,hex,sort'),
      scope === 'user' ? supabase.from('dict_user').select('type,category,id,label,hex,sort,hidden') : Promise.resolve({ data: [] }),
    ])
    setGlob((g.data ?? []) as G[]); setMine((u.data ?? []) as U[])
  }
  useEffect(() => { load() }, [scope]) // eslint-disable-line react-hooks/exhaustive-deps

  const category = type === 'kind' ? cat : ''
  const here = <T extends { type: DictType; category: string }>(r: T) => r.type === type && r.category === category
  const usesOf = (id: string) => all.filter(i =>
    type === 'brand' ? i.brand?.trim().toLowerCase() === id
    : type === 'material' ? i.materials?.some(m => m.name.trim().toLowerCase() === id)
    : type === 'kind' ? i.kind === id && i.category === cat
    : (i[ITEM_FIELD[type]] as string[]).includes(id)).length

  // The same merge as the dict_effective view, plus what is hidden (so it can be brought back)
  const g = glob.filter(here), u = mine.filter(here)
  const over = new Map(u.map(r => [r.id, r]))
  const rows: Row[] = scope === 'global'
    ? g.map(r => ({ id: r.id, label: r.label, hex: r.hex, source: 'default' as const, uses: usesOf(r.id) }))
    : [
      ...g.filter(r => !over.get(r.id)?.hidden).map(r => {
        const o = over.get(r.id)
        return { id: r.id, label: o?.label ?? r.label, hex: o?.hex ?? r.hex, source: o ? 'edited' as const : 'default' as const, uses: usesOf(r.id), sort: o?.sort ?? r.sort }
      }),
      ...u.filter(r => !r.hidden && !g.some(x => x.id === r.id)).map(r => ({ id: r.id, label: r.label ?? r.id, hex: r.hex, source: 'own' as const, uses: usesOf(r.id), sort: r.sort ?? 1000 })),
    ].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
  if (scope === 'global') rows.sort((a, b) => (g.find(x => x.id === a.id)!.sort - g.find(x => x.id === b.id)!.sort) || a.label.localeCompare(b.label))
  const hiddenDefaults = scope === 'user' ? g.filter(r => over.get(r.id)?.hidden) : []
  const shown = rows.filter(r => !q.trim() || r.label.toLowerCase().includes(q.trim().toLowerCase()))

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    try { await f(); await load(); await reload() } catch (e) { alert((e as Error).message) }
    setBusy(false)
  }
  const idFor = (label: string) => BY_ID.includes(type) ? slug(label) : label.trim().toLowerCase()
  const labelFor = (label: string) => type === 'kind' ? label.trim().toLowerCase() : label.trim()
  const key = { type, category }
  const setMineRow = async (id: string, p: Partial<U>) =>
    fail((await supabase.from('dict_user').upsert({ ...key, id, label: null, hex: null, sort: null, hidden: false, ...p })).error)
  const dropMineRow = async (id: string) => fail((await supabase.from('dict_user').delete().match({ ...key, id })).error)

  // My items follow my renames and removals (only mine; other users' items are never touched from here)
  const renameInItems = async (from: string, to: string) => {
    for (const i of all) {
      let p: Partial<Item> | null = null
      if (type === 'brand' && i.brand?.trim().toLowerCase() === from) p = { brand: to }
      if (type === 'kind' && i.kind === from && i.category === cat) p = { kind: to }
      if (type === 'material' && i.materials?.some(m => m.name.trim().toLowerCase() === from))
        p = { materials: i.materials.map((m): Material => m.name.trim().toLowerCase() === from ? { ...m, name: to } : m) }
      if (p) fail((await supabase.from('items').update(p).eq('id', i.id)).error)
    }
  }
  const dropFromItems = async (id: string) => {
    if (!BY_ID.includes(type)) return
    const f = ITEM_FIELD[type as 'color' | 'style' | 'occasion']
    for (const i of all.filter(i => i[f].includes(id)))
      fail((await supabase.from('items').update({ [f]: i[f].filter(x => x !== id) }).eq('id', i.id)).error)
  }

  const add = (label: string, hex: string) => run(async () => {
    const id = idFor(label), name = labelFor(label)
    if (!id) return
    if (rows.some(r => r.id === id)) throw new Error('Already in the list')
    const sort = rows.length
    if (scope === 'global') return fail((await supabase.from('dict_global').insert({ ...key, id, label: name, hex: type === 'color' ? hex : null, sort })).error)
    if (hiddenDefaults.some(r => r.id === id)) return dropMineRow(id) // it was a hidden default: bring it back
    await setMineRow(id, { label: name, hex: type === 'color' ? hex : null, sort })
  })

  const save = (r: Row, label: string, hex: string | null) => run(async () => {
    const name = labelFor(label)
    if (!name) return
    if (scope === 'global') {
      fail((await supabase.rpc('admin_rename_dict', { p_type: type, p_category: category, p_id: r.id, p_label: name, p_hex: type === 'color' ? hex : null })).error)
      return
    }
    if (BY_ID.includes(type)) return setMineRow(r.id, { label: name, hex: type === 'color' ? hex : null, sort: null })
    const id = idFor(name)
    if (id !== r.id && rows.some(x => x.id === id)) throw new Error('Already in the list')
    if (id === r.id) await setMineRow(r.id, { label: name })
    else {
      // A default can not be renamed for me only: hide it and add my own entry with the new name
      if (r.source === 'own') await dropMineRow(r.id); else await setMineRow(r.id, { hidden: true })
      await setMineRow(id, { label: name })
    }
    await renameInItems(r.id, name)
  })

  const del = (r: Row) => {
    const strip = BY_ID.includes(type) && r.uses > 0
    const msg = scope === 'global'
      ? `Delete “${r.label}” from the defaults for everyone? Users whose items use it keep it in their own list.`
      : strip ? `“${r.label}” is used by ${r.uses} of your item(s). Remove it from your list and from them?`
      : r.uses ? `Remove “${r.label}” from your list? Your ${r.uses} item(s) keep it, it just stops being suggested.`
      : `Remove “${r.label}” from your list?`
    if (!confirm(msg)) return
    run(async () => {
      if (scope === 'global') return fail((await supabase.rpc('admin_delete_dict', { p_type: type, p_category: category, p_id: r.id })).error)
      if (strip) await dropFromItems(r.id)
      if (r.source === 'own') await dropMineRow(r.id); else await setMineRow(r.id, { hidden: true })
    })
  }
  const reset = (r: Row) => run(() => dropMineRow(r.id)) // an edited default goes back to the default

  const typeLabel = TYPES.find(t => t.id === type)!.label
  return (
    <div className="form">
      <p className="hint">
        {scope === 'global'
          ? 'Defaults for every user. Users can change, add or hide entries for themselves; that never changes these.'
          : 'Your own lists: the defaults plus your changes. Removing a default hides it only for you.'}
      </p>
      <div className="cat-row">
        {TYPES.map(t => <button key={t.id} className={'cat' + (type === t.id ? ' on' : '')} onClick={() => { setType(t.id); setQ('') }}>{t.label}</button>)}
      </div>
      {type === 'kind' && (
        <div className="cat-row">
          {CATEGORIES.map(c => <button key={c.id} className={'cat' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>{c.label}</button>)}
        </div>
      )}
      <AddRow key={scope + type + cat} color={type === 'color'} busy={busy} onAdd={add}
        placeholder={type === 'kind' ? `New type for ${CATEGORIES.find(c => c.id === cat)?.label.toLowerCase()}` : `New ${typeLabel.toLowerCase().replace(/s$/, '')}`} />
      {rows.length > 8 && <input placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />}
      <div className="dict-list">
        {shown.map(r => <DictRowEdit key={scope + type + cat + r.id + r.label + r.hex} row={r} color={type === 'color'} busy={busy}
          badge={scope === 'user' && r.source !== 'default' ? (r.source === 'own' ? 'mine' : 'edited') : ''}
          onSave={save} onDelete={del} onReset={r.source === 'edited' ? () => reset(r) : undefined} />)}
        {!shown.length && <p className="muted small">Nothing here yet.</p>}
      </div>
      {hiddenDefaults.length > 0 && (
        <details className="card">
          <summary className="small"><b>Hidden defaults</b> <span className="muted">({hiddenDefaults.length})</span></summary>
          <div className="dict-list">
            {hiddenDefaults.map(r => (
              <div key={r.id} className="dict-row">
                {type === 'color' && <span className="dict-swatch" style={{ background: r.hex ?? '#ccc' }} />}
                <span className="grow">{r.label}</span>
                <button className="btn sm" onClick={() => run(() => dropMineRow(r.id))} disabled={busy}>Bring back</button>
              </div>
            ))}
          </div>
        </details>
      )}
      <p className="hint">{scope === 'global' ? 'Renaming a brand, material or type also renames it on every user’s items.' : 'Renaming updates your items that use it. Changes reach the AI right away.'}</p>
    </div>
  )
}

function AddRow({ color, busy, placeholder, onAdd }: { color: boolean; busy: boolean; placeholder: string; onAdd: (label: string, hex: string) => Promise<void> }) {
  const [label, setLabel] = useState('')
  const [hex, setHex] = useState('#cccccc')
  const submit = async () => { if (!label.trim()) return; await onAdd(label, hex); setLabel('') }
  return (
    <div className="dict-row add">
      {color && <input type="color" value={hex} onChange={e => setHex(e.target.value)} aria-label="Colour" />}
      <input placeholder={placeholder} value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
      <button className="btn sm primary" onClick={submit} disabled={busy || !label.trim()}><Icon name="plus" /> Add</button>
    </div>
  )
}

function DictRowEdit({ row, color, busy, badge, onSave, onDelete, onReset }: {
  row: Row; color: boolean; busy: boolean; badge: string
  onSave: (r: Row, label: string, hex: string | null) => void; onDelete: (r: Row) => void; onReset?: () => void
}) {
  const [label, setLabel] = useState(row.label)
  const [hex, setHex] = useState(row.hex?.startsWith('#') ? row.hex : '#cccccc')
  const changed = label.trim() !== row.label || (color && row.hex?.startsWith('#') && hex !== row.hex)
  return (
    <div className="dict-row">
      {color && (row.hex?.startsWith('#') || !row.hex
        ? <input type="color" value={hex} onChange={e => setHex(e.target.value)} aria-label="Colour" />
        : <span className="dict-swatch" style={{ background: row.hex }} />)}
      <input value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && changed && onSave(row, label, hex)} />
      {badge && <span className="dict-badge">{badge}</span>}
      <span className="muted small uses" title="Your items using it">{row.uses || ''}</span>
      {changed
        ? <button className="icon-btn" onClick={() => onSave(row, label, hex)} disabled={busy} aria-label="Save"><Icon name="check" /></button>
        : <>
          {onReset && <button className="icon-btn" onClick={onReset} disabled={busy} aria-label="Back to default" title="Back to default"><Icon name="back" /></button>}
          <button className="icon-btn" onClick={() => onDelete(row)} disabled={busy} aria-label="Delete"><Icon name="trash" /></button>
        </>}
    </div>
  )
}

// Layout templates for AI images, one per purpose (TEMPLATES in lib.ts).
// 'global' edits the defaults for everyone (app_settings 'template:<id>', photos/global/reference/);
// 'user' edits own pictures (style_profile.templates[<id>]) that win over the defaults.
export function Templates({ scope }: { scope: Scope }) {
  return <>
    {TEMPLATES.map(t => (
      <div key={t.id} className="card template-card">
        <h3 className="card-title"><Icon name="image" /> {t.label}</h3>
        <TemplateEditor scope={scope} id={t.id} hint={t.hint} />
      </div>
    ))}
  </>
}

function TemplateEditor({ scope, id, hint }: { scope: Scope; id: TemplateId; hint: string }) {
  const { profile, settings, reload } = useStore()
  const [clean, setClean] = useState(false)
  const [busy, setBusy] = useState('')
  const def = settings.templates[id] ?? null
  const own = profile?.templates?.[id] ?? null
  const current = scope === 'global' ? def : own ?? def

  const store = async (path: string | null) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Please sign in again')
    if (scope === 'global') {
      const key = `template:${id}`
      fail((path
        ? await supabase.from('app_settings').upsert({ key, value: { path }, updated_at: new Date().toISOString() })
        : await supabase.from('app_settings').delete().eq('key', key)).error)
      if (def) await removePhotos(def)
    } else {
      const templates = { ...(profile?.templates ?? {}) }
      if (path) templates[id] = path; else delete templates[id]
      fail((await supabase.from('style_profile').upsert({ user_id: user.id, templates })).error)
      if (own) await removePhotos(own)
    }
  }
  const replace = async (file?: File) => {
    if (!file) return
    setBusy(clean ? 'Uploading and cleaning, about a minute…' : 'Uploading…')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Please sign in again')
      const p = await processPhoto(file)
      const dir = scope === 'global' ? 'global/reference' : `${user.id}/reference`
      let path = `${dir}/${crypto.randomUUID()}.${p.full.type.split('/')[1]}`
      fail((await supabase.storage.from('photos').upload(path, p.full, { contentType: p.full.type })).error)
      if (clean) { const raw = path; path = (await renderLook({ clean_path: raw, global: scope === 'global' })).path; await removePhotos(raw) }
      await store(path)
      await reload()
    } catch (e) { alert((e as Error).message) }
    setBusy('')
  }
  const useDefault = async () => {
    setBusy('…')
    try { await store(null); await reload() } catch (e) { alert((e as Error).message) }
    setBusy('')
  }

  return (
    <div className="form">
      <p className="hint">
        {hint} The AI copies its layout, never its clothes or person.
        {scope === 'global' ? ' Default for every user.' : own ? ' You use your own picture.' : ' You use the default picture.'}
      </p>
      {current ? <Photo path={current} alt={hint} className="look-post" /> : <p className="muted small">No picture yet: the AI uses a built-in description of the layout.</p>}
      <label className="check-row">
        <input type="checkbox" checked={clean} onChange={e => setClean(e.target.checked)} disabled={!!busy} />
        <span><b>Clean it with AI</b>: removes text, page numbers and app icons from a screenshot (OpenAI ≈5¢)</span>
      </label>
      <label className={'btn wide' + (busy ? ' disabled' : '')}>
        <Icon name="image" /> {busy || (scope === 'user' && !own ? 'Use my own picture' : 'Replace picture')}
        <input type="file" accept="image/*" hidden disabled={!!busy} onChange={e => { replace(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      {scope === 'user' && own && <button className="btn ghost wide" onClick={useDefault} disabled={!!busy}>Use the default picture</button>}
    </div>
  )
}

type UserRow = { user_id: string; email: string; display_name: string | null; role: 'admin' | 'user'; created_at: string; last_sign_in_at: string | null }

export function Users() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const { data, error } = await supabase.rpc('admin_list_users')
    if (error) alert(error.message); else setUsers(data as UserRow[])
  }
  useEffect(() => { load() }, [])
  const setRole = async (u: UserRow, role: string) => {
    setBusy(true)
    const { error } = await supabase.rpc('admin_set_role', { p_user: u.user_id, p_role: role })
    if (error) alert(error.message)
    await load(); setBusy(false)
  }
  return (
    <div className="form">
      <p className="hint">Admins manage the defaults on this Settings tab. Users only change their own lists.</p>
      <div className="dict-list">
        {users.map(u => (
          <div key={u.user_id} className="dict-row user-row">
            <span className="grow"><b>{u.display_name || u.email}</b>{u.display_name && <span className="muted small"> · {u.email}</span>}
              <span className="muted small"><br />Last seen {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : 'never'}</span></span>
            <select value={u.role} disabled={busy} onChange={e => setRole(u, e.target.value)} aria-label="Role">
              <option value="user">User</option><option value="admin">Admin</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}
