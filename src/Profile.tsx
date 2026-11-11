// Profile: Overview (wardrobe stats), Account (name, email, password), Preferences (what the AI uses),
// Dictionaries (my own lists) and, for admins only, Settings (platform defaults and user roles).
import { useState, type FormEvent } from 'react'
import { supabase, CATEGORIES, COLORS } from './lib'
import { useStore } from './store'
import { Icon, Header, Swatch } from './ui'
import { MiniItems } from './Shop'
import { DictEditor, LookFormat, Users } from './Dictionaries'

export type ProfileTab = 'overview' | 'account' | 'preferences' | 'dictionaries' | 'settings'

export function Profile({ tab, email }: { tab: ProfileTab; email: string }) {
  const { role } = useStore()
  const tabs: { id: ProfileTab; label: string }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'account', label: 'Account' },
    { id: 'preferences', label: 'Preferences' }, { id: 'dictionaries', label: 'Dictionaries' },
    ...(role === 'admin' ? [{ id: 'settings' as const, label: 'Settings' }] : []),
  ]
  const active = tabs.some(t => t.id === tab) ? tab : 'overview'
  return (
    <div className="screen">
      <Header title="My profile" />
      <div className="cat-row tabs-row" role="tablist">
        {tabs.map(t => (
          <button key={t.id} role="tab" aria-selected={active === t.id} className={'cat' + (active === t.id ? ' on' : '')}
            onClick={() => location.replace(`#/me${t.id === 'overview' ? '' : '/' + t.id}`)}>
            {t.id === 'settings' && <Icon name="lock" />}{t.label}
          </button>
        ))}
      </div>
      {active === 'overview' && <Overview />}
      {active === 'account' && <Account email={email} />}
      {active === 'preferences' && <Preferences />}
      {active === 'dictionaries' && <DictEditor scope="user" />}
      {active === 'settings' && <Settings />}
    </div>
  )
}

function Overview() {
  const { items } = useStore()
  const max = Math.max(1, ...CATEGORIES.map(c => items.filter(i => i.category === c.id).length))
  const colorCounts = COLORS.map(c => ({ ...c, n: items.filter(i => i.colors.includes(c.id)).length }))
    .filter(c => c.n > 0).sort((a, b) => b.n - a.n)
  const untagged = items.filter(i => !i.colors.length || !i.kind || !i.seasons.length || !i.styles.length || !i.occasions.length)
  return <>
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
    {untagged.length > 0 && (
      <div className="card">
        <h3 className="card-title"><Icon name="wand" /> {untagged.length} items without full tags</h3>
        <p className="muted small">Tags help the stylist. Open an item, tap Edit and then “Fill in with AI”.</p>
        <MiniItems items={untagged} />
      </div>
    )}
  </>
}

function Account({ email }: { email: string }) {
  const { account, role, reload } = useStore()
  const [name, setName] = useState(account.display_name ?? '')
  const [nameMsg, setNameMsg] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const saveName = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('profiles').upsert({ user_id: user.id, display_name: name.trim() || null, updated_at: new Date().toISOString() })
    setNameMsg(error ? error.message : 'Saved'); if (!error) reload()
  }
  const savePw = async (e: FormEvent) => {
    e.preventDefault()
    if (pw.length < 8) return setPwMsg('At least 8 characters')
    if (pw !== pw2) return setPwMsg('The passwords do not match')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    setPwMsg(error ? error.message : 'Password changed'); if (!error) { setPw(''); setPw2('') }
  }

  return <div className="form narrow">
    <div className="card form-card">
      <h3 className="card-title"><Icon name="user" /> Profile</h3>
      <label className="field"><span>Name</span>
        <input value={name} onChange={e => { setName(e.target.value); setNameMsg('') }} placeholder="How should we call you?" autoComplete="name" />
      </label>
      <label className="field"><span>Email</span><input value={email} disabled /></label>
      <p className="muted small">Role: <b>{role === 'admin' ? 'Admin' : 'User'}</b></p>
      <div className="row">
        <button className="btn sm primary" onClick={saveName} disabled={name.trim() === (account.display_name ?? '')}><Icon name="check" /> Save</button>
        {nameMsg && <span className="muted small">{nameMsg}</span>}
      </div>
    </div>
    <form className="card form-card" onSubmit={savePw}>
      <h3 className="card-title"><Icon name="lock" /> Password</h3>
      <input type="text" autoComplete="username" value={email} readOnly hidden />
      <input type="password" placeholder="New password" value={pw} onChange={e => { setPw(e.target.value); setPwMsg('') }} autoComplete="new-password" />
      <input type="password" placeholder="Repeat the new password" value={pw2} onChange={e => { setPw2(e.target.value); setPwMsg('') }} autoComplete="new-password" />
      <div className="row">
        <button className="btn sm primary" disabled={busy || !pw || !pw2}>{busy ? 'Saving…' : 'Change password'}</button>
        {pwMsg && <span className={'small ' + (pwMsg === 'Password changed' ? 'muted' : 'error')}>{pwMsg}</span>}
      </div>
    </form>
    <button className="btn ghost wide" onClick={() => supabase.auth.signOut()}><Icon name="logout" /> Sign out</button>
  </div>
}

function Preferences() {
  const { profile, reload } = useStore()
  const [look, setLook] = useState(profile?.appearance ?? '')
  const [saved, setSaved] = useState(true)
  const save = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('style_profile').upsert({ user_id: user.id, appearance: look.trim() || null })
    if (error) alert(error.message); else { setSaved(true); reload() }
  }
  return <>
    <div className="card">
      <h3 className="card-title"><Icon name="user" /> My appearance</h3>
      <p className="muted small">The AI draws a woman who looks like this when it shows outfits on you. Write in English.</p>
      <textarea rows={5} value={look} onChange={e => { setLook(e.target.value); setSaved(false) }} placeholder="Hair, skin, face, figure…" />
      <button className="btn sm" onClick={save} disabled={saved}><Icon name="check" /> {saved ? 'Saved' : 'Save'}</button>
    </div>
    <div className="card">
      <h3 className="card-title"><Icon name="image" /> Look image format</h3>
      <LookFormat scope="user" />
    </div>
  </>
}

type SettingsTab = 'dicts' | 'format' | 'users'
function Settings() {
  const [tab, setTab] = useState<SettingsTab>('dicts')
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'dicts', label: 'Default dictionaries' }, { id: 'format', label: 'Default look format' }, { id: 'users', label: 'Users and roles' },
  ]
  return <>
    <p className="hint">Platform settings. Only admins see this tab.</p>
    <div className="seg" role="tablist">
      {tabs.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
    </div>
    {tab === 'dicts' && <DictEditor scope="global" />}
    {tab === 'format' && <LookFormat scope="global" />}
    {tab === 'users' && <Users />}
  </>
}
