# Image Extender

> Seamlessly extend any image in any direction with AI — then build whole 2D
> game art sets (parallax backgrounds, autotiles, sprite animations, and
> decoration props) from the same studio.

A small open-source web app for AI outpainting **and** 2D game-art generation.
It defaults to Google's Gemini image models via [OpenRouter](https://openrouter.ai),
but Settings can route Image / Text / Vision workloads to different custom
providers. The Poisson-blending pipeline hides the seam between original and
AI-generated pixels, plus purpose-built pipelines for tiles, sprites, and props.

Bring your own provider API key — it stays in your browser, never on the server.

![A 1024² portrait shot extended into a cinematic wide-angle scene with no visible seam](docs/screenshots/after.png)

## Before / After

A single 1024 × 1024 phone-style portrait → a wide 16:9 cinematic frame, in
a few clicks. Same colors, same lighting, same wet-pavement reflections —
just much, much more of them.

| Before · 1024 × 1024 | After · extended L+R into a cinematic wide |
| --- | --- |
| ![Square portrait shot of a person in a yellow jacket on a neon-lit Brooklyn corner](docs/screenshots/before.png) | ![The same scene extended sideways into a wide cinematic frame](docs/screenshots/after.png) |

## Five modes — Extender + Parallax + Tiles + Sprites + Props

The app ships as a tiny studio with five workspaces, switchable from the pill
in the top bar:

- **Extender** (default) — outpaint any image in any of four directions, with a
  best-of-3 seam-quality variant picker.
- **Parallax Studio** — build a real, multi-layer sidescroller background from
  scratch: separate **Sky / Far / Mid / Near** layers, role-aware AI prompts,
  chroma-keyed transparent layers, a live multi-layer scrolling preview,
  auto-extend to a target width, tileable-loop healing, and one-click ZIP export
  with a JSON manifest.
- **Tile Studio** — a 13-tile autotile set for 2D platformers (body + 4 edges
  + 4 outer corners + 4 inner corners) generated in **one** AI call as a 4×4
  sprite-sheet, with deterministic corner reconciliation and an AI "art
  director" QA/repaint loop. Palette and texture detail stay locked across the
  whole set.
- **Sprite Studio** — character & creature animations as a single AI-call sheet.
  Pick a **body plan** (humanoid, quadruped, serpent/fish, flyer/bird, or blob),
  pick an animation, describe the creature, and get a keyframe sheet back with a
  live animation player and engine-ready export. Each body plan drives its own
  anatomy-specific pose-guide rig and animation set.
- **Props Studio** — an open-ended, ever-growing library of standalone
  transparent **decoration sprites** (the kind games layer on top of the tile
  map) generated 8 at a time, driven by a two-call "art director → painter"
  pipeline that keeps the set varied and never repetitive.

### Parallax Studio
![Parallax Studio — Sky / Far / Mid / Near depth layers with a live multi-layer scrolling preview and ZIP export](docs/screenshots/mode-parallax.png)

### Tile Studio
![Tile Studio — a 13-tile autotile set generated in one call, with a live "how tiles fit together" platform preview](docs/screenshots/mode-tiles.png)

### Props Studio
![Props Studio — an open-ended decoration library of transparent scatter sprites grown 8 at a time](docs/screenshots/mode-props.png)

### Sprite Studio
![Sprite Studio — a character walk-cycle keyframe sheet with a live looping animation player](docs/screenshots/mode-sprite.png)

## Features

- **Click an edge → extend in that direction.** Spatial controls on the image,
  no dialog-tree UX.
- **Best-of-3 variant picker.** Every extension generates up to 3 candidates,
  sorted by seam quality. Cycle through them with `← →` and pick the one
  you like before accepting.
- **Poisson-blended seams.** Uses gradient-domain image editing (Pérez et al.
  2003) with mask-grow + replicate-padded Gauss-Seidel iterations to make the
  AI-original boundary mathematically invisible.
- **Pre-correction for low-frequency color drift.** Bulk-shifts the AI output
  toward the original's color at the seam before blending, which fixes the
  "the sky got slightly bluer" failure mode common to outpainting.
