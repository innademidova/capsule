// The assistant: a chat she can open on every screen (Edge Function 'agent', table agent_messages).
// It knows the open screen, reads her data, changes things when she asks and proposes looks as cards.
// A card is drawn on her only when she taps "Show on me"; the chat itself never spends money on pictures.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { supabase, autoLayout, renderLook, itemTitle, type AgentMessage, type AgentCard, type Item, type Outfit } from './lib'
import { useStore, upsert } from './store'
import { Icon, Photo, Sheet } from './ui'
import { FlatLay } from './Looks'
import { go } from './App'
import { t } from './i18n'

export type AgentContext = { screen: string; item_id?: string; outfit_id?: string; inspiration_id?: string; entry_id?: string }

const isId = (s: string) => /^[0-9a-f-]{36}$/.test(s)

export function AgentButton({ context }: { context: AgentContext }) {
  const [open, setOpen] = useState(false)
  return <>
    <button className="agent-fab" onClick={() => setOpen(true)} aria-label={t('agent.title')}><Icon name="sparkle" /></button>
    {open && <AgentChat context={context} onClose={() => setOpen(false)} />}
  </>
}

function AgentChat({ context, onClose }: { context: AgentContext; onClose: () => void }) {
  const { items, wishlist, outfits, shopping, reload } = useStore()
  const [thread, setThread] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<AgentMessage[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)

  // Continue the latest conversation; "New chat" starts another thread
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data: last } = await supabase.from('agent_messages').select('thread_id').order('created_at', { ascending: false }).limit(1)
      const id = (last?.[0]?.thread_id as string | undefined) ?? crypto.randomUUID()
      if (!live) return
      setThread(id)
      if (last?.length) {
        const { data } = await supabase.from('agent_messages').select('*').eq('thread_id', id).order('created_at').limit(80)
        if (live) setMsgs((data ?? []) as AgentMessage[])
      }
    })()
    return () => { live = false }
  }, [])
  // Keep the newest message in view
  useEffect(() => {
    const el = document.querySelector('.sheet.agent .sheet-body')
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [msgs.length, busy])

  const all = [...items, ...wishlist]
  const place = context.item_id ? itemTitle(all.find(i => i.id === context.item_id) ?? ({} as Item))
    : context.outfit_id ? outfits.find(o => o.id === context.outfit_id)?.name || t('outfits.outfit')
    : context.inspiration_id ? t('agent.aLook')
    : context.entry_id ? shopping.find(s => s.id === context.entry_id)?.name
    : ({ wardrobe: t('nav.wardrobe'), wishlist: t('wardrobe.wishlist'), outfits: t('nav.outfits'), inspo: t('nav.inspo'), shop: t('nav.shop') } as Record<string, string>)[context.screen]

  const send = async (m = text.trim()) => {
    if (!m || !thread || busy) return
    setText(''); setBusy(true)
    const now = new Date().toISOString()
    setMsgs(x => [...x, { id: `local-${now}`, thread_id: thread, role: 'user', content: m, cards: [], actions: [], created_at: now }])
    const res = await supabase.functions.invoke('agent', { body: { thread_id: thread, message: m, context } })
    if (res.error) {
      let msg = res.error.message
      try { msg = (await (res.error as { context?: Response }).context?.json())?.error ?? msg } catch { /* keep the message */ }
      setMsgs(x => [...x, { id: `err-${now}`, thread_id: thread, role: 'assistant', content: t('agent.error', { msg }), cards: [], actions: [], created_at: now }])
    } else {
      const d = res.data as { id: string | null; reply: string; cards: AgentCard[]; actions: AgentMessage['actions']; changed: boolean }
      setMsgs(x => [...x, { id: d.id ?? `a-${now}`, thread_id: thread, role: 'assistant', content: d.reply, cards: d.cards, actions: d.actions, created_at: now }])
      if (d.changed) await reload()
    }
    setBusy(false)
    input.current?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }
  const newChat = () => { setThread(crypto.randomUUID()); setMsgs([]) }
  // A card changed (drawn or saved): keep it in the stored message too
  const patchCard = async (msg: AgentMessage, n: number, p: Partial<AgentCard>) => {
    const cards = msg.cards.map((c, i) => i === n ? { ...c, ...p } : c)
    setMsgs(x => x.map(m => m.id === msg.id ? { ...m, cards } : m))
    if (isId(msg.id)) await supabase.from('agent_messages').update({ cards }).eq('id', msg.id)
  }

  return (
    <Sheet title={t('agent.title')} onClose={onClose} sticky className="agent"
      top={<div className="agent-top">
        {place ? <span className="agent-place"><Icon name="eye" /> {t('agent.here', { place })}</span> : <span />}
        {msgs.length > 0 && <button className="btn ghost sm" onClick={newChat} disabled={busy}><Icon name="plus" /> {t('agent.newChat')}</button>}
      </div>}
      foot={<>
        <div className="agent-input">
          <textarea ref={input} rows={1} value={text} placeholder={t('agent.placeholder')} onChange={e => setText(e.target.value)} onKeyDown={onKey}
            onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }} />
          <button className="composer-send" onClick={() => send()} disabled={busy || !text.trim()} aria-label={t('agent.send')}><Icon name="send" /></button>
        </div>
        <p className="hint">{t('agent.cost', { draw: t('outfits.showOnMe') })}</p>
      </>}>
      {msgs.length === 0 && !busy && (
        <div className="agent-empty">
          <p className="muted">{t('agent.empty')}</p>
          <div className="agent-examples">
            {(context.item_id ? ['ex1', 'ex2'] : ['ex3', 'ex4']).map(k => (
              <button key={k} className="chip" onClick={() => { setText(t(`agent.${k}`)); input.current?.focus() }}>{t(`agent.${k}`)}</button>
            ))}
          </div>
        </div>
      )}
      {msgs.map(m => (
        <div key={m.id} className={'agent-msg ' + m.role}>
          {m.content && <div className="bubble">{m.content}</div>}
          {m.actions?.length > 0 && (
            <div className="agent-actions">
              {m.actions.map((a, n) => <span key={n} className="chip on small"><Icon name="check" /> {t(`agent.did.${a.tool}`, { text: a.text })}</span>)}
            </div>
          )}
          {m.cards?.map((c, n) => <AgentLook key={n} card={c} all={all} onPatch={p => patchCard(m, n, p)} />)}
        </div>
      ))}
      {busy && <div className="agent-msg assistant"><div className="bubble thinking">{t('agent.thinking')}</div></div>}
    </Sheet>
  )
}

