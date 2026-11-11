import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  supabase, applyDict, type DictRow,
  type Item, type Outfit, type Inspiration, type StyleProfile, type ShopItem, type AIRequest,
} from './lib'
import { Icon, Header } from './ui'
import { StoreCtx, useStore, upsert, without, type Store } from './store'
import { WardrobeList, ItemDetail, ItemForm, emptyFilters, type Filters } from './Wardrobe'
import { OutfitList, OutfitDetail, OutfitEditor } from './Outfits'
import { StyleItem, Assistant } from './Looks'
import { Profile, type ProfileTab } from './Profile'
import { InspoList, InspoDetail } from './Inspo'
import { Shop, BeforeBuy } from './Shop'

// Routes live after # so they work on GitHub Pages
type Route =
  | { view: 'wardrobe' } | { view: 'item'; id: string } | { view: 'item-edit'; id?: string; wish?: boolean } | { view: 'wishlist' }
  | { view: 'outfits' } | { view: 'outfit'; id: string } | { view: 'outfit-edit'; id?: string; with?: string } | { view: 'stylist' }
  | { view: 'style'; id: string } | { view: 'inspo' } | { view: 'insp'; id: string } | { view: 'shop' } | { view: 'buy' } | { view: 'me'; tab: ProfileTab }

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
  if (a === 'style' && b) return { view: 'style', id: b }
  if (a === 'inspo') return { view: 'inspo' }
  if (a === 'n' && b) return { view: 'insp', id: b }
  if (a === 'shop') return { view: 'shop' }
  if (a === 'buy') return { view: 'buy' }
  if (a === 'me') return { view: 'me', tab: (b || 'overview') as ProfileTab }
  if (a === 'admin') return { view: 'me', tab: 'dictionaries' } // old link
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
  const [inspirations, setInspirations] = useState<Inspiration[]>([])
  const [profile, setProfile] = useState<StyleProfile | null>(null)
  const [shopping, setShopping] = useState<ShopItem[]>([])
  const [requests, setRequests] = useState<AIRequest[]>([])
  const [role, setRole] = useState<Store['role']>('user')
  const [account, setAccount] = useState<Store['account']>({ display_name: null })
  const [settings, setSettings] = useState<Store['settings']>({})
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
    const [it, ou, ins, pr, sh, rq, di, ro, ac, st] = await Promise.all([
      by('items'), by('outfits'),
      by('inspirations'), supabase.from('style_profile').select('*').maybeSingle(), by('shopping'), by('ai_requests').limit(60),
      supabase.from('dict_effective').select('type,category,id,label,hex,sort,is_default,is_own'),
      supabase.from('user_roles').select('role').maybeSingle(), supabase.from('profiles').select('display_name').maybeSingle(),
      supabase.from('app_settings').select('key,value'),
    ])
    if (it.error) { setLoadError(it.error.message); return }
    applyDict((di.data ?? []) as DictRow[])
    setRole(ro.data?.role === 'admin' ? 'admin' : 'user'); setAccount({ display_name: ac.data?.display_name ?? null })
    const set = Object.fromEntries((st.data ?? []).map(r => [r.key, r.value]))
    setSettings({ look_reference: set.look_reference?.path })
    setItemsS(it.data as Item[]); setOutfits((ou.data ?? []) as Outfit[])
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
    items, wishlist, outfits, inspirations, profile, shopping, requests, role, account, settings,
    setItems: f => setItemsS(x => f(x ?? [])), setOutfits, setInspirations, setShopping, setRequests, reload: load,
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
    case 'stylist': screen = <Assistant />; break
    case 'style': { const it = find(route.id); screen = it ? <StyleItem item={it} /> : notFound; break }
    case 'inspo': screen = <InspoList />; break
    case 'insp': { const x = inspirations.find(i => i.id === route.id); screen = x ? <InspoDetail insp={x} /> : notFound; break }
    case 'shop': screen = <Shop />; break
    case 'buy': screen = <BeforeBuy />; break
    case 'me': screen = <Profile key={route.tab} tab={route.tab} email={email} />; break
  }

  const tab = route.view.startsWith('item') || route.view === 'wishlist' || route.view === 'style' ? 'wardrobe' : route.view.startsWith('outfit') || route.view === 'stylist' ? 'outfits'
    : route.view === 'insp' ? 'inspo' : route.view === 'buy' ? 'shop' : route.view
  const tabs = [
    { id: 'wardrobe', label: 'Wardrobe', icon: 'hanger', path: '/' },
    { id: 'outfits', label: 'Outfits', icon: 'layers', path: '/outfits' },
    { id: 'inspo', label: 'Inspo', icon: 'image', path: '/inspo' },
    { id: 'shop', label: 'Shop', icon: 'bag', path: '/shop' },
    { id: 'me', label: 'Profile', icon: 'user', path: '/me' },
  ]
  const editing = route.view === 'item-edit' || route.view === 'outfit-edit'

  return (
    <StoreCtx.Provider value={store}>
      <div className={'app with-tabs' + (editing ? ' editing' : '')}>
        {screen}
        <nav className="tabbar" aria-label="Main">
          <div className="side-brand">Capsule</div>
          {tabs.map(t => (
            <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} aria-current={tab === t.id ? 'page' : undefined} onClick={() => tab !== t.id && location.replace('#' + t.path)}>
              <Icon name={t.icon} /><span>{t.label}</span>
            </button>
          ))}
        </nav>
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