- **Optional prompt + art style.** Leave the prompt blank for pure scene
  continuation, or add specific instructions like *"add an alien moon
  rising on the horizon"*.
- **Custom art styles.** 40+ styles from cinematic and oil painting to
  Studio Ghibli, cyberpunk, vaporwave, etc.
- **BYOK (Bring Your Own Key).** Provider keys are stored only in your
  browser's `localStorage`. The server proxies requests to the configured
  provider but never logs or persists the key.
- **Model + provider picker.** Switch default OpenRouter models from Settings,
  or configure separate Image / Text / Vision providers with their own base
  URLs, API keys, protocols, and models.
- **Keyboard-first.** Arrow keys to extend, `←`/`→` to cycle variants,
  `Enter` to accept, `R` to regenerate, `Esc` to discard.
- **Generate from scratch.** Don't have a base image? Generate one with a
  text prompt first, then extend.
- **Shared scene brief.** One auto-generated "scene brief" (setting, time of
  day, palette, mood) is distilled from your prompt and reused across Parallax,
  Tiles, Sprites, and Props so every asset in a project feels like one world.

### Parallax Studio (for game designers)

- **4 real depth layers.** Sky (back, opaque), Far (distant silhouettes), Mid
  (mid-ground), Near (foreground props). Pick a card on the left, edit just
  that layer in the canvas — the same extend pipeline as Extender, but the
  studio knows what each layer is for.
- **Role-aware AI prompts.** When you generate or extend a layer, the model
  is told its role and asked to produce only that depth band. Far / Mid / Near
  come back rendered against a flat magenta key (`#FF00FF`) which the client
  replaces with real alpha — so each layer composites cleanly over the sky.
- **Live multi-layer preview.** Stacked, GPU-accelerated `repeat-x` scroll for
  every populated layer, each at its own adjustable speed (Sky drifts slow,
  Near runs fast). Tweak per-layer speed sliders and feel the depth in real
  time before exporting.
- **Locked horizontal extension.** Only `←` and `→` are exposed — vertical
  extends would warp the game height, so they're suppressed.
- **Auto-extend to target width.** Pick a target (e.g. 7680px = 4 × 1080p
  screens) and walk away. The studio repeatedly extends the active layer
  right, auto-accepts the best variant, re-applies chroma-keying, and stops
  when the target width is reached. Click `Stop` to interrupt.
- **Tileable loop point.** Game engines tile parallax backgrounds with
  `repeat-x`. The `Tileable` button does the standard "offset by half / heal
  the new middle seam / offset back" pass so the texture loops invisibly. It
  also **auto-runs at the end of auto-extend** so the default exported result
  Just Works.
- **Harmonize seams.** A separate optional pass for the *other* common problem:
  each AI extend introduces a tiny color/brightness shift, and over many
  extensions those shifts pile up into vertical "panel banding". The
  `Harmonize` button runs a column-mean smoothing that kills the banding while
  preserving fine detail.
- **Width presets.** Quick-pick common targets (3840 / 5120 / 7680 / 10240 /
  15360 px) corresponding to multiples of 720p / 1080p screens.
- **One-click ZIP export.** Bundle all populated layers as PNGs (with alpha
  preserved) plus a `parallax.json` manifest listing depth order, scroll
  speeds, and dimensions — drop the ZIP into Unity / Godot / Phaser and wire
  it straight into your parallax controller.

### Tile Studio (2D platformer autotiles)

- **Whole 13-tile set in one AI call.** Body + 4 straight edges + 4 outer
  (convex) corners + 4 inner (concave) corners are generated together as one
  4×4 sheet, so palette, texture scale, and lighting are **locked** across the
  set instead of drifting across 13 separate calls.
- **Template-guided image-to-image.** Rather than ask the model to invent an
  atlas from text, it restyles a structural reference — a rounded rectangle
  with a rectangular hole on flat magenta. Each of the 13 roles lives at a known
  cell, so the client slices them out deterministically after restyle.
