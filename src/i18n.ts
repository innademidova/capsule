// Interface language. Texts live in src/locales/<lang>.json (the same format as i18next: nested keys,
// {{name}} placeholders, plural forms as key_one / key_few / key_many / key_other), the code only uses keys.
// The choice is kept on this device (localStorage) and in the account (profiles.language), so every device agrees.
// Changing it reloads the page: every label, including the lists in lib.ts, is then built in the new language.
import en from './locales/en.json'
import uk from './locales/uk.json'

// Each language is shown by its own name: languages.<id> in the locale files
export const LANGUAGES = ['uk', 'en'] as const
export type Lang = typeof LANGUAGES[number]

type Tree = { [k: string]: string | Tree }
const BUNDLES: Record<Lang, Tree> = { en, uk }
const KEY = 'lang'

const isLang = (v: unknown): v is Lang => LANGUAGES.includes(v as Lang)

function detect(): Lang {
  try { const saved = localStorage.getItem(KEY); if (isLang(saved)) return saved } catch { /* private mode */ }
  const nav = (navigator.languages ?? [navigator.language]).map(l => l.slice(0, 2))
  return nav.find(isLang) ?? (nav.includes('ru') ? 'uk' : 'en')
}

export let lang: Lang = detect()
document.documentElement.lang = lang
const plural = () => new Intl.PluralRules(lang)

function lookup(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

type Vars = Record<string, string | number> & { count?: number; defaultValue?: string }

// t('wardrobe.title'), t('item.inOutfits', { count: 3 }), t('color.black', { defaultValue: 'Black' })
export function t(key: string, vars: Vars = {}): string {
  const find = (k: string) => lookup(BUNDLES[lang], k) ?? lookup(BUNDLES.en, k)
  let text: string | undefined
  if (typeof vars.count === 'number') text = find(`${key}_${plural().select(vars.count)}`) ?? find(`${key}_other`)
  text ??= find(key) ?? vars.defaultValue ?? key
  return text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => k in vars ? String(vars[k]) : m)
}

// Is there a translation for this key (used for dictionary values: only the defaults have one)
export const has = (key: string) => lookup(BUNDLES[lang], key) !== undefined

// Saves the choice on this device; true if it changed and was saved (then the page has to be reloaded).
// Without storage (private mode) it switches in place for this page only, so a reload can never loop.
export function remember(next: string | null | undefined): boolean {
  if (!isLang(next) || next === lang) return false
  try {
    localStorage.setItem(KEY, next)
    if (localStorage.getItem(KEY) === next) return true
  } catch { /* private mode */ }
  lang = next; document.documentElement.lang = lang
  return false
}

export const formatDate = (d: string | Date) => new Date(d).toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-GB')
