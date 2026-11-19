import { useRef, useState, type FormEvent } from 'react'
import { supabase, CATEGORIES, OCCASIONS, categoryLabel, labelOf, itemTitle, type ShopItem, type Note, type Item } from './lib'
import { useStore, upsert, without } from './store'
import { Icon, Header, Photo, Chips, Section, Sheet, SwipeRow } from './ui'
import { go, back } from './App'
import { t, formatDate } from './i18n'

// "Looking for" (things to find, with or without a picture or a shop) lives in the Looking for tab;
// her notes and rules ("never buy satin pajamas") live in the Notes tab and are shown only there.
// Her favourite bloggers (notes of kind 'blogger') are shown in the Inspiration tab.

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
const pathOf = (url: string) => { try { return decodeURIComponent(new URL(url).pathname).replace(/\/$/, '') } catch { return '' } }
const priorityLabel = (p: number) => t(`shop.priority.${p}`)
const linksFrom = (text: string) => text.split(/\s+/).map(l => l.trim()).filter(l => /^https?:\/\/\S+$/i.test(l))

async function saveEntry(id: string | undefined, patch: Partial<ShopItem>) {
  const q = id ? supabase.from('shopping').update(patch).eq('id', id) : supabase.from('shopping').insert(patch)
  const { data, error } = await q.select().single()
  if (error) throw error
  return data as ShopItem
}

function useCandidates(s: ShopItem) {
  const { items, wishlist } = useStore()
  const all = [...wishlist, ...items]
  return s.item_ids.map(id => all.find(i => i.id === id)).filter((i): i is Item => !!i)
}

// --- Looking for ---

const ALL = '*'

// The list is grouped by type (category) or by urgency (must-haves first); the choice is kept on this device
type FindView = 'type' | 'need'
const VIEW_KEY = 'find-view'

export function FindList() {
  const { shopping, setShopping } = useStore()
  const [cat, setCat] = useState(ALL)
  const [view, setViewS] = useState<FindView>(() => { try { return localStorage.getItem(VIEW_KEY) === 'need' ? 'need' : 'type' } catch { return 'type' } })
  const setView = (v: FindView) => { setViewS(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ } }
  const todo = shopping.filter(s => !s.done)
  const done = shopping.filter(s => s.done)
  const groupOf = (s: ShopItem) => CATEGORIES.some(c => c.id === s.category) ? s.category! : ''
  const groups = [...CATEGORIES, { id: '', label: t('notes.other') }].filter(c => todo.some(s => groupOf(s) === c.id))
  const catOrder = (s: ShopItem) => { const i = CATEGORIES.findIndex(c => c.id === s.category); return i < 0 ? CATEGORIES.length : i }
  const sections = view === 'type'
    ? groups.filter(c => cat === ALL || cat === c.id).map(c => ({
      key: c.id, label: c.label, need: 0,
      rows: todo.filter(s => groupOf(s) === c.id).sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)),
    }))
    : [1, 2, 3].map(p => ({
      key: String(p), label: priorityLabel(p), need: p,
      rows: todo.filter(s => s.priority === p && (cat === ALL || groupOf(s) === cat)).sort((a, b) => catOrder(a) - catOrder(b) || a.created_at.localeCompare(b.created_at)),
    })).filter(x => x.rows.length > 0)
  // Ticking moves the entry to "Bought" at the bottom; a toast says so and can undo it
  const [moved, setMoved] = useState<ShopItem | null>(null)
  const timer = useRef<number>(0)
  const toggle = async (s: ShopItem) => {
    try {
      setShopping(upsert(await saveEntry(s.id, { done: !s.done })))
      window.clearTimeout(timer.current)
      setMoved(s.done ? null : s)
      if (!s.done) timer.current = window.setTimeout(() => setMoved(null), 6000)
    } catch (e) { alert((e as Error).message) }
  }
  const undo = async () => {
    if (!moved) return
    window.clearTimeout(timer.current); setMoved(null)
    try { setShopping(upsert(await saveEntry(moved.id, { done: false }))) } catch (e) { alert((e as Error).message) }
  }

  if (!shopping.length) return (
    <div className="card find-empty">
      <p className="muted">{t('notes.findEmpty')}</p>
      <button className="btn primary sm" onClick={() => go('/f/new')}><Icon name="plus" /> {t('common.add')}</button>
    </div>
  )
  return (
    <>
      {todo.length > 1 && (
        <div className="seg find-view">
          {(['type', 'need'] as FindView[]).map(v => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{t(v === 'type' ? 'shop.byType' : 'shop.byNeed')}</button>
          ))}
        </div>
      )}
      {groups.length > 1 && (
        <div className="find-filter">
          <Chips options={[{ id: ALL, label: t('common.all') }, ...groups]} value={[cat]} onChange={v => setCat(v[0] ?? ALL)} multi={false} />
        </div>
      )}
      {sections.map(x => (
        <section key={x.key} className="find-group">
          <h3 className={'group-title' + (x.need ? ` need-${x.need}` : '')}>{x.label} <span>{x.rows.length}</span></h3>
          <div className="card find-list">{x.rows.map(s => <FindRow key={s.id} s={s} onToggle={toggle} byNeed={view === 'need'} />)}</div>
        </section>
      ))}
      {done.length > 0 && (
        <details className="card done-list find-done">
          <summary className="muted small">{t('shop.bought', { count: done.length })}</summary>
          <div className="find-list">{done.map(s => <FindRow key={s.id} s={s} onToggle={toggle} />)}</div>
        </details>
      )}
      {moved && (
        <div className="toast" role="status">
          <span>{t('shop.movedToBought', { name: moved.name })}</span>
          <button className="toast-btn" onClick={undo}>{t('shop.undo')}</button>
        </div>
      )}
    </>
  )
}