- **Auto-alignment + chroma key.** The restyled output is re-fitted to the
  template silhouette (fixing the "AI painted it smaller, centered" failure),
  magenta is keyed to alpha with a tile-tuned chroma key, and edge tiles are
  made tileable along their loop axis.
- **Deterministic corner reconciliation.** Corners are the hardest tiles, so
  the app stitches them rather than trusting raw AI cells: outer corners keep
  their painted cap and get a feathered **edge graft** so the grain matches
  their straight neighbors in both directions; inner corners preserve the AI
  art and graft only the seams that touch straight edges. The result is
  seamless corners run-to-run.
- **AI "Art Director" QA/repaint loop.** After generation the set is composited
  into a platform-preview mockup and handed to a *vision* critic that judges it
  like a senior tileset artist — checking the chroma key actually keyed out
  (no opaque background blocks), edge-cap consistency, palette/lighting
  cohesion, body seamlessness, fringe, and blur. If it fails it returns a
  concise fix report that drives a repaint; if it passes it ships. The critic
  is deliberately scoped to **painter-fixable** defects (it does not nitpick the
  app-composited corner geometry).
- **Keep-best selection.** Every pass is scored and the loop commits the *best*
  candidate it saw, never just the last one — so a flaky critic + full repaint
  can only ever improve on, never regress, a clean first generation.
- **Tileable body, no visible grid.** The repeating body fill gets a stronger
  2D-seamless pass (full tonal equalization + wide seam blends), and the prompt
  forbids cell-sized panels / long streaks / hero features, so the interior
  reads as one continuous surface when repeated.
- **Live "how tiles fit together" preview** and per-tile re-roll. Regenerate a
  single tile without touching the rest; the set re-reconciles its corners
  afterward.
- **Engine-ready atlas export.** Export the padded atlas (with a 2px duplicated
  **extrude** border around every tile to stop filtering/sub-pixel bleed in
  Unity / Godot / Phaser / Tiled) plus per-tile PNGs and a manifest.
- **14 material presets** — lush meadow, mossy stone, red brick, snowy peak,
  oak planks, desert sandstone, volcanic rock, glow cave, crystal ice, jungle
  floor, autumn earth, marble & gold, obsidian, coral reef — each a rich
  palette/surface description you can edit.

### Sprite Studio (character animations)

- **Two-pass anchor → sheet workflow.** Naive single-call multi-panel
  generation flickers — the character drifts between cells, frames come out at
  different scales, palettes shift. We adopt the consensus approach from the AI
  sprite community:
  - **Pass 1 — Lock character.** Generates a single neutral standing reference
    image of the character on a flat magenta key.
  - **Pass 2 — Paint sheet.** Generates the keyframe sheet with the anchor
    attached as a reference: *"the attached image is the canonical character —
    every cell must match it exactly."* This is the single biggest lever for
    cross-frame identity preservation.
  - The anchor **persists across animation switches**, so the same character can
    be re-used for idle → walk → run → jump → attack without re-rolling
    identity. A `Re-roll character` button discards the anchor for a fresh one.
- **Five body plans.** A humanoid skeleton can't drive a galloping wolf, a
  slithering eel, a flapping bird, or a bouncing slime — so Sprite mode branches
  on anatomy. Pick a **body plan** and the studio swaps in the matching pose rig,
  animation set, starter creatures, and QA expectations, while reusing the same
  anchor → sheet → align → export pipeline:
  - **Humanoid** (biped) — knights, mages, goblins, bosses.
  - **Quadruped** — wolves, big cats, horses, hounds, plus everyday animals
    (dog, cat, cow, deer, bear, fox, pig, goat).
  - **Serpent / Fish** — snakes, eels, and marine life (shark, clownfish,
    pufferfish, anglerfish, swordfish, dolphin, sea serpent, piranha).
  - **Flyer / Bird** — birds, bats, wyverns, fairies, phoenix.
  - **Blob** — slimes, oozes, elementals, ghosts (pure squash & stretch).
