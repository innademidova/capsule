import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, CATEGORIES, COLORS, type Item } from './lib'
import { Icon, Header, Swatch } from './ui'
import { WardrobeList, ItemDetail, ItemForm, emptyFilters, type Filters } from './Wardrobe'

// Маршрути в адресі після #, щоб працювало на GitHub Pages
type Route =
  | { view: 'wardrobe' } | { view: 'item'; id: string } | { view: 'item-edit'; id?: string }
  | { view: 'outfits' } | { view: 'inspo' } | { view: 'me' }

function parse(hash: string): Route {
  const [a, b, c] = hash.replace(/^#\/?/, '').split('/')
  if (a === 'i' && b === 'new') return { view: 'item-edit' }
  if (a === 'i' && b && c === 'edit') return { view: 'item-edit', id: b }
  if (a === 'i' && b) return { view: 'item', id: b }
  if (a === 'outfits') return { view: 'outfits' }
  if (a === 'inspo') return { view: 'inspo' }
  if (a === 'me') return { view: 'me' }
  return { view: 'wardrobe' }
}

// Скільки кроків ми пройшли всередині застосунку — щоб «назад» не виводив із нього
let depth = 0
export const go = (path: string) => { depth++; location.hash = path }
export const back = (fallback: string) => {
  if (depth > 0) { depth--; history.back() }
  else location.replace('#' + fallback)
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <Splash />
  if (!session) return <Login />
  return <Main email={session.user.email ?? ''} />
}

const Splash = () => <div className="splash"><span className="brand">Capsule</span></div>

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(error.message.includes('Invalid') ? 'Wrong email or password' : error.message)
    setBusy(false)
  }
  return (
    <div className="login">
      <form onSubmit={submit} className="login-card">
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" className="login-logo" />
        <h1>Capsule</h1>
        <p className="muted">Fewer clothes, more outfits</p>
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
        <div className="pw-wrap">
          <input type={showPw ? 'text' : 'password'} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete="current-password" autoCapitalize="none" autoCorrect="off" required />
          <button type="button" className="pw-eye" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
            <Icon name={showPw ? 'eye-off' : 'eye'} />
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}

function Main({ email }: { email: string }) {
  const [route, setRoute] = useState<Route>(() => parse(location.hash))
  const [items, setItems] = useState<Item[] | null>(null)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const on = () => { setRoute(parse(location.hash)); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const load = useCallback(async () => {
    setLoadError('')
    const { data, error } = await supabase.from('items').select('*').order('created_at', { ascending: false })
    if (error) { setLoadError(error.message); return }
    setItems(data as Item[])
  }, [])
  useEffect(() => { load() }, [load])

  if (loadError) return (
    <div className="splash">
      <p>Couldn't load the wardrobe</p>
      <p className="muted small">{loadError}</p>
      <button className="btn" onClick={load}>Try again</button>
    </div>
  )
  if (!items) return <Splash />

  const save = (i: Item) => setItems(list => [i, ...(list ?? []).filter(x => x.id !== i.id)])
  const drop = (id: string) => setItems(list => (list ?? []).filter(x => x.id !== id))
  const find = (id?: string) => items.find(i => i.id === id)

  let screen
  switch (route.view) {
    case 'wardrobe': screen = <WardrobeList items={items} filters={filters} setFilters={setFilters} />; break
    case 'item': {
      const it = find(route.id)
      screen = it ? <ItemDetail item={it} onChange={save} onDelete={drop} /> : <NotFound />
      break
    }
    case 'item-edit':
      screen = route.id && !find(route.id) ? <NotFound /> : <ItemForm key={route.id ?? 'new'} item={find(route.id)} onSaved={save} />
      break
    case 'outfits':
      screen = <Soon title="Outfits" icon="sparkle"
        text="Build looks from your wardrobe on a canvas, save favorites, and ask the AI stylist for outfit ideas for any occasion and weather." />
      break
    case 'inspo':
      screen = <Soon title="Inspiration" icon="image"
        text="Save screenshots of looks you love. The AI will break them down, match them with what you already own, and find your personal style formulas." />
      break
    case 'me': screen = <Me items={items} email={email} />; break
  }

  const tab = route.view.startsWith('item') ? 'wardrobe' : route.view
  const tabs = [
    { id: 'wardrobe', label: 'Wardrobe', icon: 'hanger', path: '/' },
    { id: 'outfits', label: 'Outfits', icon: 'sparkle', path: '/outfits' },
    { id: 'inspo', label: 'Inspo', icon: 'image', path: '/inspo' },
    { id: 'me', label: 'Me', icon: 'user', path: '/me' },
  ]
  const showTabs = route.view !== 'item-edit'

  return (
    <div className={'app' + (showTabs ? ' with-tabs' : '')}>
      {screen}
      {showTabs && (
        <nav className="tabbar">
          {tabs.map(t => (
            <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => tab !== t.id && location.replace('#' + t.path)}>
              <Icon name={t.icon} /><span>{t.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}

function NotFound() {
  return (
    <div className="screen">
      <Header title="" left={<button className="icon-btn" onClick={() => back('/')} aria-label="Back"><Icon name="back" /></button>} />
      <p className="muted center pad">This item no longer exists.</p>
    </div>
  )
}

function Soon({ title, icon, text }: { title: string; icon: string; text: string }) {
  return (
    <div className="screen">
      <Header title={title} />
      <div className="empty">
        <Icon name={icon} />
        <h2>Coming soon</h2>
        <p className="muted">{text}</p>
      </div>
    </div>
  )
}

function Me({ items, email }: { items: Item[]; email: string }) {
  const max = Math.max(1, ...CATEGORIES.map(c => items.filter(i => i.category === c.id).length))
  const colorCounts = COLORS.map(c => ({ ...c, n: items.filter(i => i.colors.includes(c.id)).length }))
    .filter(c => c.n > 0).sort((a, b) => b.n - a.n)
  return (
    <div className="screen">
      <Header title="Me" />
      <div className="card">
        <h3 className="card-title">Wardrobe at a glance</h3>
        <p className="big-num">{items.length}<span className="muted"> items</span></p>
        <div className="bars">
          {CATEGORIES.map(c => {
            const n = items.filter(i => i.category === c.id).length
            return (
              <div key={c.id} className="bar-row">
                <span>{c.label}</span>
                <div className="bar"><div style={{ width: `${(n / max) * 100}%` }} /></div>
                <span className="muted">{n}</span>
              </div>
            )
          })}
        </div>
      </div>
      {colorCounts.length > 0 && (
        <div className="card">
          <h3 className="card-title">Colors</h3>
          <div className="color-list">
            {colorCounts.map(c => <span key={c.id} className="color-tag"><Swatch id={c.id} size={14} />{c.label} · {c.n}</span>)}
          </div>
        </div>
      )}
      <div className="card">
        <h3 className="card-title">Coming next</h3>
        <ol className="roadmap">
          <li><b>AI tagging</b>: the app fills in type, colors and season from the photo.</li>
          <li><b>Outfits</b>: build looks and get AI suggestions from your own clothes.</li>
          <li><b>Inspiration</b>: break down saved looks and find your style formulas.</li>
          <li><b>Smart shopping</b>: what's missing, what you have too much of, and a “before you buy” check.</li>
        </ol>
      </div>
      <div className="card row">
        <span className="muted small grow">{email}</span>
        <button className="btn ghost sm" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  )
}
