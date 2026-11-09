import { useRef, useState } from 'react'
import { supabase, CATEGORIES, processPhoto, uploadPhoto, removePhotos, whiteToAlpha, generateGarment, type Item } from './lib'
import { Chips, Icon, Photo, Header, Section } from './ui'
import { back } from './App'

// Item from a photo of a person: AI draws it on its own, the owner approves it or asks for fixes
export function GarmentCreator({ wish, onSaved }: { wish?: boolean; onSaved: (i: Item) => void }) {
  const [source, setSource] = useState<{ path: string; preview: string } | null>(null)
  const [piece, setPiece] = useState('')
  const [category, setCategory] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  const [corrections, setCorrections] = useState<string[]>([])
  const [fix, setFix] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const home = wish ? '/wish' : '/'

  const take = async (file?: File) => {
    if (!file) return
    setBusy('Preparing the photo…'); setError('')
    try {
      const p = await processPhoto(file)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Please sign in again')
      const path = `${user.id}/drafts/${crypto.randomUUID()}.${p.full.type.split('/')[1]}`
      const { error } = await supabase.storage.from('photos').upload(path, p.full, { contentType: p.full.type })
      if (error) throw error
      if (source) await removePhotos(source.path)
      setSource({ path, preview: p.preview })
    } catch (e) { setError((e as Error).message || 'Could not read this image') }
    setBusy('')
  }

  // Corrections accumulate, and the previous attempt goes to the model along with the original
  const generate = async (again: boolean) => {
    if (!source) return
    const note = fix.trim()
    const next = again && note ? [...corrections, note] : corrections
    setBusy('Creating the image, this can take a minute or two…'); setError('')
    try {
      const path = await generateGarment({
        source_path: source.path, piece: piece.trim(), corrections: next,
        previous_path: again && note && draft ? draft : undefined,
      })
      if (draft) await removePhotos(draft)
      setDraft(path); setCorrections(next); setFix('')
    } catch (e) { setError((e as Error).message) }
    setBusy('')
  }

  const add = async () => {
    if (!draft || !source) return
    setBusy('Saving…'); setError('')
    try {
      const { data: blob, error: dl } = await supabase.storage.from('photos').download(draft)
      if (dl || !blob) throw dl ?? new Error('Could not read the image')
      const paths = await uploadPhoto(await processPhoto(await whiteToAlpha(blob)))
      const row = { name: piece.trim(), category, ...paths, ...(wish ? { wishlist: true } : {}) }
      const { data, error } = await supabase.from('items').insert(row).select().single()
      if (error) { await removePhotos(paths.photo_path, paths.thumb_path); throw error }
      await removePhotos(source.path, draft)
      onSaved(data as Item)
      location.replace(`#/i/${(data as Item).id}`)
    } catch (e) { setError((e as Error).message); setBusy('') }
  }

  const leave = async () => {
    await removePhotos(source?.path ?? null, draft)
    back(home)
  }

  return (
    <div className="screen">
      <Header title={wish ? 'New wishlist item' : 'New item'}
        left={<button className="icon-btn" onClick={leave} aria-label="Back"><Icon name="back" /></button>} />
      <div className="form">
        {draft ? <>
          <Photo path={draft} alt="" className="big" />
          <Section title="What to fix (optional)">
            <textarea rows={2} placeholder="e.g. remove the belt, make the sleeves longer" value={fix} onChange={e => setFix(e.target.value)} disabled={!!busy} />
          </Section>
          {corrections.length > 0 && <p className="hint">Already asked: {corrections.join(' · ')}</p>}
          {busy && <p className="hint">{busy}</p>}
          {error && <p className="error">{error}</p>}
          <button className="btn wide" onClick={() => generate(true)} disabled={!!busy}><Icon name="sparkle" /> Regenerate<span className="cost">≈6¢</span></button>
          <button className="btn primary wide" onClick={add} disabled={!!busy}><Icon name="check" /> {wish ? 'Add to wishlist' : 'Add to wardrobe'}</button>
        </> : <>
          <div className="picker">
            <div className="photo big">
              {source ? <img src={source.preview} alt="" /> : <span className="photo-empty"><Icon name="camera" /></span>}
            </div>
            <div className="picker-btns">
              <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                <Icon name="image" /> {source ? 'Change photo' : 'Choose photo'}
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { take(e.target.files?.[0]); e.target.value = '' }} />
            <p className="hint">A photo of a person wearing it works. The new image is saved only after you approve it.</p>
          </div>
          <Section title="Which piece?">
            <input placeholder="e.g. Beige belted trench coat" value={piece} onChange={e => setPiece(e.target.value)} />
          </Section>
          <Section title="Category">
            <Chips options={CATEGORIES} value={category ? [category] : []} multi={false} onChange={v => setCategory(v[0] ?? '')} />
          </Section>
          {busy && <p className="hint">{busy}</p>}
          {error && <p className="error">{error}</p>}
          <button className="btn primary wide" onClick={() => generate(false)} disabled={!!busy || !source || !piece.trim() || !category}>
            <Icon name="sparkle" /> Create image<span className="cost">≈6¢</span>
          </button>
        </>}
      </div>
    </div>
  )
}
