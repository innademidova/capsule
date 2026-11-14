import { useRef, useState } from 'react'
import {
  supabase, processPhoto, uploadPhoto, removePhotos, askAI, categoryLabel, itemTitle,
  type Inspiration, type AIRequest, type ShopItem, type Item,
} from './lib'
import { useStore, upsert, without } from './store'
import { Icon, Header, Photo, AIActions, RequestState } from './ui'
import { go, back } from './App'
import { t } from './i18n'

export function InspoList() {
  const { inspirations, profile, requests, setInspirations, setRequests, reload } = useStore()
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
        const { data, error } = await supabase.from('inspirations').insert({ image_path: paths.photo_path, thumb_path: paths.thumb_path }).select().single()
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
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { add(e.target.files); e.target.value = '' }} />

      <div className="card formulas">
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
      </div>

      {inspirations.length === 0 ? (
        <div className="empty">
          <Icon name="image" />
          <h2>{t('inspo.empty')}</h2>
          <p className="muted">{t('inspo.emptyHint')}</p>
          <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="plus" /> {busy ? t('common.uploading') : t('inspo.add')}</button>
        </div>
      ) : (
        <div className="grid inspo-grid">
          {inspirations.map(i => (
            <button key={i.id} className="inspo-tile" onClick={() => go(`/n/${i.id}`)}>
              <Photo path={i.thumb_path ?? i.image_path} alt="" className="cover" />
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
    await removePhotos(insp.image_path, insp.thumb_path)
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
        <Photo path={insp.image_path} alt="" className="big cover-big" />
        <div className="detail-info">
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