// A look the assistant proposed: the pieces, then Save (free) and Show on me (draws her wearing it, ≈9¢)
function AgentLook({ card, all, onPatch }: { card: AgentCard; all: Item[]; onPatch: (p: Partial<AgentCard>) => Promise<void> }) {
  const { setOutfits } = useStore()
  const its = card.item_ids.map(id => all.find(i => i.id === id)).filter((i): i is Item => !!i)
  const [busy, setBusy] = useState<'' | 'save' | 'draw'>('')
  const [failed, setFailed] = useState(false)
  const save = async (image_path = card.image_path ?? null) => {
    const { data, error } = await supabase.from('outfits').insert({
      name: card.label.charAt(0).toUpperCase() + card.label.slice(1), layout: autoLayout(its), source: 'ai', notes: card.why, image_path,
    }).select().single()
    if (error) throw error
    setOutfits(upsert(data as Outfit))
    return (data as Outfit).id
  }
  const onSave = async () => {
    if (card.outfit_id) return go(`/o/${card.outfit_id}`)
    setBusy('save')
    try { await onPatch({ outfit_id: await save() }) } catch (e) { alert((e as Error).message) }
    setBusy('')
  }
  const draw = async () => {
    setBusy('draw'); setFailed(false)
    try {
      const r = await renderLook({ item_ids: card.item_ids, vibe: card.label, scene: card.scene })
      if (card.outfit_id) {
        const { data } = await supabase.from('outfits').update({ image_path: r.path }).eq('id', card.outfit_id).select().single()
        if (data) setOutfits(upsert(data as Outfit))
      }
      await onPatch({ image_path: r.path })
    } catch { setFailed(true) }
    setBusy('')
  }
  return (
    <div className="card look agent-look">
      {card.image_path ? <Photo path={card.image_path} alt={card.label} className="look-post" zoom />
        : busy === 'draw' ? <div className="look-wait"><FlatLay items={its} /><p><Icon name="sparkle" /> {t('looks.dressing')}</p></div>
        : <FlatLay items={its} />}
      <p className="look-label">{card.label}</p>
      {card.why && <p className="small">{card.why}</p>}
      {its.some(i => i.wishlist) && <p className="small muted">{t('agent.fromWish', { list: its.filter(i => i.wishlist).map(itemTitle).join(', ') })}</p>}
      <div className="row wrap">
        {!card.image_path && (
          <button className="btn sm" onClick={draw} disabled={!!busy}>
            <Icon name="sparkle" /> {failed ? t('looks.drawError') : t('outfits.showOnMe')}<span className="cost">(OpenAI ≈9¢)</span>
          </button>
        )}
        <button className="btn sm" onClick={onSave} disabled={!!busy}>
          <Icon name="heart" filled={!!card.outfit_id} /> {card.outfit_id ? t('common.saved') : t('outfits.save')}
        </button>
      </div>
    </div>
  )
}