// byNeed: the list is grouped by urgency, so the row shows its type instead of the urgency pills
function FindRow({ s, onToggle, byNeed }: { s: ShopItem; onToggle: (s: ShopItem) => void; byNeed?: boolean }) {
  const cands = useCandidates(s)
  const { setShopping } = useStore()
  const del = async () => {
    if (!confirm(t('notes.confirmDelete', { name: s.name }))) return
    const { error } = await supabase.from('shopping').delete().eq('id', s.id)
    if (error) return alert(error.message)
    setShopping(without(s.id))
  }
  const showCat = byNeed && !!s.category
  const meta = (s.priority === 3 && !byNeed) || showCat || s.occasions.length > 0 || s.links.length > 0 || cands.length > 0
  return (
    <SwipeRow onDelete={del}><div className={'find-row' + (s.done ? ' done' : '')}>
      <button className={'check' + (s.done ? ' on' : '')} onClick={() => onToggle(s)}
        aria-label={s.done ? t('shop.markNotBought') : t('shop.markBought')} title={s.done ? t('shop.markNotBought') : t('shop.markBought')}><Icon name="check" /></button>
      <button className="find-body" onClick={() => go(`/f/${s.id}`)}>
        <span className="find-name">{s.name}{s.priority === 1 && !s.done && !byNeed && <span className="pill p1">{priorityLabel(1)}</span>}</span>
        {s.why && <span className="find-why">{s.why}</span>}
        {meta && (
          <span className="find-meta">
            {showCat && <span className="pill">{categoryLabel(s.category!)}</span>}
            {s.priority === 3 && !byNeed && <span className="pill p3">{priorityLabel(3)}</span>}
            {s.occasions.map(o => <span key={o} className="pill">{labelOf(OCCASIONS, o)}</span>)}
            {s.links.length > 0 && <span className="find-count"><Icon name="link" />{s.links.length}</span>}
            {cands.length > 0 && (
              <span className="find-thumbs">
                {cands.slice(0, 4).map(i => <Photo key={i.id} path={i.thumb_path ?? i.photo_path} alt="" />)}
                {cands.length > 4 && <span className="find-more">+{cands.length - 4}</span>}
              </span>
            )}
          </span>
        )}
      </button>
    </div></SwipeRow>
  )
}

