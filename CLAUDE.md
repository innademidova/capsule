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

- **Everything in the repo is English: app UI, code comments, README, docs and commit messages. No Cyrillic in code at all** (owner's request, 2026-11-09). AI prose results shown in the app stay Ukrainian. Chat replies to the owner: in her language, plain and non-technical.
- Hosting must stay free (GitHub Pages + Supabase free tier). Ask before anything that costs money.
- She is often on limited mobile internet (2 GB): avoid unnecessary downloads, install packages with
  `npm install --prefer-offline`, warn before anything large.
- Photos ARE compressed, but quality must stay high (she worries it will look bad): full 1600px WebP q0.9,
  gallery thumbs 600px. Never crop clothing; show on white with `object-fit: contain`.
- Design: neutral "fashion" look so the clothes stand out (warm off-white, ink black accents, Manrope, rounded white
  cards, floating pill tab bar, light + dark). She likes the Perfume Diary design too; switching is fine if she asks.

## Features (all 5 stages built on 2026-10-31; she tests them on the phone)

1. **Digital wardrobe**: items with photo, category, type, colors, season, style, occasion, brand, notes; gallery with
   category chips, filters, search; favorites; "Wore it today"; "Build outfit" from an item. Background removal: iPhone
   "lift subject" → Copy → **Paste** in the app; transparent edges are auto-trimmed. "Fill in with AI" tags from the photo.
2. **Outfits**: canvas editor (drag, resize, front, remove; positions in % in `outfits.layout`), save, favorite,
   "I wore this today" (`wear_log`). `autoLayout()` in lib.ts places items by category.
3. **AI stylist** (`#/stylist`): occasion + weather (Open-Meteo by location) + mood → 3 outfit ideas from HER items,
   "Save outfit" turns an idea into an outfit.
4. **Inspiration**: screenshots → breakdown (formula, pieces have/similar/missing with her item ids, to buy);
   "Find my formulas" across analyzed looks → `style_profile`.
5. **Shop**: wardrobe check (gaps / too many / strengths → add to shopping list), shopping list, "Before you buy"
   (photo from a shop → verdict, pairs_with, similar, outfit ideas). Me tab: stats, most worn, not worn for a month+.

**Wishlist** (optional shop `link` on items, shown as "Open in shop"; `#/wish`, switch on the Wardrobe screen): same cards, stored in `items` with `wishlist = true`; `store.items` is wardrobe only, so the stylist, outfits, stats and AI never see wishlist pieces. "I bought it" moves a piece to the wardrobe. To add one by script, put `"wishlist":true` in the JSON for `scripts/add-item.mjs`.

**Enhance with AI** (button inside the new-item form, `ItemForm` in `src/Wardrobe.tsx`): uses the chosen photo right away (asks for one if none); optional instructions typed before the run become the first correction; the Name field, if filled, says which piece → Edge Function `garment` (`gpt-image-2.6-sunburst`, medium quality, needs Supabase secret `OPENAI_API_KEY`) writes a draft to `photos/<uid>/drafts/`. She approves it ("Add" saves the item) or regenerates: corrections accumulate and the previous attempt is sent with the original. Tags are filled into the form from the draft, so "Fill in with AI" is hidden while a draft is shown. Deploy like `ai`.

Test data: the 15 illustrated basics from `scripts/seed-basics.mjs` were deleted on 2026-11-04 at her request; her real
items start with the beige cropped trench (2026-11-04). Do not seed test items again.

## AI: two modes, her choice per action (same pattern as perfume-diary)

Photo tagging (`tag`, "Fill in with AI") runs on OpenAI (`gpt-6.1-terra`, secret `OPENAI_API_KEY`); every other "now" action uses Claude. Every AI action creates a row in `ai_requests` (kind `tag|outfits|inspo|formulas|gaps|buy`).
- **"… now"**: the app calls Edge Function `ai` (`supabase/functions/ai/index.ts`, **Claude Opus 5.5** with JSON-schema
  structured outputs, server-side refusal fallback), ≈1–4¢ per request. Needs Supabase secret `ANTHROPIC_API_KEY`
  (and `ANTHROPIC_WORKSPACE_ID` if her key requires it — it does for the perfume diary key). **Not set yet** (as of
  2026-10-31): "now" returns "AI key is not set up yet" and the UI offers "Add to queue instead".
- **"Add to queue"**: free; processed by Claude Code when she asks to process the queue (in Russian: "obrabotai ochered").
- A DB trigger (`apply_ai_result`) copies finished results where they belong: `inspo` → `inspirations.analysis`,
  `formulas` → `style_profile`, bulk `tag` → fills empty item fields. `outfits`, `gaps`, `buy`, single-photo `tag`
  results are read straight from `ai_requests.result`.
- Result shapes = `SCHEMAS` in the Edge Function. Prose fields in **Ukrainian addressing her informally (second person singular)**, labels in English.

Deploy the function: `npx supabase functions deploy ai --project-ref ajbdkvpyhoyzzzlrlttk --use-api`
(the CLI is in the npx cache; `npx` may download it otherwise). Set the key: `npx supabase secrets set ANTHROPIC_API_KEY=… --project-ref ajbdkvpyhoyzzzlrlttk`.

## Workflow: process the AI queue

1. `node scripts/ai-queue.mjs export <scratch dir>` → `ctx.json` (queued requests, wardrobe with wear counts,
   inspirations with analyses, style profile) + downloaded photos (`local_image` paths).
2. For each request, look at the images (Read the local files) and write the result in the exact shape of
   `SCHEMAS[kind]` in the Edge Function, following the same prompt rules as `buildPrompt()` there. Use only real item ids.
   - `tag` without image_path = bulk: result `{"items":[{id,name,kind,colors,seasons,styles,occasions}]}` for `untagged`.
   - `formulas`: also include `"based_on": <number of analyzed looks>`.
3. Write `{"results":[{"id":…,"result":{…}}]}` and run `node scripts/ai-queue.mjs apply res.json`.
4. Tell her briefly what was done; the app refreshes when she reopens it.

## Stack and layout

- React 19 + Vite + TypeScript, `vite-plugin-pwa` (autoUpdate). No router lib: hash routes in `src/App.tsx`
  (`#/`, `#/i/new`, `#/i/<id>`, `#/i/<id>/edit`, `#/outfits`, `#/inspo`, `#/me`).
- `src/lib.ts` Supabase client, types, option lists (categories, kinds, colors with hex, seasons, styles, occasions),
  signed URL cache (batched), photo processing (`processPhoto`: stepped high-quality downscale, trims transparent
  margins, WebP with PNG/JPEG fallback), upload/remove, clipboard paste.
- `src/store.tsx` one context with all data (items, outfits, wear, inspirations, profile, shopping, requests).
- `src/Wardrobe.tsx` list + filters, item detail, add/edit form. `src/Outfits.tsx` outfits, editor, stylist.
  `src/Inspo.tsx` inspiration + formulas. `src/Shop.tsx` wardrobe check, shopping list, before-you-buy.
- `src/ui.tsx` icons, chips, swatches, Photo, Header, Collage, AIActions (now/queue buttons), RequestState, Sheet.
- `src/App.tsx` auth, routing (`#/`, `#/i/…`, `#/outfits`, `#/o/…`, `#/o/new/<itemId>`, `#/stylist`, `#/inspo`,
  `#/n/<id>`, `#/shop`, `#/buy`, `#/me`), 5-tab bar, Me screen. Data reloads when the app becomes visible again.
- `supabase/schema.sql` full schema; apply changes via the Management API (append new statements to this file too).
- `scripts/add-item.mjs <photo> <json>` adds an item and prepares its photo.
- Costs: every paid OpenAI call logs exact tokens and USD to `ai_usage` (prices are constants in the functions; update them if OpenAI changes pricing). Measured 2026-11-10: Enhance ≈6.2¢ per image, tagging ≈0.3¢.
- `scripts/garment.mjs <photo> <out.png> ['<piece>'] ['<correction>'...]` runs the `garment` function (Enhance with AI, ≈6¢) on a local photo. Use it when the cutout cannot work: a person in the photo, or a fake checkerboard "transparency" baked into the image; then add the result with `KEEP=1 ALPHA=230`.
- `scripts/cutout.mjs <photo> <item id>` removes a plain light background (edge colour + enclosed holes) and replaces the item photo/thumb; `<photo> x <out.png>` = preview only. Use it when she sends item photos to add. Env: `TOL` (default 26, 7 for near-white garments on white), `WARM=1` + `MINL` (light warm garment on grey), `KEEP=1` (PNG already transparent; add `ALPHA=230` to drop a soft glow around it).
- `scripts/ai-queue.mjs` export/apply for the free AI queue. `scripts/seed-basics.mjs` test items.
- `scripts/icons.mjs` regenerates PNG icons from `public/favicon.svg` (borrows `sharp` from perfume-diary).

## Data (Supabase project "Style", ref `ajbdkvpyhoyzzzlrlttk`, free plan: 1 GB storage)

- `outfits` (layout jsonb `[{item_id,x,y,w,z}]`, occasions, seasons, notes, favorite, source manual|ai), `wear_log`
  (worn_on, outfit_id, item_ids[]), `inspirations` (image, note, analysis jsonb), `style_profile` (one row),
  `shopping` (name, category, why, priority 1–3, done), `ai_requests` (see AI section). All RLS "own rows".
- `items`: name, category (`top|bottom|dress|outerwear|shoes|bag|accessory|swim`), kind (lowercase English), colors[],
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
