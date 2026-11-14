// Profile: Overview (wardrobe stats), Account (name, email, password), Preferences (what the AI uses),
// Dictionaries (my own lists) and, for admins only, Settings (platform defaults and user roles).
import { useState, type FormEvent } from 'react'
import { supabase, CATEGORIES, COLORS } from './lib'
import { useStore } from './store'
import { Icon, Header, Swatch, PasswordInput } from './ui'
import { MiniItems } from './Shop'
import { DictEditor, Templates, Users } from './Dictionaries'
import { t, lang, LANGUAGES, remember, type Lang } from './i18n'

export type ProfileTab = 'overview' | 'account' | 'preferences' | 'dictionaries' | 'settings'

export function Profile({ tab, email }: { tab: ProfileTab; email: string }) {
  const { role } = useStore()
  const tabs: ProfileTab[] = ['overview', 'account', 'preferences', 'dictionaries', ...(role === 'admin' ? ['settings' as const] : [])]
  const active = tabs.includes(tab) ? tab : 'overview'
  return (
    <div className="screen">
      <Header title={t('profile.title')} />
      <div className="cat-row tabs-row" role="tablist">
        {tabs.map(id => (
          <button key={id} role="tab" aria-selected={active === id} className={'cat' + (active === id ? ' on' : '')}
            onClick={() => location.replace(`#/me${id === 'overview' ? '' : '/' + id}`)}>
            {id === 'settings' && <Icon name="lock" />}{t(`profile.tab.${id}`)}
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
      <h3 className="card-title">{t('profile.glance')}</h3>
      <p className="big-num">{items.length}<span className="muted"> {t('profile.items', { count: items.length })}</span></p>
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
        <h3 className="card-title">{t('field.colors')}</h3>
        <div className="color-list">
          {colorCounts.map(c => <span key={c.id} className="color-tag"><Swatch id={c.id} size={14} />{c.label} · {c.n}</span>)}
        </div>
      </div>
    )}
    {untagged.length > 0 && (
      <div className="card">
        <h3 className="card-title"><Icon name="wand" /> {t('profile.untagged', { count: untagged.length })}</h3>
        <p className="muted small">{t('profile.untaggedHint')}</p>
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
  const [pwOk, setPwOk] = useState(false)
  const [busy, setBusy] = useState(false)

  const saveName = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('profiles').upsert({ user_id: user.id, display_name: name.trim() || null, updated_at: new Date().toISOString() })
    setNameMsg(error ? error.message : t('common.saved')); if (!error) reload()
  }
  const savePw = async (e: FormEvent) => {
    e.preventDefault()
    if (pw.length < 8) return setPwMsg(t('account.pwShort'))
    if (pw !== pw2) return setPwMsg(t('account.pwMismatch'))
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    setPwMsg(error ? error.message : t('account.pwChanged')); setPwOk(!error); if (!error) { setPw(''); setPw2('') }
  }

  // The language is kept in the account (so the AI writes in it and other devices follow) and on this device
  const [langBusy, setLangBusy] = useState(false)
  const chooseLang = async (next: Lang) => {
    setLangBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) await supabase.from('profiles').upsert({ user_id: user.id, language: next, updated_at: new Date().toISOString() })
    if (remember(next)) location.reload(); else setLangBusy(false)
  }

  return <div className="form narrow">
    <div className="card form-card">
      <h3 className="card-title"><Icon name="user" /> {t('account.profile')}</h3>
      <label className="field"><span>{t('field.name')}</span>
        <input value={name} onChange={e => { setName(e.target.value); setNameMsg('') }} placeholder={t('account.namePlaceholder')} autoComplete="name" />
      </label>
      <label className="field"><span>{t('login.email')}</span><input value={email} disabled /></label>
      <p className="muted small">{t('account.role')} <b>{t(`account.roles.${role}`)}</b></p>
      <div className="row">
        <button className="btn sm primary" onClick={saveName} disabled={name.trim() === (account.display_name ?? '')}><Icon name="check" /> {t('common.save')}</button>
        {nameMsg && <span className="muted small">{nameMsg}</span>}
      </div>
    </div>
    <form className="card form-card" onSubmit={savePw}>
      <h3 className="card-title"><Icon name="lock" /> {t('login.password')}</h3>
      <input type="text" autoComplete="username" value={email} readOnly hidden />
      <PasswordInput placeholder={t('account.newPw')} value={pw} onChange={v => { setPw(v); setPwMsg('') }} autoComplete="new-password" />
      <PasswordInput placeholder={t('account.repeatPw')} value={pw2} onChange={v => { setPw2(v); setPwMsg('') }} autoComplete="new-password" />
      <div className="row">
        <button className="btn sm primary" disabled={busy || !pw || !pw2}>{busy ? t('common.saving') : t('account.changePw')}</button>
        {pwMsg && <span className={'small ' + (pwOk ? 'muted' : 'error')}>{pwMsg}</span>}
      </div>
    </form>
    <div className="card form-card">
      <h3 className="card-title"><Icon name="globe" /> {t('account.language')}</h3>
      <div className="seg" role="radiogroup" aria-label={t('account.language')}>
        {LANGUAGES.map(l => <button key={l} type="button" role="radio" aria-checked={lang === l} className={lang === l ? 'on' : ''} disabled={langBusy} onClick={() => chooseLang(l)}>{t(`languages.${l}`)}</button>)}
      </div>
      <p className="muted small">{t('account.languageHint')}</p>
    </div>
    <button className="btn ghost wide" onClick={() => supabase.auth.signOut()}><Icon name="logout" /> {t('account.signOut')}</button>
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
      <h3 className="card-title"><Icon name="user" /> {t('prefs.appearance')}</h3>
      <p className="muted small">{t('prefs.appearanceHint')}</p>
      <textarea rows={5} value={look} onChange={e => { setLook(e.target.value); setSaved(false) }} placeholder={t('prefs.appearancePlaceholder')} />
      <button className="btn sm" onClick={save} disabled={saved}><Icon name="check" /> {saved ? t('common.saved') : t('common.save')}</button>
    </div>
    <h3 className="section-title">{t('prefs.templates')}</h3>
    <Templates scope="user" />
  </>
}

type SettingsTab = 'dicts' | 'format' | 'users'
function Settings() {
  const [tab, setTab] = useState<SettingsTab>('dicts')
  const tabs: SettingsTab[] = ['dicts', 'format', 'users']
  return <>
    <p className="hint">{t('settings.hint')}</p>
    <div className="seg" role="tablist">
      {tabs.map(id => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{t(`settings.tab.${id}`)}</button>)}
    </div>
    {tab === 'dicts' && <DictEditor scope="global" />}
    {tab === 'format' && <Templates scope="global" />}
    {tab === 'users' && <Users />}
  </>
}