export function FindDetail({ entry }: { entry?: ShopItem }) {
  const [editing, setEditing] = useState(!entry)
  if (!entry || editing) return (
    <FindForm entry={entry}
      onSaved={s => { if (entry) setEditing(false); else location.replace(`#/f/${s.id}`) }}
      onCancel={() => entry ? setEditing(false) : back('/shop')} />
  )
  return <FindView entry={entry} onEdit={() => setEditing(true)} />
}

function FindView({ entry, onEdit }: { entry: ShopItem; onEdit: () => void }) {
  const { wishlist, setShopping } = useStore()
  const [picking, setPicking] = useState(false)
  const cands = useCandidates(entry)
  const update = async (patch: Partial<ShopItem>) => {
    try { setShopping(upsert(await saveEntry(entry.id, patch))) } catch (e) { alert((e as Error).message) }
  }
  const pick = (id: string, on: boolean) => {
    const rest = entry.item_ids.filter(x => x !== id)
    update({ item_ids: on ? [...rest, id] : rest })
  }
  // Pieces of the same category first
  const choices = [...wishlist].sort((a, b) => Number(b.category === entry.category) - Number(a.category === entry.category))

  return (
    <div className="screen">
      <Header title="" left={<button className="icon-btn" onClick={() => back('/shop')} aria-label={t('common.back')}><Icon name="back" /></button>}
        right={<button className="icon-btn" onClick={onEdit} aria-label={t('common.edit')}><Icon name="edit" /></button>} />
      <div className="find-detail">
        <p className="eyebrow">{[entry.category && categoryLabel(entry.category), priorityLabel(entry.priority)].filter(Boolean).join(' · ')}</p>
        <h2 className="find-title">{entry.name}</h2>
        {entry.occasions.length > 0 && <div className="find-meta">{entry.occasions.map(o => <span key={o} className="pill">{labelOf(OCCASIONS, o)}</span>)}</div>}
        {entry.why && <div className="card notes">{entry.why}</div>}
        {entry.links.length > 0 && (
          <div className="card">
            <h3 className="card-title"><Icon name="link" /> {t('notes.where')}</h3>
            <div className="link-list">
              {entry.links.map(l => (
                <a key={l} className="link-row" href={l} target="_blank" rel="noopener noreferrer">
                  <b>{hostOf(l)}</b><span className="muted small">{pathOf(l)}</span>
                </a>
              ))}
            </div>
          </div>
        )}
        <div className="card">
          <h3 className="card-title"><Icon name="heart" /> {t('notes.candidates')}</h3>
          {cands.length > 0 ? (
            <div className="mini-list">
              {cands.map(i => (
                <button key={i.id} className={'mini' + (i.wishlist ? '' : ' owned')} onClick={() => go(`/i/${i.id}`)}>
                  <Photo path={i.thumb_path ?? i.photo_path} alt="" />
                  <span>{itemTitle(i)}</span>
                </button>
              ))}
            </div>
          ) : <p className="muted small">{t('notes.candidatesEmpty')}</p>}
          <button className="btn sm" onClick={() => setPicking(p => !p)}><Icon name={picking ? 'check' : 'plus'} /> {picking ? t('common.done') : t('notes.pick')}</button>
          {picking && (choices.length ? (
            <div className="pick-grid">
              {choices.map(i => {
                const on = entry.item_ids.includes(i.id)
                return (
                  <button key={i.id} className={'pick' + (on ? ' on' : '')} onClick={() => pick(i.id, !on)} aria-pressed={on}>
                    <Photo path={i.thumb_path ?? i.photo_path} alt={itemTitle(i)} />
                    {on && <span className="badge"><Icon name="check" /></span>}
                  </button>
                )
              })}
            </div>
          ) : <p className="muted small">{t('inspo.noWish')}</p>)}
        </div>
        <button className={'btn wide' + (entry.done ? '' : ' primary')} onClick={() => update({ done: !entry.done })}>
          <Icon name="check" /> {entry.done ? t('notes.backToList') : t('shop.markBought')}
        </button>
      </div>
    </div>
  )
}

