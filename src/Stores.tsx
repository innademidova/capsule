// Stores tab (#/stores): where she buys clothes or looks for them, with the website, Instagram, what they sell and a note
import { useState } from 'react'
import { supabase, CATEGORIES, type Option, type Retailer } from './lib'
import { useStore, upsert, without } from './store'
import { Icon, Chips, Header, Section, Sheet, SwipeRow } from './ui'
import { t } from './i18n'

// What a store sells: the item categories plus a few store-only tags
const TAGS: Option[] = [
  { id: 'all', label: t('stores.tag.all') }, { id: 'basics', label: t('stores.tag.basics') },
  ...CATEGORIES, { id: 'underwear', label: t('stores.tag.underwear') }, { id: 'sport', label: t('stores.tag.sport') },
]
const tagLabel = (id: string) => TAGS.find(x => x.id === id)?.label ?? id
const ALL = '*'

// The website as typed or pasted, with https and without tracking tags (utm_*, fbclid, igsh… from Instagram bios)
const TRACKING = /^(utm_\w+|fbclid|gclid|igsh|igshid|si|mc_\w+|_ga)$/i
const withHttps = (s: string) => {
  const v = s.trim()
  if (!v) return null
  const full = /^https?:\/\//i.test(v) ? v : 'https://' + v
  try {
    const u = new URL(full)
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k)
    return u.href
  } catch { return full }
}
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
// A profile link, @name or bare name: the Instagram profile link (null when it is neither)
const instaLink = (s: string) => {
  const v = s.trim()
  if (!v) return null
  if (/instagram\.com/i.test(v)) {
    const h = v.replace(/^https?:\/\//i, '').split(/[/?#]/).filter(Boolean)[1]
    return h ? `https://www.instagram.com/${h.replace(/^@/, '')}/` : null
  }
  const h = v.replace(/^@/, '')
  return /^[\w.]+$/.test(h) ? `https://www.instagram.com/${h}/` : null
}
const instaName = (url: string) => '@' + (url.split(/[/?#]/).filter(Boolean)[2] ?? '')
// "shop.mango.com" -> "Mango", "leman.in.ua" -> "Leman"
const nameFromSite = (url: string) => {
  const part = hostOf(url).replace(/^(shop|store|en|es|eu|uk|ua|m)\./, '').split('.')[0] ?? ''
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : ''
}

export function Stores() {
  const { stores } = useStore()
  const [tag, setTag] = useState(ALL)
  const [open, setOpen] = useState<Retailer | 'new' | null>(null)
  const filters: Option[] = [
    ...(stores.some(s => s.regular) ? [{ id: 'regular', label: t('stores.regularShort') }] : []),
    ...(stores.some(s => s.ukrainian) ? [{ id: 'ua', label: t('stores.ukrainianShort') }] : []),
    ...TAGS.filter(x => stores.some(s => s.tags.includes(x.id))),
  ]
  const match = (s: Retailer) => tag === ALL || (tag === 'regular' ? s.regular : tag === 'ua' ? s.ukrainian : s.tags.includes(tag))
  const list = stores.filter(match).sort((a, b) => Number(b.regular) - Number(a.regular) || a.name.localeCompare(b.name))
  return (
    <div className="screen">
      <Header title={t('nav.stores')}
        right={<button className="icon-btn" onClick={() => setOpen('new')} aria-label={t('stores.add')}><Icon name="plus" /></button>} />
      <div className="notes-body">
        <p className="notes-hint">{t('stores.hint')}</p>
        {filters.length > 1 && (
          <div className="find-filter">
            <Chips options={[{ id: ALL, label: t('common.all') }, ...filters]} value={[tag]} onChange={v => setTag(v[0] ?? ALL)} multi={false} />
          </div>
        )}
        {list.length > 0 && <div className="card store-list">{list.map(s => <StoreRow key={s.id} s={s} onEdit={() => setOpen(s)} />)}</div>}
        <button className="btn wide store-add" onClick={() => setOpen('new')}><Icon name="plus" /> {t('stores.add')}</button>
      </div>
      {open && <StoreSheet store={open === 'new' ? undefined : open} onClose={() => setOpen(null)} />}
    </div>
  )
}

// Tap the text to edit; the globe opens the website, the Instagram icon the profile
function StoreRow({ s, onEdit }: { s: Retailer; onEdit: () => void }) {
  const { setStores } = useStore()
  const del = async () => {
    if (!confirm(t('stores.confirmDelete', { name: s.name }))) return
    const { error } = await supabase.from('stores').delete().eq('id', s.id)
    if (error) return alert(error.message)
    setStores(without(s.id))
  }
  return (
    <SwipeRow onDelete={del}><div className="store-row">
      <button className="store-body" onClick={onEdit}>
        <span className="find-name">
          {s.name}
          {s.regular && <span className="pill mine">{t('stores.regularShort')}</span>}
          {s.ukrainian && <span className="pill ua">UA</span>}
        </span>
        {s.note && <span className="find-why">{s.note}</span>}
        {s.tags.length > 0 && <span className="find-meta">{s.tags.map(x => <span key={x} className="pill">{tagLabel(x)}</span>)}</span>}
      </button>
      <span className="store-links">
        {s.url
          ? <a className="store-link" href={s.url} target="_blank" rel="noopener noreferrer" title={hostOf(s.url)} aria-label={t('stores.site')}><Icon name="globe" /></a>
          : <span className="store-link" />}
        {s.instagram
          ? <a className="store-link" href={s.instagram} target="_blank" rel="noopener noreferrer" title={instaName(s.instagram)} aria-label="Instagram"><Icon name="instagram" /></a>
          : <span className="store-link" />}
      </span>
    </div></SwipeRow>
  )
}

function StoreSheet({ store, onClose }: { store?: Retailer; onClose: () => void }) {
  const { setStores } = useStore()
  const [name, setName] = useState(store?.name ?? '')
  const [url, setUrl] = useState(store?.url ?? '')
  const [insta, setInsta] = useState(store?.instagram ?? '')
  const [tags, setTags] = useState<string[]>(store?.tags ?? [])
  const [ukrainian, setUkrainian] = useState(store?.ukrainian ?? false)
  const [regular, setRegular] = useState(store?.regular ?? false)
  const [note, setNote] = useState(store?.note ?? '')
  const [busy, setBusy] = useState(false)
  const badInsta = !!insta.trim() && !instaLink(insta)

  const save = async () => {
    const row = { name: name.trim(), url: withHttps(url), instagram: instaLink(insta), tags, ukrainian, regular, note: note.trim() }
    if (!row.name || badInsta) return
    setBusy(true)
    const q = store ? supabase.from('stores').update(row).eq('id', store.id) : supabase.from('stores').insert(row)
    const { data, error } = await q.select().single()
    setBusy(false)
    if (error) return alert(error.message)
    setStores(upsert(data as Retailer)); onClose()
  }
  const del = async () => {
    if (!store || !confirm(t('stores.confirmDelete', { name: store.name }))) return
    const { error } = await supabase.from('stores').delete().eq('id', store.id)
    if (error) return alert(error.message)
    setStores(without(store.id)); onClose()
  }
  return (
    <Sheet title={store ? store.name : t('stores.new')} onClose={onClose} sticky>
      <div className="form note-form">
        <Section title={t('stores.site')}>
          <input type="url" inputMode="url" value={url} placeholder="zara.com" onChange={e => setUrl(e.target.value)}
            onBlur={() => { if (!name.trim() && url.trim()) setName(nameFromSite(withHttps(url) ?? '')) }} />
        </Section>
        <Section title={t('stores.name')}><input value={name} placeholder="Zara" onChange={e => setName(e.target.value)} /></Section>
        <Section title="Instagram">
          <input value={insta} placeholder={t('stores.instaPlaceholder')} onChange={e => setInsta(e.target.value)} />
          {badInsta && <p className="hint">{t('stores.instaBad')}</p>}
        </Section>
        <Section title={t('stores.sells')}><Chips options={TAGS} value={tags} onChange={setTags} /></Section>
        <label className="check-row"><input type="checkbox" checked={regular} onChange={e => setRegular(e.target.checked)} /><span><b>{t('stores.regular')}</b></span></label>
        <label className="check-row"><input type="checkbox" checked={ukrainian} onChange={e => setUkrainian(e.target.checked)} /><span><b>{t('stores.ukrainian')}</b></span></label>
        <Section title={t('stores.note')}><textarea rows={4} value={note} placeholder={t('stores.notePlaceholder')} onChange={e => setNote(e.target.value)} /></Section>
        <button className="btn primary wide" disabled={busy || !name.trim() || badInsta} onClick={save}>{busy ? t('common.saving') : t('common.save')}</button>
        {store && <button className="btn ghost danger" onClick={del}><Icon name="trash" /> {t('common.delete')}</button>}
      </div>
    </Sheet>
  )
}
