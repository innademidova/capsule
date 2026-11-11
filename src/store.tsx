import { createContext, useContext } from 'react'
import type { Item, Outfit, Inspiration, StyleProfile, ShopItem, AIRequest } from './lib'

// All app data in one place
export type Store = {
  items: Item[]; wishlist: Item[]; outfits: Outfit[]; inspirations: Inspiration[]
  profile: StyleProfile | null; shopping: ShopItem[]; requests: AIRequest[]
  setItems: (f: (x: Item[]) => Item[]) => void
  setOutfits: (f: (x: Outfit[]) => Outfit[]) => void
  setInspirations: (f: (x: Inspiration[]) => Inspiration[]) => void
  setShopping: (f: (x: ShopItem[]) => ShopItem[]) => void
  setRequests: (f: (x: AIRequest[]) => AIRequest[]) => void
  reload: () => Promise<void>
}
export const StoreCtx = createContext<Store>(null as never)
export const useStore = () => useContext(StoreCtx)

export const upsert = <T extends { id: string }>(x: T) => (list: T[]) => [x, ...list.filter(y => y.id !== x.id)]
export const without = <T extends { id: string }>(id: string) => (list: T[]) => list.filter(y => y.id !== id)