function FindForm({ entry, onSaved, onCancel }: { entry?: ShopItem; onSaved: (s: ShopItem) => void; onCancel: () => void }) {
  const { setShopping } = useStore()
  const [name, setName] = useState(entry?.name ?? '')
  const [cat, setCat] = useState<string[]>(entry?.category ? [entry.category] : [])
  const [prio, setPrio] = useState(entry?.priority ?? 2)
  const [occ, setOcc] = useState<string[]>(entry?.occasions ?? [])
  const [why, setWhy] = useState(entry?.why ?? '')
  const [links, setLinks] = useState((entry?.links ?? []).join('\n'))
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const s = await saveEntry(entry?.id, {
        name: name.trim(), category: cat[0] ?? null, priority: prio, occasions: occ, why: why.trim() || null, links: linksFrom(links),
      })
      setShopping(upsert(s)); onSaved(s)
    } catch (err) { alert((err as Error).message); setBusy(false) }
  }
  const del = async () => {
    if (!entry || !confirm(t('notes.confirmDelete', { name: entry.name }))) return
    const { error } = await supabase.from('shopping').delete().eq('id', entry.id)
    if (error) return alert(error.message)
    setShopping(without(entry.id)); back('/shop')
  }

  return (
    <div className="screen">
      <Header title={entry ? t('common.edit') : t('notes.newFind')}
        left={<button type="button" className="icon-btn" onClick={onCancel} aria-label={t('common.back')}><Icon name="back" /></button>} />
      <form className="form" onSubmit={submit}>
        <Section title={t('notes.name')}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('notes.namePlaceholder')} autoFocus={!entry} />
        </Section>
        <Section title={t('field.category')}><Chips options={CATEGORIES} value={cat} onChange={setCat} multi={false} /></Section>
        <Section title={t('notes.priority')}>
          <div className="seg prio-seg">
            {[1, 2, 3].map(p => <button type="button" key={p} className={prio === p ? 'on' : ''} onClick={() => setPrio(p)}>{priorityLabel(p)}</button>)}
          </div>
        </Section>
        <Section title={t('field.occasion')}><Chips options={OCCASIONS} value={occ} onChange={setOcc} /></Section>
        <Section title={t('notes.details')}>
          <textarea rows={5} value={why} onChange={e => setWhy(e.target.value)} placeholder={t('notes.detailsPlaceholder')} />
        </Section>
        <Section title={t('notes.links')}>
          <textarea rows={3} value={links} onChange={e => setLinks(e.target.value)} placeholder={t('notes.linksPlaceholder')} autoCapitalize="none" autoCorrect="off" />
        </Section>
        <button className="btn primary wide" disabled={busy || !name.trim()}>{busy ? t('common.saving') : t('common.save')}</button>
        {entry && <button type="button" className="btn ghost danger" onClick={del}><Icon name="trash" /> {t('common.delete')}</button>}
      </form>
    </div>
  )
}

// On a wishlist piece: which "Looking for" entries it could close
export function ForEntries({ item }: { item: Item }) {
  const { shopping } = useStore()
  const list = shopping.filter(s => s.item_ids.includes(item.id))
  if (!list.length) return null
  return (
    <div className="card">
      <h3 className="card-title"><Icon name="search" /> {t('notes.forEntries')}</h3>
      <div className="chips">{list.map(s => <button key={s.id} className="chip" onClick={() => go(`/f/${s.id}`)}>{s.name}</button>)}</div>
    </div>
  )
}

// After "I bought it": offer to tick off the entries this piece was a candidate for
export async function closeEntries(item: Item, shopping: ShopItem[], setShopping: (f: (x: ShopItem[]) => ShopItem[]) => void) {
  for (const s of shopping.filter(x => !x.done && x.item_ids.includes(item.id))) {
    if (!confirm(t('notes.alsoDone', { name: s.name }))) continue
    try { setShopping(upsert(await saveEntry(s.id, { done: true }))) } catch (e) { alert((e as Error).message) }
  }
}

// --- Notes tab: her notes, with the shopping rules folded into one block on top ---

const RULES_KEY = 'notes-rules-open'