- **Anatomy-specific pose-guide rigs.** Each body plan ships a deterministic,
  code-generated pose-guide sheet (a "ControlNet-style" mannequin) drawn fresh
  for the chosen action and fed in as structural reference. Rigs use near/far
  value separation + dark outlines so overlapping limbs stay readable, and they
  render real anatomy — a quadruped spine + 4 legs with a head-bob gait, a
  serpent spine wave with an open-jaw strike, filled bird **wing membranes**
  with a proper flap/dive, and blob squash-&-stretch arcs.
- **Deterministic twin detector.** A pixel-analysis pass scans each cell's alpha
  for two creatures in one frame (a common multi-panel failure), including a
  morphological-opening step that splits *fused* duplicates, and forces a
  repaint when it finds them. Sprite generation leans on these deterministic
  checks rather than a vision critic, so it isn't blocked waiting on a QA model.
- **Scale normalization.** The model redraws the creature at a slightly
  different size in every cell, so the silhouette "breathes" during playback.
  A pass measures each frame's tight silhouette (bbox diagonal), takes the
  median as the intended scale, and rescales each frame toward it — within a
  tolerance + clamp so genuine pose extension (a run reach, an attack lunge)
  keeps its shape.
- **Baseline & horizontal alignment.** Frames are foot-baseline aligned to one
  shared in-cell floor and horizontally centered so playback doesn't bounce or
  slide. Grounded gaits (idle / walk / **run**) plant *every* frame on the floor
  line; only truly ballistic actions (jump, pounce) keep their airborne lift via
  a rigid shift, so a galloping run can't split into a high row and a low row.
- **Per-body-plan animation sets.** Humanoid: idle / walk / run / jump / attack /
  hurt / death. Quadruped: idle / walk / run / jump / pounce / hurt / death /
  sleep. Serpent: idle / slither / strike / coil / hurt / death. Flyer: idle /
  flap / glide / dive / hurt / death. Blob: idle / hop / bounce / lunge / hurt /
  death — each with tuned choreography and a sensible default FPS.
- **Live animation player.** Looping / one-shot playback at the anim's native
  FPS with play/pause and a frame scrubber; the FPS slider tunes the feel before
  exporting.
- **Creature preset chips.** One-click archetypes per body plan seed the prompt
  (humanoid knight/ninja/wizard…, quadruped wolf/bear/cat…, marine shark/koi…,
  flyer hawk/wyvern…, blob slime/ooze…).
- **Engine-ready export.** Download the grid sheet, a horizontal strip
  (preferred by Phaser / Unity 2D / Godot / Defold), or a ZIP with both sheets,
  one PNG per frame, and a `manifest.json` listing FPS, loop flag, frame size,
  and per-frame grid + strip coordinates.

### Props Studio (scatter decoration)

- **Open-ended, growing library.** Instead of a fixed sheet of dictated items,
  the model freely invents decoration props for your biome. Each "add more"
  press paints another batch of **8** props in one AI call and **appends** them
  — the library grows without bound and never re-rolls what already exists.
- **Two-call "art director → painter" pipeline.** Call #1 is a *text/reasoning*
  model acting as art director: given the biome and the categories already in
  the library, it invents the next batch of brand-new, distinct prop ideas
  (deliberately reaching across plants, minerals, bones, debris, totems,
  containers, creature traces, light sources, etc.). Call #2 is the image model,
  which paints exactly what the director decided. Splitting *ideation* from
  *rendering* is what stops the "same lanterns/pots/nests loop."
- **Cheap text de-duplication.** Each prop reports a one-word category that's
  tallied and fed back as a text budget hint, so new batches avoid look-alikes
  without ever shipping the whole library back as images.
- **Style-locked across batches.** A small montage of existing props is attached
  as a visual style anchor so palette / lighting / rendering stay consistent as
  the library grows.
- **Curate freely.** Re-roll or delete any single prop; everything is generated
  on transparency.
- **8 biome presets** — forest glade, glowing cave, desert oasis, snowy peaks,
  volcanic, jungle ruins, misty swamp, candy land — these set palette/mood only,
  never specific items, so the model stays free to invent.
