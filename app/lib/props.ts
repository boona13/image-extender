'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Props / decoration — an OPEN-ENDED library of standalone transparent
// decoration sprites. Instead of a fixed 12-cell sheet with dictated items, the
// model freely invents a varied set of props for the chosen biome. The library
// GROWS: each "add more" press paints another batch of PROP_BATCH props in one
// AI call and appends them, never touching what already exists. To keep the
// growing library coherent, each batch is given the existing props as a style
// reference so palette / lighting / rendering stay locked across batches.
// ─────────────────────────────────────────────────────────────────────────────

export const PROP_TILE_SIZE = 512

// One "add more" press = one AI call laid out as a 4×2 grid of 8 props. 512px
// cells keep each prop detailed; 8-per-call is the sweet spot between detail and
// clicks. Press repeatedly to grow the library without bound.
export const PROP_BATCH = 8
export const PROP_BATCH_COLS = 4
export const PROP_BATCH_ROWS = 2
export const PROP_BATCH_W = PROP_BATCH_COLS * PROP_TILE_SIZE // 2048
export const PROP_BATCH_H = PROP_BATCH_ROWS * PROP_TILE_SIZE // 1024

// When exporting the whole library as a single atlas, pack it this many columns
// wide (rows grow with the count).
export const PROP_ATLAS_COLS = 4

export interface PropPreset {
  id: string
  label: string
  prompt: string
}

// Biome / palette starters. These set ONLY the world's palette, lighting and
// mood — they intentionally do NOT name any decoration items, so the model is
// free to invent whatever props fit. Each keeps clear of the pink/red-magenta
// band that the chroma key removes.
export const PROP_PRESETS: PropPreset[] = [
  {
    id: 'forest',
    label: 'Forest glade',
    prompt:
      'Lush temperate woodland — sun-dappled greens, mossy emerald, warm oak-brown earth tones, soft golden daylight, rich natural earthy palette',
  },
  {
    id: 'cave',
    label: 'Glowing cave',
    prompt:
      'Damp underground cavern — cool slate-grey and charcoal, soft teal and cyan bioluminescent glow, muted earthy darks, low moody ambient light',
  },
  {
    id: 'desert',
    label: 'Desert oasis',
    prompt:
      'Sun-baked arid badlands — bleached sandstone, warm tan and ochre, muted sage and olive accents, dry dusty palette under bright flat sun',
  },
  {
    id: 'snow',
    label: 'Snowy peaks',
    prompt:
      'Frozen alpine world — snow whites, cool slate greys, pale ice-blue accents, crisp clean winter palette under soft overcast light',
  },
  {
    id: 'volcanic',
    label: 'Volcanic',
    prompt:
      'Scorched volcanic terrain — black basalt and charcoal, ash greys, smouldering ember-orange and amber glow accents, hot dark palette (no pinks)',
  },
  {
    id: 'jungle',
    label: 'Jungle ruins',
    prompt:
      'Overgrown tropical jungle — deep saturated greens, weathered mossy stone, warm amber and violet accents, humid lush palette in dappled shade',
  },
  {
    id: 'swamp',
    label: 'Misty swamp',
    prompt:
      'Murky wetland — muted olive and bog greens, slimy dark browns, pale sickly highlights, damp desaturated foggy palette',
  },
  {
    id: 'candy',
    label: 'Candy land',
    prompt:
      'Playful confectionery world — minty teals, soft creams and caramels, glossy purple and blue sugar tones, sweet bright pastel palette kept clear of pink and red',
  },
]

// A single generated decoration in the library. `imageUrl` is null only while a
// freshly-requested batch cell is still being painted (shows a spinner).
export interface PropItem {
  id: string
  imageUrl: string | null
  generating: boolean
  /** Coarse one-word CATEGORY the model reported for this decoration
   * (e.g. "lantern", "pottery", "nest"). Tallied across the library and fed
   * back as a cheap TEXT category-budget hint so new batches stop repeating
   * look-alikes — no need to ship the whole library back as images. */
  name?: string
}

let __propSeq = 0
/** Stable unique id for a prop item (used as React key + ZIP filename stem). */
export function nextPropId(): string {
  __propSeq += 1
  return `p${Date.now().toString(36)}_${__propSeq}`
}

/** Grid geometry for packing `count` props into an atlas `cols` wide. */
export function propAtlasLayout(count: number, cols: number = PROP_ATLAS_COLS) {
  const c = Math.max(1, cols)
  const rows = Math.max(1, Math.ceil(Math.max(0, count) / c))
  return {
    cols: c,
    rows,
    width: c * PROP_TILE_SIZE,
    height: rows * PROP_TILE_SIZE,
    rect(i: number) {
      return {
        x: (i % c) * PROP_TILE_SIZE,
        y: Math.floor(i / c) * PROP_TILE_SIZE,
        width: PROP_TILE_SIZE,
        height: PROP_TILE_SIZE,
      }
    },
  }
}
