# Capsule — project context for Claude

A personal wardrobe + AI stylist PWA for one user (the owner, not a developer). Problem: plenty of clothes but
"nothing to wear" — she doesn't see how to combine pieces, saves lots of Instagram looks without seeing a pattern,
and buys the wrong things (five similar sweaters, no basic shoes or outerwear). Goal: dress well with a small,
well-combined wardrobe. Claude does all technical work; the owner talks in Russian and decides on features and design.

Live: https://innademidova.github.io/capsule/ (to be installed on her iPhone via Safari → Add to Home Screen)
Repo: github.com/innademidova/capsule · local: `~/projects/capsule`
Sister project with the same stack and conventions: `~/projects/perfume-diary` (read its CLAUDE.md for proven patterns:
AI queue processed by Claude Code for free, Edge Function with Claude API, scripts).

## Hard rules from the owner

- **App UI is English.** All other non-English text (code comments, README, commit messages) must be **Ukrainian.
  Never Russian anywhere in the project.** Chat replies to the owner: in her language, plain and non-technical.
- Hosting must stay free (GitHub Pages + Supabase free tier). Ask before anything that costs money.
- She is often on limited mobile internet (2 GB): avoid unnecessary downloads, install packages with
  `npm install --prefer-offline`, warn before anything large.
- Photos ARE compressed, but quality must stay high (she worries it will look bad): full 1600px WebP q0.9,
  gallery thumbs 600px. Never crop clothing; show on white with `object-fit: contain`.
- Design: neutral "fashion" look so the clothes stand out (warm off-white, ink black accents, Manrope, rounded white
  cards, floating pill tab bar, light + dark). She likes the Perfume Diary design too; switching is fine if she asks.

## Roadmap (stages; build one at a time, deploy, she tests on the phone)

1. ✅ **Digital wardrobe**: add items (photo, category, type, colors, season, style, occasion, brand, notes), gallery with
   category chips, filters and search, item card, favorites. Background removal: iPhone "lift subject" → Copy →
   **Paste** button in the app (clipboard API); transparent edges are auto-trimmed.
2. **Outfits**: build looks on a canvas (flat lay) from items, save, favorite, "wore today".
3. **AI stylist**: auto-tagging from the photo; outfit suggestions from HER wardrobe for occasion/weather/mood with
   reasons. Consider the perfume-diary pattern: paid "now" (Edge Function + Claude Haiku) vs free queue processed by
   Claude Code.
4. **Inspiration board**: Instagram screenshots → break a look into pieces, match with owned items, what's missing;
   across all saved looks find her recurring style formulas.
5. **Wardrobe analysis & shopping**: gaps, too-many, prioritised shopping list, "before you buy" check (photo from a
   shop → how many owned items it combines with, does she already own something similar), never-worn items.

## Stack and layout

- React 19 + Vite + TypeScript, `vite-plugin-pwa` (autoUpdate). No router lib: hash routes in `src/App.tsx`
  (`#/`, `#/i/new`, `#/i/<id>`, `#/i/<id>/edit`, `#/outfits`, `#/inspo`, `#/me`).
- `src/lib.ts` Supabase client, types, option lists (categories, kinds, colors with hex, seasons, styles, occasions),
  signed URL cache (batched), photo processing (`processPhoto`: stepped high-quality downscale, trims transparent
  margins, WebP with PNG/JPEG fallback), upload/remove, clipboard paste.
- `src/Wardrobe.tsx` list + filters, item detail, add/edit form. `src/ui.tsx` icons, chips, swatches, Photo, Header.
- `src/App.tsx` auth, routing, tab bar, "Coming soon" tabs, Me (stats + roadmap + sign out).
- `supabase/schema.sql` full schema; apply changes via the Management API (append new statements to this file too).
- `scripts/icons.mjs` regenerates PNG icons from `public/favicon.svg` (borrows `sharp` from perfume-diary).

## Data (Supabase project "Style", ref `ajbdkvpyhoyzzzlrlttk`, free plan: 1 GB storage)

- `items`: name, category (`top|bottom|dress|outerwear|shoes|bag|accessory`), kind (lowercase English), colors[],
  seasons[], styles[], occasions[], brand, notes, photo_path, thumb_path, favorite. RLS "own rows only".
- Storage bucket `photos` (private, signed URLs valid 24h), path `<user_id>/<uuid>.webp` + `<uuid>_thumb.webp`.
  Policy: only the user's own folder.
- Auth: signups disabled; single user `doc.idemidova@gmail.com` (same password as the perfume diary). Password in
  `.env.local` (`CAPSULE_EMAIL`, `CAPSULE_PASSWORD`, git-ignored).
- Publishable key is in `src/lib.ts` (safe: RLS + login).

## Access in a new session

- GitHub: `gh` logged in as `innademidova`; this repo pushes through `gh auth git-credential` (local git config).
  Git on this Mac defaults to a work account — don't touch global git config.
- Supabase: the CLI access token in Keychain (see perfume-diary `scripts/sql.mjs` for how to read it) works for the
  Management API: `POST https://api.supabase.com/v1/projects/ajbdkvpyhoyzzzlrlttk/database/query`.
  If it returns 401, the token expired: ask her for a new one (`! npx supabase login --token sbp_…`).

## Deploy

`npm run deploy` (builds and force-pushes `dist` to the `gh-pages` branch; Pages in legacy branch mode), then commit +
push `main`. After deploy, tell her to close and reopen the app on the iPhone (PWA cache).

## Testing notes

- Headless Chrome on this Mac can't be used for canvas `toBlob` (never resolves) or Supabase calls (fetch fails), so
  photo processing must be checked on a real device. Node + supabase-js works for API/RLS checks.