// #/notes/rules opens the rules block; otherwise it stays as she left it on this device
export function NotesScreen({ showRules }: { showRules?: boolean }) {
  const delNote = useDeleteNote()
  const { notes } = useStore()
  const [open, setOpen] = useState<Note | null>(null)
  const list = notes.filter(n => n.kind === 'insight')
  return (
    <div className="screen">
      <Header title={t('nav.notes')} />
      <div className="notes-body">
        <p className="notes-hint">{t('notes.insightsHint')}</p>
        <RulesBlock showRules={showRules} />
        {list.length > 0 && (
          <div className="insights">
            {list.map((n, i) => (
              <SwipeRow key={n.id} card onDelete={() => delNote(n)}><button className="card insight" onClick={() => setOpen(n)}>
                <span className="insight-num">{String(i + 1).padStart(2, '0')}</span>
                {n.title && <b className="insight-title">{n.title}</b>}
                {n.body && <span className="insight-body">{n.body}</span>}
                <span className="muted small">{formatDate(n.created_at)}</span>
              </button></SwipeRow>
            ))}
          </div>
        )}
        <Composer kind="insight" />
        {open && <NoteSheet note={open} onClose={() => setOpen(null)} />}
      </div>
    </div>
  )
}

const replace = (n: Note) => (list: Note[]) => list.map(x => x.id === n.id ? n : x)

