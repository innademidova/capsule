import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { signedUrls, colorOf, type Option, type Item, type Placement, type AIRequest } from './lib'

const PATHS: Record<string, string> = {
  hanger: 'M9.8 6.6a2.2 2.2 0 1 1 2.9 2.1c-.4.1-.7.5-.7.9v.6l-8.3 5.5A1.3 1.3 0 0 0 4.4 18h15.2a1.3 1.3 0 0 0 .7-2.3L12 10.2',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  heart: 'M12 20s-7-4.4-9-9a4.5 4.5 0 0 1 9-3 4.5 4.5 0 0 1 9 3c-2 4.6-9 9-9 9z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  filter: 'M4 6h16M7 12h10M10 18h4',
  x: 'M6 6l12 12M18 6L6 18',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off': 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6',
  paste: 'M9 4h6v3H9zM8 5H6v15h12V5h-2',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  check: 'M5 12l5 5 9-10',
  bag: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  minus: 'M5 12h14',
  wand: 'M4 20L16 8M14 4v2M18 8h2M19 3l-1 1M10 4l1 1M20 13l-1-1',
  shirt: 'M8 3l4 2 4-2 5 4-3 3-2-1v12H8V9l-2 1-3-3z',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  logout: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
}

export function Icon({ name, filled }: { name: string; filled?: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="22" height="22" fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

export function Swatch({ id, size = 18 }: { id: string; size?: number }) {
  const c = colorOf(id)
  if (!c) return null
  return <span className="swatch" style={{ width: size, height: size, background: c.hex }} title={c.label} />
}

// Set of pills for choosing one or several options
export function Chips({ options, value, onChange, multi = true, swatches }: {
  options: Option[]; value: string[]; onChange: (v: string[]) => void; multi?: boolean; swatches?: boolean
}) {
  const toggle = (id: string) => {
    if (!multi) return onChange(value[0] === id ? [] : [id])
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id])
  }
  return (
    <div className="chips">
      {options.map(o => (
        <button type="button" key={o.id} className={'chip' + (value.includes(o.id) ? ' on' : '')} onClick={() => toggle(o.id)}>
          {swatches && <Swatch id={o.id} size={14} />}{o.label}
        </button>
      ))}
    </div>
  )
}

// Photo from private storage
// zoom: a tap opens the picture full screen with a download button (AI images, collages)
export function Photo({ path, alt, className, zoom }: { path: string | null; alt: string; className?: string; zoom?: boolean }) {
  const [url, setUrl] = useState<string>()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    if (path) signedUrls([path]).then(m => { if (live) setUrl(m[path]) })
    else setUrl(undefined)
    return () => { live = false }
  }, [path])
  return (
    <div className={'photo ' + (className ?? '') + (zoom && url ? ' zoomable' : '')} onClick={zoom && url ? () => setOpen(true) : undefined}>
      {url ? <img src={url} alt={alt} loading="lazy" /> : <span className="photo-empty"><Icon name="hanger" /></span>}
      {open && url && <Lightbox url={url} alt={alt} onClose={() => setOpen(false)} />}
    </div>
  )
}

function Lightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])
  // On phones the share sheet has "Save image"; elsewhere a normal file download
  const download = async () => {
    setSaving(true)
    try {
      const blob = await (await fetch(url)).blob()
      const ext = blob.type.split('/')[1] || 'webp'
      const name = (alt || 'capsule').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'capsule'
      const file = new File([blob], `${name}.${ext}`, { type: blob.type })
      if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ files: [file] }).catch(() => {})
      } else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(file); a.download = file.name; a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      }
    } finally { setSaving(false) }
  }
  return createPortal(
    <div className="lightbox" onClick={e => { e.stopPropagation(); onClose() }}>
      <div className="lightbox-bar" onClick={e => e.stopPropagation()}>
        <button className="icon-btn" onClick={download} disabled={saving} aria-label="Download"><Icon name="download" /></button>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      </div>
      <img src={url} alt={alt} onClick={e => e.stopPropagation()} />
    </div>, document.body)
}

// A password field with an eye button that shows / hides what is typed
export function PasswordInput({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="pw-wrap">
      <input type={show ? 'text' : 'password'} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
        autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" />
      <button type="button" className="pw-eye" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
        <Icon name={show ? 'eye-off' : 'eye'} />
      </button>
    </div>
  )
}

export function Header({ title, left, right }: { title: ReactNode; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="top">
      <div className="top-side">{left}</div>
      <h1>{title}</h1>
      <div className="top-side right">{right}</div>
    </header>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="field">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

// Outfit collage: items on a white canvas, positioned in percent
export function Collage({ layout, items, className, children }: {
  layout: Placement[]; items: Item[]; className?: string; children?: ReactNode
}) {
  const byId = new Map(items.map(i => [i.id, i]))
  const [urls, setUrls] = useState<Record<string, string>>({})
  const paths = layout.map(p => byId.get(p.item_id)).map(i => i?.thumb_path ?? i?.photo_path).filter((p): p is string => !!p)
  const key = paths.join(',')
  useEffect(() => { let live = true; if (paths.length) signedUrls(paths).then(u => live && setUrls(u)); return () => { live = false } }, [key])
  return (
    <div className={'collage ' + (className ?? '')}>
      {[...layout].sort((a, b) => a.z - b.z).map(p => {
        const it = byId.get(p.item_id); const path = it?.thumb_path ?? it?.photo_path
        return it && path && urls[path]
          ? <img key={p.item_id} src={urls[path]} alt="" style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, zIndex: p.z }} />
          : null
      })}
      {children}
    </div>
  )
}

// The button for a paid AI action (the free queue was removed at the owner's request on 2026-11-11)
// Every AI task runs on OpenAI; the label shows the provider and the usual cost
export function AIActions({ onRun, busy, label, cost = 'OpenAI ≈1¢', disabled }: {
  onRun: (mode: 'now') => void; busy?: boolean; label: string; cost?: string; disabled?: boolean
}) {
  return (
    <div className="ai-actions">
      <button type="button" className="btn primary" disabled={busy || disabled} onClick={() => onRun('now')}>
        <Icon name="sparkle" /> {busy ? 'Thinking…' : label}<span className="cost">({cost})</span>
      </button>
    </div>
  )
}

export function RequestState({ req, hideModel }: { req?: AIRequest; hideModel?: boolean }) {
  if (req?.status === 'done' && req.model && !hideModel) return <p className="by-model">by {req.model}</p>
  if (req?.status !== 'error') return null
  return <div className="queued err"><span>{req.error}</span></div>
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-head"><h2>{title}</h2><button className="icon-btn sm" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  )
}
