import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  supabase, CATEGORIES, COLORS, askAI,
  type Item, type Outfit, type Wear, type Inspiration, type StyleProfile, type ShopItem, type AIRequest,
} from './lib'
import { Icon, Header, Swatch } from './ui'
import { StoreCtx, useStore, upsert, without, type Store } from './store'
import { WardrobeList, ItemDetail, ItemForm, emptyFilters, type Filters } from './Wardrobe'
import { OutfitList, OutfitDetail, OutfitEditor, Stylist } from './Outfits'
import { InspoList, InspoDetail } from './Inspo'
import { Shop, BeforeBuy, MiniItems } from './Shop'

// Routes live after # so they work on GitHub Pages
type Route =
  | { view: 'wardrobe' } | { view: 'item'; id: string } | { view: 'item-edit'; id?: string; wish?: boolean } | { view: 'wishlist' }
  | { view: 'outfits' } | { view: 'outfit'; id: string } | { view: 'outfit-edit'; id?: string; with?: string } | { view: 'stylist' }
  | { view: 'inspo' } | { view: 'insp'; id: string } | { view: 'shop' } | { view: 'buy' } | { view: 'me' }

function parse(hash: string): Route {
  const [a, b, c] = hash.replace(/^#\/?/, '').split('/')
  if (a === 'i' && b === 'new') return { view: 'item-edit', wish: c === 'wish' }
  if (a === 'wish') return { view: 'wishlist' }
  if (a === 'i' && b && c === 'edit') return { view: 'item-edit', id: b }
  if (a === 'i' && b) return { view: 'item', id: b }
  if (a === 'outfits') return { view: 'outfits' }
  if (a === 'o' && b === 'new') return { view: 'outfit-edit', with: c }
  if (a === 'o' && b && c === 'edit') return { view: 'outfit-edit', id: b }
  if (a === 'o' && b) return { view: 'outfit', id: b }
  if (a === 'stylist') return { view: 'stylist' }
  if (a === 'inspo') return { view: 'inspo' }
  if (a === 'n' && b) return { view: 'insp', id: b }
  if (a === 'shop') return { view: 'shop' }
  if (a === 'buy') return { view: 'buy' }
  if (a === 'me') return { view: 'me' }
  return { view: 'wardrobe' }
}

// How many steps we took inside the app, so that "back" never leaves it
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
  const [allItems, setItemsS] = useState<Item[] | null>(null)
  const [outfits, setOutfits] = useState<Outfit[]>([])
  const [wear, setWear] = useState<Wear[]>([])
  const [inspirations, setInspirations] = useState<Inspiration[]>([])
  const [profile, setProfile] = useState<StyleProfile | null>(null)
  const [shopping, setShopping] = useState<ShopItem[]>([])
  const [requests, setRequests] = useState<AIRequest[]>([])
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [wishFilters, setWishFilters] = useState<Filters>(emptyFilters)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const on = () => { setRoute(parse(location.hash)); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const load = useCallback(async () => {
    setLoadError('')
    const by = (t: string) => supabase.from(t).select('*').order('created_at', { ascending: false })
    const [it, ou, we, ins, pr, sh, rq] = await Promise.all([
      by('items'), by('outfits'), supabase.from('wear_log').select('*').order('worn_on', { ascending: false }),
      by('inspirations'), supabase.from('style_profile').select('*').maybeSingle(), by('shopping'), by('ai_requests').limit(60),
    ])
    if (it.error) { setLoadError(it.error.message); return }
    setItemsS(it.data as Item[]); setOutfits((ou.data ?? []) as Outfit[]); setWear((we.data ?? []) as Wear[])
    setInspirations((ins.data ?? []) as Inspiration[]); setProfile((pr.data as StyleProfile | null) ?? null)
    setShopping((sh.data ?? []) as ShopItem[]); setRequests((rq.data ?? []) as AIRequest[])
  }, [])
  useEffect(() => { load() }, [load])
  // When the app is opened again, pull fresh data (e.g. a processed queue)
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [load])

  if (loadError) return (
    <div className="splash">
      <p>Couldn't load the wardrobe</p>
      <p className="muted small">{loadError}</p>
      <button className="btn" onClick={load}>Try again</button>
    </div>
  )
  if (!allItems) return <Splash />
  // The wishlist shares the table, but the stylist, outfits and stats only see the wardrobe
  const items = allItems.filter(i => !i.wishlist)
  const wishlist = allItems.filter(i => i.wishlist)

  const store: Store = {
    items, wishlist, outfits, wear, inspirations, profile, shopping, requests,
    setItems: f => setItemsS(x => f(x ?? [])), setOutfits, setWear, setInspirations, setShopping, setRequests, reload: load,
  }
  const save = (i: Item) => store.setItems(upsert(i))
  const drop = (id: string) => store.setItems(without(id))
  const find = (id?: string) => allItems.find(i => i.id === id)
  const findO = (id?: string) => outfits.find(o => o.id === id)
  const notFound = <NotFound />

  let screen
  switch (route.view) {
    case 'wardrobe': screen = <WardrobeList items={items} filters={filters} setFilters={setFilters} />; break
    case 'wishlist': screen = <WardrobeList wish items={wishlist} filters={wishFilters} setFilters={setWishFilters} />; break
    case 'item': { const it = find(route.id); screen = it ? <ItemDetail item={it} onChange={save} onDelete={drop} /> : notFound; break }
    case 'item-edit':
      screen = route.id && !find(route.id) ? notFound : <ItemForm key={route.id ?? 'new'} item={find(route.id)} wish={route.wish} onSaved={save} />
      break
    case 'outfits': screen = <OutfitList />; break
    case 'outfit': { const o = findO(route.id); screen = o ? <OutfitDetail outfit={o} /> : notFound; break }
    case 'outfit-edit':
      screen = route.id && !findO(route.id) ? notFound : <OutfitEditor key={route.id ?? route.with ?? 'new'} outfit={findO(route.id)} preset={route.with ? route.with.split(',') : undefined} />
      break
    case 'stylist': screen = <Stylist />; break
    case 'inspo': screen = <InspoList />; break
    case 'insp': { const x = inspirations.find(i => i.id === route.id); screen = x ? <InspoDetail insp={x} /> : notFound; break }
    case 'shop': screen = <Shop />; break
    case 'buy': screen = <BeforeBuy />; break
    case 'me': screen = <Me email={email} />; break
  }

  const tab = route.view.startsWith('item') || route.view === 'wishlist' ? 'wardrobe' : route.view.startsWith('outfit') || route.view === 'stylist' ? 'outfits'
    : route.view === 'insp' ? 'inspo' : route.view === 'buy' ? 'shop' : route.view
  const tabs = [
    { id: 'wardrobe', label: 'Wardrobe', icon: 'hanger', path: '/' },
    { id: 'outfits', label: 'Outfits', icon: 'layers', path: '/outfits' },
    { id: 'inspo', label: 'Inspo', icon: 'image', path: '/inspo' },
    { id: 'shop', label: 'Shop', icon: 'bag', path: '/shop' },
    { id: 'me', label: 'Me', icon: 'user', path: '/me' },
  ]
  const showTabs = route.view !== 'item-edit' && route.view !== 'outfit-edit'

  return (
    <StoreCtx.Provider value={store}>
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
    </StoreCtx.Provider>
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

function Me({ email }: { email: string }) {
  const { items, wear, requests, setRequests } = useStore()
  const [busy, setBusy] = useState(false)
  const max = Math.max(1, ...CATEGORIES.map(c => items.filter(i => i.category === c.id).length))
  const colorCounts = COLORS.map(c => ({ ...c, n: items.filter(i => i.colors.includes(c.id)).length }))
    .filter(c => c.n > 0).sort((a, b) => b.n - a.n)
  const worn = new Map<string, number>()
  wear.forEach(w => w.item_ids.forEach(id => worn.set(id, (worn.get(id) ?? 0) + 1)))
  const most = items.filter(i => worn.get(i.id)).sort((a, b) => worn.get(b.id)! - worn.get(a.id)!).slice(0, 6)
  const monthAgo = Date.now() - 30 * 864e5
  const never = items.filter(i => !worn.get(i.id) && new Date(i.created_at).getTime() < monthAgo)
  const untagged = items.filter(i => !i.colors.length || !i.kind || !i.seasons.length || !i.styles.length || !i.occasions.length)
  const queued = requests.filter(r => r.status === 'queued')
  const tagQueued = queued.some(r => r.kind === 'tag' && !r.image_path)

  const tagAll = async () => {
    setBusy(true)
    try { setRequests(upsert(await askAI('tag', {}, 'queue'))) } catch (e) { alert((e as Error).message) }
    setBusy(false)
  }

  return (
    <div className="screen">
      <Header title="Me" />
      <div className="card">
        <h3 className="card-title">Wardrobe at a glance</h3>
        <p className="big-num">{items.length}<span className="muted"> items · {wear.length} days logged</span></p>
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
      {most.length > 0 && <div className="card"><h3 className="card-title">Most worn</h3><MiniItems items={most} /></div>}
      {never.length > 0 && (
        <div className="card">
          <h3 className="card-title">Not worn for a month+</h3>
          <p className="muted small">Try them in a new outfit, or think about letting them go.</p>
          <MiniItems items={never} />
        </div>
      )}
      {untagged.length > 0 && (
        <div className="card">
          <h3 className="card-title"><Icon name="wand" /> {untagged.length} items without full tags</h3>
          <p className="muted small">Tags help the stylist. Claude can look at the photos and fill them in for free.</p>
          <button className="btn sm" onClick={tagAll} disabled={busy || tagQueued}><Icon name="clock" /> {tagQueued ? 'In the queue' : 'Tag them via the queue'}</button>
        </div>
      )}
      <div className="card">
        <h3 className="card-title"><Icon name="clock" /> AI queue</h3>
        {queued.length ? <p className="small">{queued.length} request(s) waiting. Tell Claude “process the queue” and the answers will appear in the app.</p>
          : <p className="muted small">Empty. Free requests you add to the queue appear here.</p>}
      </div>
      <div className="card row">
        <span className="muted small grow">{email}</span>
        <button className="btn ghost sm" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  )
}