// Her shopping rules as one folding card: folded it shows the main rule, open it lists all of them and adds new ones
function RulesBlock({ showRules }: { showRules?: boolean }) {
  const delNote = useDeleteNote()
  const { notes } = useStore()
  const [edit, setEdit] = useState<Note | null>(null)
  const [open, setOpenS] = useState(() => {
    if (showRules) return true
    try { return localStorage.getItem(RULES_KEY) === '1' } catch { return false }
  })
  const toggle = () => {
    setOpenS(!open)
    try { localStorage.setItem(RULES_KEY, open ? '0' : '1') } catch { /* private mode */ }
  }
  const rules = notes.filter(n => n.kind === 'rule')
  const main = rules.filter(n => n.pinned)
  const rest = rules.filter(n => !n.pinned)
  return (
    <div className={'card rules-block' + (open ? ' open' : '')}>
      <button className="rules-head" onClick={toggle} aria-expanded={open}>
        <span className="rule-mark"><Icon name="ban" /></span>
        <span className="rules-head-text">
          <b>{t('notes.rules')}{rules.length > 0 && <span className="seg-count">{rules.length}</span>}</b>
          <span className="muted small">{open || !main[0]?.title ? t('notes.rulesHint') : main[0].title}</span>
        </span>
        <span className="rules-chevron"><Icon name="chevron" /></span>
      </button>
      {open && (
        <div className="rules-inner">
          {main.map(n => <MainRule key={n.id} n={n} onEdit={() => setEdit(n)} />)}
          {rest.length > 0 && (
            <div className="rule-list">
              {rest.map(n => (
                <SwipeRow key={n.id} onDelete={() => delNote(n)}><button className="rule-row" onClick={() => setEdit(n)}>
                  <span className="rule-mark"><Icon name="ban" /></span>
                  <span className="rule-text"><b>{n.title || n.body}</b>{n.title && n.body && <span className="muted">{n.body}</span>}</span>
                </button></SwipeRow>
              ))}
            </div>
          )}
          <Composer kind="rule" />
        </div>
      )}
      {edit && <NoteSheet note={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function MainRule({ n, onEdit }: { n: Note; onEdit: () => void }) {
  const [full, setFull] = useState(false)
  // Folded: only the first paragraph, at most four lines
  const [first, ...more] = n.body.split(/\n\s*\n/)
  const long = more.length > 0 || first.length > 240
  return (
    <div className="rule-main">
      <div className="row"><span className="eyebrow grow">{t('notes.main')}</span>
        <button className="icon-btn sm" onClick={onEdit} aria-label={t('common.edit')}><Icon name="edit" /></button></div>
      <b className="rule-main-title">{n.title}</b>
      {n.body && <p className={'rule-main-body' + (long && !full ? ' clamp' : '')}>{full ? n.body : first}</p>}
      {long && <button className="link-btn" onClick={() => setFull(f => !f)}>{full ? t('notes.showLess') : t('notes.showAll')}</button>}
    </div>
  )
}

// A profile link or @name: what to show and where it leads (a bare name is an Instagram account)
export function profileOf(raw: string): { title: string; url: string } | null {
  const s = raw.trim().replace(/[,;]+$/, '')
  if (!s) return null
  if (!/[/:]/.test(s)) {
    const h = s.replace(/^@/, '')
    return /^[\w.]+$/.test(h) ? { title: '@' + h, url: `https://www.instagram.com/${h}/` } : null
  }
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s)
    const host = u.hostname.replace(/^www\./, '')
    const first = u.pathname.split('/').filter(Boolean)[0] ?? ''
    if (host.endsWith('instagram.com') && first) {
      const h = first.replace(/^@/, '')
      return { title: '@' + h, url: `https://www.instagram.com/${h}/` }
    }
    if (host.endsWith('tiktok.com') && first.startsWith('@')) return { title: first, url: `https://www.tiktok.com/${first}` }
    return { title: first ? `${host}/${first}` : host, url: u.href }
  } catch { return null }
}

// Inspiration tab -> Bloggers (#/inspo/bloggers): her favourite fashion bloggers.
// Tap opens the profile, the pencil edits the note; several links can be pasted at once
export function Bloggers() {
  const delNote = useDeleteNote()
  const { notes, inspirations, setNotes } = useStore()
  const [open, setOpen] = useState<Note | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const list = notes.filter(n => n.kind === 'blogger')
  const add = async () => {
    const have = new Set(list.map(n => n.url))
    const found = text.split(/\s+/).map(profileOf).filter((p): p is { title: string; url: string } => !!p && !have.has(p.url))
    const rows = found.filter((p, i) => found.findIndex(q => q.url === p.url) === i)
    if (!rows.length) return setText('')
    setBusy(true)
    const { data, error } = await supabase.from('notes').insert(rows.map(p => ({ kind: 'blogger', ...p }))).select()
    setBusy(false)
    if (error) return alert(error.message)
    setNotes(x => [...x, ...(data as Note[])]); setText('')
  }
  return (
    <>
      <p className="notes-hint">{t('notes.bloggersHint')}</p>
      {list.length > 0 && (
        <div className="card blogger-list">
          {list.map(n => {
            // Her saved looks from this blogger: a few thumbnails, tap shows them all
            const looks = inspirations.filter(i => i.blogger_id === n.id)
            return (
              <SwipeRow key={n.id} onDelete={() => delNote(n)}><div className="blogger-row">
                <a className="blogger-link" href={n.url ?? undefined} target="_blank" rel="noopener noreferrer" title={t('notes.openProfile')}>
                  <span className="blogger-ava">{n.title.replace(/^@/, '').charAt(0).toUpperCase()}</span>
                  <span className="blogger-text"><b>{n.title}</b>{n.body && <span className="muted small">{n.body}</span>}</span>
                </a>
                {looks.length > 0 && (
                  <button className="blogger-looks" onClick={() => go(`/inspo/by/${n.id}`)} aria-label={t('inspo.byBlogger', { name: n.title })}>
                    {looks.slice(0, 3).map(i => <Photo key={i.id} path={i.thumb_path ?? i.image_path} alt="" className="cover" />)}
                    {looks.length > 3 && <span className="find-more">+{looks.length - 3}</span>}
                  </button>
                )}
                <button className="icon-btn" onClick={() => setOpen(n)} aria-label={t('common.edit')}><Icon name="edit" /></button>
              </div></SwipeRow>
            )
          })}
        </div>
      )}
      <div className="composer">
        <textarea rows={1} value={text} placeholder={t('notes.bloggerPlaceholder')} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); add() } }} />
        <button className="composer-send" disabled={busy || !text.trim()} onClick={add} aria-label={t('common.add')}><Icon name="send" /></button>
      </div>
      {open && <NoteSheet note={open} onClose={() => setOpen(null)} />}
    </>
  )
}

