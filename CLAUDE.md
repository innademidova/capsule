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

- **Everything in the repo is English: code comments, README, docs and commit messages. No Cyrillic in code at all** (owner's request, 2026-11-09). The only place for Ukrainian text is the translation file `src/locales/uk.json` (approved 2026-11-14). Chat replies to the owner: in her language, plain and non-technical.
- **Interface languages: Ukrainian and English** (2026-11-14). Code never contains UI text, only keys: `t('section.key')` from `src/i18n.ts` (own tiny module, i18next-compatible JSON: nested keys, `{{var}}`, plural suffixes `_one/_few/_many/_other`). Every new text goes into BOTH `src/locales/en.json` and `uk.json`. The choice is in Profile → Account → Language, stored in `profiles.language` and localStorage; switching reloads the page. Dictionary defaults (colors, kinds, materials, styles, occasions, categories, seasons) are translated by id (`color.black`, `kind.sweater`, `material.cotton`); items keep storing the English ids/words, `kindLabel/kindId` and `materialLabel/materialName` in `lib.ts` convert. Her own entries and renames (`dict_effective.renamed`) are shown as typed. The `ai` function writes prose in the account language; look labels/titles/scenes (drawn on images) and `kind` stay English.
- Hosting must stay free (GitHub Pages + Supabase free tier). Ask before anything that costs money.
- She is often on limited mobile internet (2 GB): avoid unnecessary downloads, install packages with
  `npm install --prefer-offline`, warn before anything large.
- Photos ARE compressed, but quality must stay high (she worries it will look bad): full 1600px WebP q0.9,
  gallery thumbs 600px. Never crop clothing; show on white with `object-fit: contain`.
- Design: neutral "fashion" look so the clothes stand out (warm off-white, ink black accents, Manrope, rounded white
  cards, floating pill tab bar, light + dark). She likes the Perfume Diary design too; switching is fine if she asks.

## Features (all 5 stages built on 2026-10-31; she tests them on the phone)

1. **Digital wardrobe**: items with photo, category, type, colors, season, style, occasion, brand, composition (`materials` jsonb `[{name, pct|null}]`, suggestions from the `materials` table), notes; gallery with
   category chips, filters, search; favorites; "Build outfit" from an item. Background removal: iPhone
   "lift subject" → Copy → **Paste** in the app; transparent edges are auto-trimmed. "Fill in with AI" tags from the photo.
2. **Outfits**: canvas editor (drag, resize, front, remove; positions in % in `outfits.layout`), save, favorite, `autoLayout()` in lib.ts places items by category.
3. **AI stylist** (`#/stylist`): occasion + weather (Open-Meteo by location) + mood → 3 outfit ideas from HER items,
   "Save outfit" turns an idea into an outfit.
4. **Inspiration**: screenshots → breakdown (formula, pieces have/similar/missing with her item ids, to buy);
   "Find my formulas" across analyzed looks → `style_profile`.
5. **Shop**: wardrobe check (gaps / too many / strengths → add to shopping list), shopping list, "Before you buy"
   (photo from a shop → verdict, pairs_with, similar, outfit ideas). Profile tab (`#/me/<tab>`, `src/Profile.tsx`): Overview (stats), Account (name, email, password), Preferences (appearance, own look format), Dictionaries (own lists), Settings (admins only).

**Wishlist** (optional shop `link` on items, shown as "Open in shop"; `#/wish`, switch on the Wardrobe screen): same cards, stored in `items` with `wishlist = true`; `store.items` is wardrobe only, so the stylist, outfits, stats and AI never see wishlist pieces. "I bought it" moves a piece to the wardrobe. To add one by script, put `"wishlist":true` in the JSON for `scripts/add-item.mjs`.

**Enhance with AI** (button inside the new-item form, `ItemForm` in `src/Wardrobe.tsx`): uses the chosen photo right away (asks for one if none); optional instructions typed before the run become the first correction; extra photos of the same piece (up to 8, `ref_paths`) can be added before the run and with each fix; the Name field, if filled, says which piece → Edge Function `garment` (`gpt-image-2.6-sunburst`, medium quality, needs Supabase secret `OPENAI_API_KEY`) writes a draft to `photos/<uid>/drafts/`. She approves it ("Add" saves the item) or regenerates: corrections accumulate and the previous attempt is sent with the original. Tags are filled into the form from the draft (plus the original photos and her instructions, so brand and composition come from a readable logo/label or her words, never guessed), so "Fill in with AI" is hidden while a draft is shown. Deploy like `ai`.

**Sets** (suit, co-ord): the "It's a set" checkbox before Enhance sends `set: true`; the garment prompt draws every piece side by side with empty space between them, so one generation keeps the colour identical. `splitSet()` (lib.ts, logic in `src/pieces.ts`, testable in Node with `--experimental-strip-types`) cuts the image into one PNG per opaque island; each piece is tagged separately and saved as its own item with a shared `items.set_id`. The form's shared fields (brand, composition, seasons, styles, occasions, notes) apply to all pieces. The detail page shows "Part of a set" and "Outfit with the whole set" (`#/o/new/<id>,<id>`); the stylist sees a set code per item. The cream waistcoat + wide-leg trousers were linked by hand. `scripts/garment.mjs` takes `SET=1`. Measured: ≈4.4¢ for a two-piece set image plus ≈0.3¢ per piece for tags.

**Looks** (`src/Looks.tsx`, built 2026-11-10; on 2026-11-11 she asked to draw every look right away, in the format of a layout reference, and to drop the free queue everywhere): AI task `looks` (OpenAI `gpt-6.1-terra`, ≈1.2¢) returns `{title, palette[hex], looks[{label, item_ids, why, scene}], missing, note}`. (1) "Style it" on an item → `#/style/<id>`, 4 looks that all include it. (2) Outfit detail "Show on me". (3) `#/stylist` = the assistant: free-text request + weather → 3 looks (the old occasion/mood stylist screen was replaced). "Show on me" calls Edge Function `look` (`gpt-image-2.6-sunburst`, 1024x1536 webp, ≈6.7¢ with 4 pieces): a woman described by `style_profile.appearance` (written by Claude from her photos on 2026-11-10, editable in Profile → Preferences) wearing exactly the item photos; saved to `photos/<uid>/looks/`. Every AI image copies the layout of a **template** for its purpose (`TEMPLATES` in lib.ts: `look` = one outfit on her, `many` = one piece, many looks): the user's own `style_profile.templates[<id>]`, else the global `app_settings` key `template:<id>` (`photos/global/reference/`). "Style it" draws ONE collage with the `many` template (`look` function `{many: {anchor_id, title, looks, palette}}`, ≈13.5¢ for 4 looks vs ≈35¢ for 4 separate images; path in `ai_requests.result.collage_path` via `set_request_collage`); each look can still be drawn large on its own. Her photo on the left, the pieces and the palette dots on the right, no text. Templates are replaced in Profile → Preferences (own) or Settings → Default image templates (admin). "Style it" (4 looks ≈30¢) and the assistant (3 looks ≈22¢) draw all looks in parallel; the function writes each path into the request with the `set_look_image` SQL function. The photo path is written back into `ai_requests.result.looks[n].image_path` and into `outfits.image_path`. Test from the terminal: `scripts/try-looks.mjs`.
Without `ANTHROPIC_API_KEY` every "now" AI task runs on OpenAI (`useOpenAI()` in the `ai` function).

**Roles and dictionaries** (2026-11-11, `supabase/migrations/20261111_roles_and_shared_dicts.sql`): `user_roles` (admin|user; users can read but never write it; `is_admin()`; `admin_set_role` keeps at least one admin; new accounts get `profiles` + role `user` by trigger), `profiles` (display_name). Dictionaries (brand, material, color, kind, style, occasion): `dict_global` = defaults, admins write; `dict_user` = per-user overrides (same id: label/hex/sort or `hidden`; new id: own entry); view `dict_effective` (security_invoker) = what the app (`applyDict`, also fills `BRANDS`/`MATERIALS`) and the `ai` function use. Colors/styles/occasions are stored in items by id; brands/materials/kinds by text (id = lowercase). User edits touch only their overrides and their own items (`src/Dictionaries.tsx`, scope 'user'); admin edits go through `admin_rename_dict` (renames text values on every user's items) and `admin_delete_dict` (users whose items use the value keep it as an own entry). `app_settings` (key/value, admins write). Storage `photos/global/` readable by all signed in, writable by admins. Inna is the only admin. Sign-up is disabled in Supabase Auth (accounts are created by hand).

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
- Result shapes = `SCHEMAS` in the Edge Function. Prose and the labels she reads are in the account language (`profiles.language`, default Ukrainian, informal second person); kind, look labels and titles stay English.

Deploy the function: `npx supabase functions deploy ai --project-ref ajbdkvpyhoyzzzlrlttk --use-api`
(the CLI is in the npx cache; `npx` may download it otherwise). Set the key: `npx supabase secrets set ANTHROPIC_API_KEY=… --project-ref ajbdkvpyhoyzzzlrlttk`.

## Workflow: process the AI queue (UI removed on 2026-11-11 at her request; kept for old queued rows)

1. `node scripts/ai-queue.mjs export <scratch dir>` → `ctx.json` (queued requests, wardrobe,
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
- `src/store.tsx` one context with all data (items, outfits, inspirations, profile, shopping, requests).
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

- `outfits` (layout jsonb `[{item_id,x,y,w,z}]`, occasions, seasons, notes, favorite, source manual|ai),
  `inspirations` (image, note, analysis jsonb), `style_profile` (one row),
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
PWA updates: the service worker uses skipWaiting + clientsClaim (vite.config.ts) and `src/main.tsx` reloads the page when a new version takes control and checks for updates on focus. Without skipWaiting a new version stayed "waiting" until every Capsule tab was closed. To check what a browser runs, compare its `index-*.js` with the live one.

## Testing notes

- Headless Chrome on this Mac can't be used for canvas `toBlob` (never resolves) or Supabase calls (fetch fails), so
  photo processing must be checked on a real device. Node + supabase-js works for API/RLS checks.

**AI providers** (2026-11-12, her decision: no Gemini anywhere, she did not like its results): every AI task runs on her OpenAI key (`OPENAI_API_KEY`). Text tasks (`ai` function): `gpt-6.1-terra`. Images (`look`, `garment`): `gpt-image-2.6-sunburst` (collage quality high, others medium). The Claude path in `ai` only runs without an OpenAI key (no Claude key is set). The `GEMINI_API_KEY` secret is unused. Never run paid generations for testing without her approval. The answering model is stored in `ai_requests.model`. Test: `node scripts/try-ai.mjs <kind> '<json>' [image_path]`.

**Image templates** (2026-11-12, table `image_templates`, migration `20261112_image_templates_with_prompts.sql`): one per purpose (`look`, `many`, `garment`; `TEMPLATES` in lib.ts): a layout picture + the instruction text for the image model, so she can change both without a deploy. A row with `user_id` null is the default (admins); a user's own row overrides it field by field (null = default). The text holds `{placeholders}` (list per purpose in `supabase/functions/_shared/templates.ts` and lib.ts) that the functions fill; the functions append only the technical part (which attached image is which, the looks, shoes/bag notes, set layout, her corrections). Editor (`TemplateEditor` in `src/Dictionaries.tsx`, Profile → Preferences and Settings): replace picture (the AI screenshot clean-up was removed on 2026-11-12 at her request), edit the text, "Write them from the picture" (`ai` task `template_prompt`, OpenAI ≈1¢: rewrites the text for a new picture), "Show the full prompt" (free: `look`/`garment` with `preview: true` return the assembled prompt), back to the defaults. "Style it" draws one collage (`result.collage_path`, can be saved to outfits: `result.collage_outfit_id`).