- **Descriptive names in the manifest.** Because the art director already named
  each prop (the kind it decided to paint), the export uses that instead of
  anonymous `prop_001`: the manifest carries a human `name` per prop and the
  files are named after it (`lantern.png`, `mushroom.png`, with `_02`/`_03`
  suffixes on repeats), so the atlas is self-documenting in your engine.
- **Atlas + ZIP export.** Export the whole library as a packed transparent atlas
  PNG with a JSON manifest, or a ZIP of individual transparent PNGs + atlas +
  manifest.

## The AI "Art Director" QA pattern

Tiles and Props share a two-call reasoning-vs-rendering pattern that
consistently beats a single blind generation:

- **Props** run it *forward*: a reasoning model decides **what** to make, then
  the image model renders it.
- **Tiles** run it *in reverse*: the image model generates first, then a vision
  model reviews the composited result and, if needed, sends a concise fix report
  back for a repaint — with keep-best selection so the loop can only improve the
  output. (The review is auto-skipped on slow models like GPT image to avoid
  multi-minute blind waits.)
- **Sprites** lean on **deterministic** post-process checks instead of a vision
  critic — scale normalization, baseline grounding, horizontal centering, and a
  pixel-level twin/spillover detector that forces a repaint on duplicates. This
  keeps sprite generation fast and predictable rather than blocked on a QA model.

Critics are scoped to defects the painter can actually fix, run at low
temperature for consistency, and fail-open (a flaky critic never blocks you).

## How extension works

```
┌─────────────┐   1. expand canvas with        ┌───────────────────┐
│  original   │ ──  light-gray blank area ──▶  │  expanded canvas  │
└─────────────┘     in chosen direction        └─────────┬─────────┘
                                                         │
                                                         ▼
                                              ┌─────────────────────┐
                                              │  Gemini outpaints   │
                                              │  the blank region   │
                                              └─────────┬───────────┘
                                                        │
                                                        ▼
                                              ┌─────────────────────┐
                                              │  pre-correct color  │
                                              │  drift at seam      │
                                              └─────────┬───────────┘
                                                        │
                                                        ▼
                                              ┌─────────────────────┐
                                              │  Poisson blend with │
                                              │  grown mask         │
                                              └─────────┬───────────┘
                                                        │
                                                        ▼
                                              ┌─────────────────────┐
                                              │  measure seam       │
                                              │  residual, repeat   │
                                              │  ×3, sort, present  │
                                              └─────────────────────┘
```

For horizontal extensions we run the pipeline up to 3 times in parallel
attempts (each at a different temperature), measure the seam residual of
each blended result, and present the candidates sorted best-blend first.
You're free to cycle and pick a different one if you prefer the AI's
content choices over the cleanest seam.

Vertical extensions use a different chunked path that's deterministic
enough that 1 attempt usually suffices.

## Quick start

```bash
git clone https://github.com/boona13/image-extender.git
cd image-extender
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On first load the app
will prompt for a default provider API key — paste it once, it's stored locally,
you'll never see the prompt again unless you clear it from Settings.

The default OpenRouter path still works with keys from
[openrouter.ai/keys](https://openrouter.ai/keys); custom providers can be
configured in Settings or through environment variables.

### Optional: server-side env fallback

If you'd rather not enter the key in the browser (or you're hosting a demo
where you want to provide the key for visitors), copy `.env.example` to
`.env.local` and fill in your key:

```bash
cp .env.example .env.local
# edit .env.local and add OPENROUTER_API_KEY or per-provider keys
```

When set, the server will use this key for any request that doesn't
include a client-provided one.

### Custom providers

Settings exposes three independent provider slots:

- **Image provider** — used by Extender, Parallax, Tiles, Sprites, and Props
  rendering calls.
- **Text provider** — used by scene briefs and prop ideation.
- **Vision provider** — used by tile and sprite QA review passes.

Each slot can use a different protocol, base URL, key, and model. The default
protocol is `openrouter-chat-completions`, which keeps the original Nano Banana
/ Gemini behavior. `openai-responses` is available for providers that return
images through Responses-style `image_generation_call` output, while
`openai-chat-completions` covers OpenAI-compatible text and vision gateways.
`openai-images` is available for pure text-to-image generation.

Server-side environment variables can also be configured per ability:

```bash
IMAGE_PROVIDER_PROTOCOL=openai-responses
IMAGE_PROVIDER_BASE_URL=https://api.openai.com/v1
IMAGE_PROVIDER_API_KEY=...
IMAGE_PROVIDER_MODEL=gpt-image-2

