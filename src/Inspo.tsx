import { useRef, useState } from 'react'
import {
  supabase, processPhoto, uploadPhoto, uploadExtraPhoto, removePhotos, askAI, categoryLabel, itemTitle, linkInspo, looksFor,
  type Inspiration, type AIRequest, type ShopItem, type Item, type Note,
} from './lib'
import { useStore, upsert, without } from './store'
import { Icon, Header, Photo, AIActions, RequestState, Carousel } from './ui'
import { go, back } from './App'
import { Bloggers, profileOf } from './Notes'
import { t } from './i18n'

export type InspoTab = 'photos' | 'bloggers'

// Two parts: her inspiration photos (#/inspo, or one blogger's looks at #/inspo/by/<blogger note id>)
// and her favourite bloggers (#/inspo/bloggers)
function InspoTabs({ tab }: { tab: InspoTab }) {
  const { inspirations, notes } = useStore()
  const tabs: { id: InspoTab; path: string; count: number }[] = [
    { id: 'photos', path: '/inspo', count: inspirations.length },
    { id: 'bloggers', path: '/inspo/bloggers', count: notes.filter(n => n.kind === 'blogger').length },
  ]
  return (
    <div className="seg screen-seg" role="tablist">
      {tabs.map(x => (
        <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => location.hash !== '#' + x.path && location.replace('#' + x.path)}>
          {t(`inspo.tab.${x.id}`)}{x.count > 0 && <span className="seg-count">{x.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function InspoList({ tab, blogger }: { tab: InspoTab; blogger?: string }) {
  if (tab === 'bloggers') return (
    <div className="screen">
      <Header title={t('inspo.title')} />
      <InspoTabs tab={tab} />
      <div className="notes-body"><Bloggers /></div>
    </div>
  )
  return <InspoPhotos blogger={blogger} />
}

function InspoPhotos({ blogger }: { blogger?: string }) {
  const { inspirations, notes, profile, requests, setInspirations, setRequests, reload } = useStore()
  // One blogger's looks: photos added here are marked as theirs
  const by = blogger ? notes.find(n => n.id === blogger) : undefined
  const shown = blogger ? inspirations.filter(i => i.blogger_id === blogger) : inspirations
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [fBusy, setFBusy] = useState(false)
  const analyzed = inspirations.filter(i => i.analysis).length
  const formulaReq = requests.find(r => r.kind === 'formulas')

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    let last: Inspiration | null = null
    try {
      for (const f of [...files]) {
        const paths = await uploadPhoto(await processPhoto(f))
        const { data, error } = await supabase.from('inspirations').insert({ image_path: paths.photo_path, thumb_path: paths.thumb_path, blogger_id: by?.id ?? null }).select().single()
        if (error) throw error
        last = data as Inspiration; setInspirations(upsert(last))
      }
      if (files.length === 1 && last) go(`/n/${last.id}`)
    } catch (e) { alert((e as Error).message) }
    setBusy(false)
  }
  const findFormulas = async (mode: 'now') => {
    setFBusy(true)
    try { setRequests(upsert(await askAI('formulas', {}, mode))); if (mode === 'now') await reload() }
    catch (e) { const r = (e as { request?: AIRequest }).request; if (r) setRequests(upsert(r)); else alert((e as Error).message) }
    setFBusy(false)
  }

  return (
    <div className="screen">
      <Header title={t('inspo.title')} right={
        <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label={t('inspo.add')}><Icon name="plus" /></button>
      } />
      <InspoTabs tab="photos" />
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { add(e.target.files); e.target.value = '' }} />

      {blogger ? (
        <div className="by-blogger">
          <span className="blogger-ava">{(by?.title ?? '?').replace(/^@/, '').charAt(0).toUpperCase()}</span>
          <span className="grow"><b>{t('inspo.byBlogger', { name: by?.title ?? '' })}</b>
            {by?.url && <a className="muted small" href={by.url} target="_blank" rel="noopener noreferrer">{t('notes.openProfile')}</a>}</span>
          <button className="icon-btn" onClick={() => location.replace('#/inspo')} aria-label={t('common.close')}><Icon name="x" /></button>
        </div>
      ) : <div className="card formulas">
        <h3 className="card-title"><Icon name="wand" /> {t('inspo.formulas')}</h3>
        {profile?.summary ? (
          <>
            <p className="pre">{profile.summary}</p>
            <div className="formula-list">
              {profile.formulas.map((f, n) => <div key={n} className="formula"><b>{f.title}</b><span>{f.recipe}</span></div>)}
            </div>
            {profile.palette.length > 0 && <p className="muted small">{t('inspo.palette', { list: profile.palette.join(', ') })}</p>}
            {profile.key_pieces.length > 0 && <p className="muted small">{t('inspo.keyPieces', { list: profile.key_pieces.join(', ') })}</p>}
            <p className="muted small">{t('inspo.basedOn', { count: profile.based_on })}</p>
          </>
        ) : <p className="muted">{t('inspo.formulasHint')}</p>}
        {formulaReq?.status !== 'done' && <RequestState req={formulaReq} />}
        <AIActions label={profile?.summary ? t('inspo.updateFormulas') : t('inspo.findFormulas')} onRun={findFormulas} busy={fBusy}
          disabled={analyzed < 2} />
        {analyzed < 2 && <p className="hint">{t('inspo.needTwo', { count: analyzed })}</p>}
      </div>}

      {blogger && !shown.length ? <p className="muted center pad">{t('inspo.byBloggerEmpty')}</p> : shown.length === 0 ? (
        <div className="empty">
          <Icon name="image" />
          <h2>{t('inspo.empty')}</h2>
          <p className="muted">{t('inspo.emptyHint')}</p>
          <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="plus" /> {busy ? t('common.uploading') : t('inspo.add')}</button>
        </div>
      ) : (
        <div className="grid inspo-grid">
          {shown.map(i => (
            <button key={i.id} className="inspo-tile" onClick={() => go(`/n/${i.id}`)}>
              <Photo path={i.thumb_path ?? i.image_path} alt="" className="cover" />
              {i.more_photos?.length > 0 && <span className="tile-multi" title={t('inspo.photos', { count: i.more_photos.length + 1 })}><Icon name="layers" /></span>}
              {i.analysis ? <span className="badge"><Icon name="check" /></span>
                : requests.some(r => r.kind === 'inspo' && r.input.inspiration_id === i.id && r.status === 'queued') && <span className="badge"><Icon name="clock" /></span>}
            </button>
          ))}
        </div>
      )}
      {busy && <p className="hint">{t('common.uploading')}</p>}
    </div>
  )
}


export function InspoDetail({ insp }: { insp: Inspiration }) {
  const { items, requests, setInspirations, setRequests, setShopping } = useStore()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(insp.note ?? '')
  const req = requests.find(r => r.kind === 'inspo' && r.input.inspiration_id === insp.id)
  const a = insp.analysis
  // More photos of the same look (an Instagram carousel), added and removed right here
  const more = insp.more_photos ?? []
  const moreRef = useRef<HTMLInputElement>(null)
  const [adding, setAdding] = useState(false)
  const setMore = async (next: string[]) => {
    const { data, error } = await supabase.from('inspirations').update({ more_photos: next }).eq('id', insp.id).select().single()
    if (error) throw error
    setInspirations(upsert(data as Inspiration))
  }
  const addMore = async (files: FileList | null) => {
    if (!files?.length) return
    setAdding(true)
    try { const added: string[] = []; for (const f of [...files]) added.push(await uploadExtraPhoto(f)); await setMore([...more, ...added]) }
    catch (e) { alert((e as Error).message) }
    setAdding(false)
  }
  const removeMore = async (path: string) => {
    if (!confirm(t('item.confirmDeletePhoto'))) return
    try { await setMore(more.filter(p => p !== path)); await removePhotos(path) } catch (e) { alert((e as Error).message) }
  }

  const run = async (mode: 'now') => {
    setBusy(true)
    if (note !== (insp.note ?? '')) await supabase.from('inspirations').update({ note: note || null }).eq('id', insp.id)
    try {
      const r = await askAI('inspo', { inspiration_id: insp.id }, mode)
      setRequests(upsert(r))
      if (r.status === 'done') setInspirations(upsert({ ...insp, note: note || null, analysis: r.result }))
    } catch (e) { const r = (e as { request?: AIRequest }).request; if (r) setRequests(upsert(r)); else alert((e as Error).message) }
    setBusy(false)
  }
  const del = async () => {
    if (!confirm(t('inspo.confirmDelete'))) return
    await supabase.from('inspirations').delete().eq('id', insp.id)
    await removePhotos(insp.image_path, insp.thumb_path, ...more)
    setInspirations(without(insp.id)); back('/inspo')
  }
  const toList = async (name: string) => {
    const { data, error } = await supabase.from('shopping').insert({ name, why: t('inspo.fromLook', { formula: a?.formula ?? '' }), priority: 2 }).select().single()
    if (error) return alert(error.message)
    setShopping(upsert(data as ShopItem)); alert(t('inspo.added', { name }))
  }

  return (
    <div className="screen">
      <Header title="" left={<button className="icon-btn" onClick={() => back('/inspo')} aria-label={t('common.back')}><Icon name="back" /></button>}
        right={<button className="icon-btn" onClick={del} aria-label={t('common.delete')}><Icon name="trash" /></button>} />
      <div className="detail">
        <div className="carousel">
          {more.length > 0
            ? <Carousel paths={[insp.image_path, ...more]} alt="" onRemove={removeMore} photoClass="big cover-big" />
            : <Photo path={insp.image_path} alt="" className="big cover-big" zoom />}
          <input ref={moreRef} type="file" accept="image/*" multiple hidden onChange={e => { addMore(e.target.files); e.target.value = '' }} />
          <button className="btn ghost sm" onClick={() => moreRef.current?.click()} disabled={adding}><Icon name="plus" /> {adding ? t('common.uploading') : t('item.addPhotos')}</button>
        </div>
        <div className="detail-info">
          <BloggerPick insp={insp} />
          <LinkedItems insp={insp} />
          {!a && (
            <>
              <textarea rows={2} placeholder={t('inspo.notePlaceholder')} value={note} onChange={e => setNote(e.target.value)} />
              <AIActions label={t('inspo.analyze')} onRun={run} busy={busy} />
              <RequestState req={req} />
            </>
          )}
          {a && (
            <>
              <p className="eyebrow">{a.tags.join(' · ')}</p>
              <div className="card formula-big"><span className="muted small">{t('inspo.formula')}</span><b>{a.formula}</b></div>
              <p>{a.summary}</p>
              <div className="card">
                <h3 className="card-title">{t('outfits.pieces')}</h3>
                <div className="pieces">
                  {a.pieces.map((p, n) => {
                    const own = p.item_ids.map(id => items.find(i => i.id === id)).filter((i): i is Item => !!i)
                    return (
                      <div key={n} className={'piece ' + p.status}>
                        <div className="piece-head"><b>{p.piece}</b><span className={'pill ' + p.status}>{t(`inspo.status.${p.status}`)}</span></div>
                        <span className="muted small">{categoryLabel(p.category)}{p.note ? ` · ${p.note}` : ''}</span>
                        {own.length > 0 && (
                          <div className="mini-list">
                            {own.map(i => <button key={i.id} className="mini" onClick={() => go(`/i/${i.id}`)}><Photo path={i.thumb_path ?? i.photo_path} alt="" /><span>{itemTitle(i)}</span></button>)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              {a.to_buy.length > 0 && (
                <div className="card">
                  <h3 className="card-title">{t('inspo.worthBuying')}</h3>
                  {a.to_buy.map((x, n) => (
                    <div key={n} className="row buy-row"><span className="grow">{x}</span><button className="btn sm" onClick={() => toList(x)}><Icon name="plus" /> {t('shop.toList')}</button></div>
                  ))}
                </div>
              )}
              {insp.note && <p className="muted small">{t('inspo.yourNote', { note: insp.note })}</p>}
              <button className="btn ghost sm" onClick={() => run('now')} disabled={busy}>{busy ? t('common.thinking') : `${t('inspo.analyzeAgain')} (OpenAI ≈2¢)`}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const NEW = '+new'

// Optional: which of her bloggers this look comes from (a random look has none). A new blogger can be added right here.
function BloggerPick({ insp }: { insp: Inspiration }) {
  const { notes, inspirations, setNotes, setInspirations } = useStore()
  const bloggers = notes.filter(n => n.kind === 'blogger').sort((a, b) => a.title.localeCompare(b.title))
  const cur = bloggers.find(b => b.id === insp.blogger_id)
  const more = cur ? inspirations.filter(i => i.blogger_id === cur.id).length : 0
  const set = async (blogger_id: string | null) => {
    const { data, error } = await supabase.from('inspirations').update({ blogger_id }).eq('id', insp.id).select().single()
    if (error) return alert(error.message)
    setInspirations(upsert(data as Inspiration))
  }
  const pick = async (v: string) => {
    if (v !== NEW) return set(v || null)
    const p = profileOf(prompt(t('notes.bloggerPlaceholder')) ?? '')
    if (!p) return
    const have = bloggers.find(b => b.url === p.url)
    if (have) return set(have.id)
    const { data, error } = await supabase.from('notes').insert({ kind: 'blogger', ...p }).select().single()
    if (error) return alert(error.message)
    setNotes(x => [...x, data as Note])
    await set((data as Note).id)
  }
  return (
    <div className="card insp-blogger">
      <div className="row">
        <span className="blogger-ava">{cur ? cur.title.replace(/^@/, '').charAt(0).toUpperCase() : <Icon name="user" />}</span>
        <label className="grow"><span className="eyebrow">{t('inspo.blogger')}</span>
          <select value={cur?.id ?? ''} onChange={e => pick(e.target.value)}>
            <option value="">{t('inspo.noBlogger')}</option>
            {bloggers.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
            <option value={NEW}>{t('inspo.newBlogger')}</option>
          </select>
        </label>
        {cur?.url && <a className="store-link" href={cur.url} target="_blank" rel="noopener noreferrer" title={t('notes.openProfile')} aria-label={t('notes.openProfile')}>
          <Icon name={cur.url.includes('instagram.com') ? 'instagram' : 'link'} /></a>}
      </div>
      {more > 1 && <button className="link-btn" onClick={() => go(`/inspo/by/${cur!.id}`)}>{t('inspo.allFrom', { name: cur!.title, count: more })}</button>}
    </div>
  )
}

// Pieces linked to a look by hand: wishlist pieces to buy, and similar pieces she already owns
function LinkedItems({ insp }: { insp: Inspiration }) {
  const { items, wishlist } = useStore()
  return (
    <div className="card">
      <LinkedPart insp={insp} pool={wishlist} icon="bag" title={t('inspo.wishTitle')} empty={t('inspo.wishEmpty')} link={t('inspo.linkWish')} none={t('inspo.noWish')} />
      <div className="linked-split" />
      <LinkedPart insp={insp} pool={items} icon="hanger" title={t('inspo.ownTitle')} empty={t('inspo.ownEmpty')} link={t('inspo.linkOwn')} none={t('inspo.noOwn')} />
    </div>
  )
}

function LinkedPart({ insp, pool, icon, title, empty, link, none }: { insp: Inspiration; pool: Item[]; icon: string; title: string; empty: string; link: string; none: string }) {
  const { setInspirations } = useStore()
  const [open, setOpen] = useState(false)
  const linked = (insp.item_ids ?? []).map(id => pool.find(i => i.id === id)).filter((i): i is Item => !!i)
  const toggle = async (id: string, on: boolean) => {
    try { setInspirations(upsert(await linkInspo(insp, id, on))) } catch (e) { alert((e as Error).message) }
  }
  return (
    <>
      <h3 className="card-title"><Icon name={icon} /> {title}</h3>
      {linked.length > 0 ? (
        <div className="mini-list">
          {linked.map(i => (
            <button key={i.id} className="mini" onClick={() => go(`/i/${i.id}`)}>
              <Photo path={i.thumb_path ?? i.photo_path} alt="" />
              <span>{itemTitle(i)}</span>
            </button>
          ))}
        </div>
      ) : <p className="muted small">{empty}</p>}
      <button className="btn sm" onClick={() => setOpen(o => !o)}><Icon name={open ? 'check' : 'link'} /> {open ? t('common.done') : link}</button>
      {open && (pool.length ? (
        <div className="pick-grid">
          {pool.map(i => {
            const on = (insp.item_ids ?? []).includes(i.id)
            return (
              <button key={i.id} className={'pick' + (on ? ' on' : '')} onClick={() => toggle(i.id, !on)} aria-pressed={on}>
                <Photo path={i.thumb_path ?? i.photo_path} alt={itemTitle(i)} />
                {on && <span className="badge"><Icon name="check" /></span>}
              </button>
            )
          })}
        </div>
      ) : <p className="muted small">{none}</p>)}
    </>
  )
}

// On an item: the saved looks it is linked to, and a picker to link more
export function InspiredBy({ item }: { item: Item }) {
  const { inspirations, setInspirations } = useStore()
  const [open, setOpen] = useState(false)
  const linked = looksFor(item.id, inspirations)
  if (!item.wishlist && !linked.length) return null
  const toggle = async (insp: Inspiration, on: boolean) => {
    try { setInspirations(upsert(await linkInspo(insp, item.id, on))) } catch (e) { alert((e as Error).message) }
  }
  return (
    <div className="card">
      <h3 className="card-title"><Icon name="image" /> {linked.length ? t('item.inspiredBy', { count: linked.length }) : t('item.inspiredByNone')}</h3>
      {linked.length > 0 && (
        <div className="pick-grid">
          {linked.map(i => <button key={i.id} className="pick look" onClick={() => go(`/n/${i.id}`)}><Photo path={i.thumb_path ?? i.image_path} alt="" className="cover" /></button>)}
        </div>
      )}
      {inspirations.length > 0 && <button className="btn sm" onClick={() => setOpen(o => !o)}><Icon name={open ? 'check' : 'link'} /> {open ? t('common.done') : t('item.linkLooks')}</button>}
      {open && (
        <div className="pick-grid">
          {inspirations.map(i => {
            const on = (i.item_ids ?? []).includes(item.id)
            return (
              <button key={i.id} className={'pick look' + (on ? ' on' : '')} onClick={() => toggle(i, !on)} aria-pressed={on}>
                <Photo path={i.thumb_path ?? i.image_path} alt="" className="cover" />
                {on && <span className="badge"><Icon name="check" /></span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