// Quick capture like a chat with yourself: the first line becomes the title, the rest the text
function Composer({ kind }: { kind: Note['kind'] }) {
  const { setNotes } = useStore()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const grow = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }
  const send = async () => {
    const [first, ...rest] = text.trim().split('\n')
    if (!first?.trim()) return
    setBusy(true)
    const { data, error } = await supabase.from('notes').insert({ kind, title: first.trim(), body: rest.join('\n').trim() }).select().single()
    setBusy(false)
    if (error) return alert(error.message)
    setNotes(x => [...x, data as Note]); setText('')
    requestAnimationFrame(grow)
  }
  return (
    <div className="composer">
      <textarea ref={ref} rows={1} value={text} onChange={e => { setText(e.target.value); grow() }}
        placeholder={t(kind === 'rule' ? 'notes.rulePlaceholder' : 'notes.insightPlaceholder')} />
      <button className="composer-send" disabled={busy || !text.trim()} onClick={send} aria-label={t('common.add')}><Icon name="send" /></button>
    </div>
  )
}

function NoteSheet({ note, onClose }: { note: Note; onClose: () => void }) {
  const { setNotes } = useStore()
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [pinned, setPinned] = useState(note.pinned)
  const [url, setUrl] = useState(note.url ?? '')
  const [kind, setKind] = useState(note.kind)
  const [busy, setBusy] = useState(false)
  const blogger = note.kind === 'blogger'
  const save = async () => {
    setBusy(true)
    // A note can become a rule and back; only a rule can be the main one
    const patch = { title: title.trim(), body: body.trim(), kind, pinned: kind === 'rule' && pinned, ...(blogger ? { url: url.trim() || null } : {}) }
    const { data, error } = await supabase.from('notes').update(patch).eq('id', note.id).select().single()
    setBusy(false)
    if (error) return alert(error.message)
    setNotes(replace(data as Note)); onClose()
  }
  const del = async () => {
    if (!confirm(t('notes.confirmDeleteNote'))) return
    const { error } = await supabase.from('notes').delete().eq('id', note.id)
    if (error) return alert(error.message)
    setNotes(without(note.id)); onClose()
  }
  return (
    <Sheet title={t(`notes.${kind}`)} onClose={onClose}>
      <div className="form note-form">
        <Section title={t(blogger ? 'notes.handle' : 'notes.title')}><input value={title} onChange={e => setTitle(e.target.value)} /></Section>
        {blogger && <Section title={t('notes.profileLink')}><input type="url" value={url} onChange={e => setUrl(e.target.value)} /></Section>}
        <Section title={t(blogger ? 'notes.likeWhat' : 'notes.text')}>
          <textarea rows={blogger ? 4 : 8} value={body} placeholder={blogger ? t('notes.likeWhatPlaceholder') : undefined} onChange={e => setBody(e.target.value)} />
        </Section>
        {!blogger && (
          <label className="check-row"><input type="checkbox" checked={kind === 'rule'} onChange={e => setKind(e.target.checked ? 'rule' : 'insight')} /><span><b>{t('notes.isRule')}</b></span></label>
        )}
        {kind === 'rule' && (
          <label className="check-row"><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /><span><b>{t('notes.pin')}</b></span></label>
        )}
        <button className="btn primary wide" disabled={busy || !(title.trim() || body.trim())} onClick={save}>{busy ? t('common.saving') : t('common.save')}</button>
        <button className="btn ghost danger" onClick={del}><Icon name="trash" /> {t('common.delete')}</button>
      </div>
    </Sheet>
  )
}

// Delete a note, rule or blogger straight from a list (swipe or hover)
function useDeleteNote() {
  const { setNotes } = useStore()
  return async (n: Note) => {
    if (!confirm(t('notes.confirmDeleteNote'))) return
    const { error } = await supabase.from('notes').delete().eq('id', n.id)
    if (error) return alert(error.message)
    setNotes(without(n.id))
  }
}