TEXT_PROVIDER_PROTOCOL=openai-chat-completions
TEXT_PROVIDER_BASE_URL=https://openrouter.ai/api/v1
TEXT_PROVIDER_API_KEY=...
TEXT_PROVIDER_MODEL=google/gemini-2.0-flash-001

VISION_PROVIDER_PROTOCOL=openai-chat-completions
VISION_PROVIDER_BASE_URL=https://openrouter.ai/api/v1
VISION_PROVIDER_API_KEY=...
VISION_PROVIDER_MODEL=google/gemini-2.0-flash-001
```

## Usage

| Action | How |
| --- | --- |
| **Switch mode** | Click `Extender` / `Parallax` / `Tiles` / `Sprite` / `Props` pill in the top bar |
| **Upload image** | Drag & drop, click the dropzone, or generate one from text |
| **Extend** | Click one of the four edge handles, or press `↑` `↓` `←` `→` (parallax mode: `←` `→` only) |
| **Cycle variants** | `←` `→` arrow keys (or chevrons in the pill below the image) |
| **Accept / Regenerate / Discard / Download** | `Enter` / `R` / `Esc` / `Download` button |
| **Pick a parallax layer** | Click a card in the left panel (Sky / Far / Mid / Near) |
| **Adjust per-layer scroll speed** | Drag the slider on each layer card — preview updates live |
| **Auto-extend (parallax)** | Set a target width, click `Auto-extend`, click `Stop` to interrupt |
| **Make tileable / Harmonize (parallax)** | `Tileable` heals the loop seam (auto-runs after auto-extend); `Harmonize` flattens cumulative drift |
| **Export project (parallax)** | Click `ZIP` → all layers + `parallax.json` manifest |
| **Generate a tile set** | Describe the material, click generate — one AI call, auto corner-reconcile + QA review |
| **Re-roll one tile** | Click the spark on a single tile cell (re-reconciles corners after) |
| **Export tile set** | Atlas (with extrude padding) + per-tile PNGs + manifest |
| **Pick a sprite body plan** | Choose `Humanoid` / `Quadruped` / `Serpent / Fish` / `Flyer / Bird` / `Blob` — swaps the rig, anim set, and presets |
| **Pick a sprite animation** | Click an animation chip (the set depends on the body plan) |
| **Lock a sprite character** | Pick a starter chip (or describe one), click `Lock character + <anim>` — runs both passes |
| **Re-roll a sprite anim / character** | `Re-roll <anim>` runs Pass 2 only (identity preserved); `Re-roll character` runs both from scratch |
| **Play / pause sprite, adjust FPS** | Play button + scrubber under the live player; drag the `FPS` slider |
| **Export sprite project** | `Sheets + manifest` for grid + strip PNGs, or `ZIP` for everything |
| **Generate props** | Pick a biome preset (or describe one), click add — paints 8 new distinct props and appends them |
| **Add more props** | Press add again — another batch of 8, deduped against the existing library |
| **Curate props** | Hover a prop to re-roll or delete it |
| **Export props** | `Atlas + manifest` for the packed transparent atlas, or `ZIP` for individual PNGs + atlas + manifest |

Optional custom prompt and art style live in the bottom command bar.

## Tech stack

- **[Next.js 14](https://nextjs.org/)** (App Router) + React 18 + TypeScript
- **[Tailwind CSS](https://tailwindcss.com/)** for the dark studio theme
- **HTML Canvas** for all client-side image manipulation
  ([app/utils/imageProcessor.ts](app/utils/imageProcessor.ts))
- **[JSZip](https://stuk.github.io/jszip/)** for in-browser project bundling
- **Provider adapters** for model access. OpenRouter remains the default.
  - Image: `google/gemini-3.1-flash-image-preview` (Nano Banana 2, default),
    `google/gemini-3-pro-image-preview` (Nano Banana Pro),
    `google/gemini-2.5-flash-image` (Nano Banana), and
    `openai/gpt-5.4-image-2` (GPT-5.4 Image 2 — high fidelity, slower)
  - Reasoning / vision QA (scene brief, prop art director, tile review):
    `google/gemini-2.0-flash-001`

## Project structure

```
app/
├── api/
│   ├── extend/route.ts        Outpainting endpoint (provider-backed)
│   ├── generate/route.ts      Text-to-image + tile-sheet + sprite-sheet prompts
│   ├── scene-brief/route.ts   Distill a shared scene brief for a project
│   ├── prop-brief/route.ts    Props "art director" — invents the next prop batch
│   ├── tile-review/route.ts   Tile QA "art director" (vision critic)
│   └── sprite-review/route.ts Sprite QA "art director" (vision critic)
├── components/                UI split by workspace
│   ├── TopBar / CommandBar / Workspace / VariantSelector / Modals / icons
│   ├── ParallaxStudio.tsx
│   ├── TileStudio.tsx         + PlatformPreview compositor
│   ├── SpriteStudio.tsx
│   └── PropStudio.tsx
├── lib/                       Domain logic & constants
│   ├── app.ts / models.ts / artStyles.ts
│   ├── providers/             Provider config + OpenRouter/OpenAI-compatible adapters
│   ├── parallax.ts / tileset.ts / sprite.ts / props.ts
│   └── bodyPlans.ts           Sprite body-plan registry (anims, presets, rigs)
├── utils/
│   ├── imageProcessor.ts      Canvas: chunking, Poisson blend, chroma key,
│   │                          tileability, seam scoring, sprite align/scale
│   ├── poseRig.ts             Dispatches to the body-plan rig + measures subject
│   ├── rigCore.ts             Shared rig primitives (capsule/dot/projection…)
│   └── rigs/                  Per-body-plan pose rigs (biped, quadruped,
│                              serpent, flyer, blob)
├── globals.css                Dark "studio" design system
├── layout.tsx                 Root layout, Inter font
└── page.tsx                   App shell: state, generation pipelines, QA loops
```

## Configuration knobs

A few small values you might want to tune:

| Constant | Where | Default | Meaning |
| --- | --- | --- | --- |
| `EXTENSION_PERCENT` | `app/lib/app.ts` | `38` | How much of the current dimension each extension adds |
| `maxAttempts` | per model in `app/lib/models.ts` | `1`–`3` | Best-of-N candidates per horizontal extension |
| `MAX_TILE_REVIEW_PASSES` | `app/page.tsx` | `2` | Extra tile repaint passes the QA art director may trigger |
| `TILESET_TILE_SIZE` | `app/lib/tileset.ts` | `512` | Per-tile resolution in the 4×4 sheet |
| `TILESET_ATLAS_EXTRUDE_PX` | `app/lib/tileset.ts` | `2` | Duplicated border around each exported atlas tile |
| `PROP_BATCH` | `app/lib/props.ts` | `8` | Props painted per "add more" press |
| `GROW_PX` | `app/utils/imageProcessor.ts` | `8` | Pixels to grow the Poisson mask into the original |
| `iterations` | `app/utils/imageProcessor.ts` | `250` | Max Gauss-Seidel iterations |

## Privacy & security

- Provider API keys entered in the UI are stored **only** in your browser's
  `localStorage`. They are never written to the server's disk and never logged.
  The server uses them once per request to proxy the call to the configured
  provider, then discards them.
- The server-side `OPENROUTER_API_KEY` env var is **optional** and acts only
  as a fallback for requests that don't include a client-provided key. Per-slot
  provider env vars can override it.
- No analytics, no telemetry, no tracking.

## Acknowledgments

- Poisson image editing technique: **Pérez, Gangnet, and Blake (2003) —
  "Poisson Image Editing"**, SIGGRAPH.
- Google for the Gemini image models, OpenRouter for the unified API.

## License

[MIT](LICENSE)
