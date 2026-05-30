'use client'

import { chromaKeyToAlpha } from '@/app/utils/imageProcessor'

export type TileSetRole =
  | 'body'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'tl_outer'
  | 'tr_outer'
  | 'bl_outer'
  | 'br_outer'
  | 'tl_inner'
  | 'tr_inner'
  | 'bl_inner'
  | 'br_inner'


export interface TileSetSlotSpec {
  role: TileSetRole
  /** Display label in the UI grid. */
  label: string
  /** One-line tooltip describing where this tile sits in a platform. */
  hint: string
  /** Sprite-sheet column (0-indexed). */
  col: number
  /** Sprite-sheet row (0-indexed). */
  row: number
  /**
   * Filename used in the ZIP export and as the manifest key. Lower-case,
   * hyphen-separated, descriptive — no spaces.
   */
  fileName: string
}

// Tile size is intentionally 512 (not 1024) so the full 4×4 sprite-sheet
// fits in a single 2048² AI call. This is the consistency win: all 13
// tiles come out of the same diffusion pass with locked palette / texture
// detail, instead of drifting across 13 separate calls. 512 px per tile
// is more than enough source material for any 2D platformer (most engines
// scale tiles down to 32–128 px in the final game).

export const TILESET_TILE_SIZE = 512

export const TILESET_COLS = 4

export const TILESET_ROWS = 4

export const TILESET_SHEET_W = TILESET_COLS * TILESET_TILE_SIZE

export const TILESET_SHEET_H = TILESET_ROWS * TILESET_TILE_SIZE
// Production atlas export includes a duplicated border around every tile.
// This prevents linear filtering / sub-pixel camera movement from sampling
// neighboring transparent atlas pixels in Unity, Godot, Phaser, and Tiled.

export const TILESET_ATLAS_EXTRUDE_PX = 2

export const TILESET_PADDED_STRIDE = TILESET_TILE_SIZE + TILESET_ATLAS_EXTRUDE_PX * 2

export const TILESET_PADDED_SHEET_W = TILESET_COLS * TILESET_PADDED_STRIDE

export const TILESET_PADDED_SHEET_H = TILESET_ROWS * TILESET_PADDED_STRIDE

export const TILESET_SLOTS: TileSetSlotSpec[] = [
  { role: 'tl_outer', label: 'TL', hint: 'Top-left outer corner — top + left exposed', col: 0, row: 0, fileName: 'corner-tl-outer' },
  { role: 'top',      label: 'Top', hint: 'Top edge — surface where the player lands', col: 1, row: 0, fileName: 'edge-top' },
  { role: 'tr_outer', label: 'TR', hint: 'Top-right outer corner — top + right exposed', col: 2, row: 0, fileName: 'corner-tr-outer' },
  { role: 'tl_inner', label: 'TLᵢ', hint: 'Top-left inner corner — concave, for L-shapes', col: 3, row: 0, fileName: 'corner-tl-inner' },
  { role: 'left',     label: 'Left', hint: 'Left edge — vertical side of a platform', col: 0, row: 1, fileName: 'edge-left' },
  { role: 'body',     label: 'Body', hint: 'Interior fill — repeats inside the platform', col: 1, row: 1, fileName: 'body' },
  { role: 'right',    label: 'Right', hint: 'Right edge — vertical side of a platform', col: 2, row: 1, fileName: 'edge-right' },
  { role: 'tr_inner', label: 'TRᵢ', hint: 'Top-right inner corner — concave, for L-shapes', col: 3, row: 1, fileName: 'corner-tr-inner' },
  { role: 'bl_outer', label: 'BL', hint: 'Bottom-left outer corner — bottom + left exposed', col: 0, row: 2, fileName: 'corner-bl-outer' },
  { role: 'bottom',   label: 'Bot', hint: 'Bottom edge — underside of a floating platform', col: 1, row: 2, fileName: 'edge-bottom' },
  { role: 'br_outer', label: 'BR', hint: 'Bottom-right outer corner — bottom + right exposed', col: 2, row: 2, fileName: 'corner-br-outer' },
  { role: 'bl_inner', label: 'BLᵢ', hint: 'Bottom-left inner corner — concave, for L-shapes', col: 3, row: 2, fileName: 'corner-bl-inner' },
  { role: 'br_inner', label: 'BRᵢ', hint: 'Bottom-right inner corner — concave, for L-shapes', col: 3, row: 3, fileName: 'corner-br-inner' },
]


export const TILESET_BY_ROLE: Record<TileSetRole, TileSetSlotSpec> = TILESET_SLOTS.reduce(
  (acc, slot) => {
    acc[slot.role] = slot
    return acc
  },
  {} as Record<TileSetRole, TileSetSlotSpec>
)

/**
 * Tile-map TEMPLATE — sent to the model as a structural reference for an
 * image-to-image style-transfer pass. Instead of asking the AI to invent a
 * 4×4 autotile atlas from a text spec (which it does inconsistently), we
 * hand it a real platform silhouette: a rectangle with a rectangular hole.
 * Every one of the 13 tile roles sits at a known cell coordinate in this
 * map, so after the AI restyles the gray material with the user's prompt
 * we can slice each role out deterministically.
 *
 *   '#' = paint material here  (gray in the guide image)
 *   '.' = pure magenta #FF00FF (alpha-keyed empty space)
 *
 * Cell size matches TILESET_TILE_SIZE so the slicer extracts native-detail
 * cells with no resampling. 8×8 cells at 256 px = 2048×2048 — Gemini's
 * sweet spot for 1:1 image generation.
 */

export const TILE_TEMPLATE_MASK: readonly string[] = [
  '########',
  '########',
  '########',
  '##....##',
  '##....##',
  '########',
  '########',
  '########',
]

export const TILE_TEMPLATE_COLS = TILE_TEMPLATE_MASK[0]?.length ?? 0

export const TILE_TEMPLATE_ROWS = TILE_TEMPLATE_MASK.length

export const TILE_TEMPLATE_CELL = TILESET_TILE_SIZE

export const TILE_TEMPLATE_W = TILE_TEMPLATE_COLS * TILE_TEMPLATE_CELL

export const TILE_TEMPLATE_H = TILE_TEMPLATE_ROWS * TILE_TEMPLATE_CELL

/**
 * Where to pull each of the 13 unique tile roles out of the restyled map.
 * These are hand-picked from the rectangle-with-hole layout above:
 *  - outer corners → the 4 corners of the platform's outer rectangle.
 *  - inner corners → the 4 corners of the hole (from the platform's side).
 *  - 4 edges → the middles of the outer rectangle's sides.
 *  - body → an interior cell fully surrounded by material.
 */

export const TILE_TEMPLATE_SAMPLES: Record<TileSetRole, { col: number; row: number }> = {
  tl_outer: { col: 0, row: 0 },
  top:      { col: 4, row: 0 },
  tr_outer: { col: 7, row: 0 },
  tl_inner: { col: 6, row: 5 },
  left:     { col: 0, row: 4 },
  // Body sits in row 6 (between the hole and the bottom edge) rather than
  // row 1 (between the top edge and the hole). Picking from the bottom
  // half avoids the AI's tendency to bleed a top "cap" (grass / snow /
  // moss) down into the interior — the bleed at the bottom is always
  // core-material details (roots, hanging chips) which composites cleanly
  // into a 2D-tileable body.
  body:     { col: 4, row: 6 },
  right:    { col: 7, row: 4 },
  tr_inner: { col: 1, row: 5 },
  bl_outer: { col: 0, row: 7 },
  bottom:   { col: 4, row: 7 },
  br_outer: { col: 7, row: 7 },
  bl_inner: { col: 6, row: 2 },
  br_inner: { col: 1, row: 2 },
}

/**
 * Resolves a cell's autotile role from the platform-map mask, matching the
 * runtime `roleForCell` autotiler used by PlatformPreview. Returns null
 * for empty cells. Diagonal-only checks fall through after cardinals so
 * the priority is: outer corner → straight edge → inner corner → body.
 */

export function templateRoleForCell(x: number, y: number): TileSetRole | null {
  const isSolid = (cx: number, cy: number): boolean =>
    cy >= 0 &&
    cy < TILE_TEMPLATE_ROWS &&
    cx >= 0 &&
    cx < TILE_TEMPLATE_COLS &&
    TILE_TEMPLATE_MASK[cy][cx] === '#'

  if (!isSolid(x, y)) return null

  const top = !isSolid(x, y - 1)
  const bottom = !isSolid(x, y + 1)
  const left = !isSolid(x - 1, y)
  const right = !isSolid(x + 1, y)

  if (top && left) return 'tl_outer'
  if (top && right) return 'tr_outer'
  if (bottom && left) return 'bl_outer'
  if (bottom && right) return 'br_outer'
  if (top) return 'top'
  if (bottom) return 'bottom'
  if (left) return 'left'
  if (right) return 'right'

  if (!isSolid(x - 1, y - 1)) return 'tl_inner'
  if (!isSolid(x + 1, y - 1)) return 'tr_inner'
  if (!isSolid(x - 1, y + 1)) return 'bl_inner'
  if (!isSolid(x + 1, y + 1)) return 'br_inner'

  return 'body'
}

/**
 * Renders the structural reference image for the AI. Every cell is drawn
 * with the canonical 25%-inset material pattern for its autotile role
 * (e.g. a 'top' cell has magenta in its top 25% strip, a 'tl_outer' cell
 * has magenta in an L wrapping the top-left). When all these per-cell
 * patterns are placed in the platform-map layout, they compose into a
 * single rounded-corner rectangle with a rounded-corner hole — one
 * continuous silhouette on flat magenta.
 *
 * Two consequences of this:
 *  1. The model sees real neighbor context (a top-edge cell next to an
 *     outer-corner cell), so palette / texture / lighting consistency
 *     across cells comes for free.
 *  2. After slicing, each cell already has the exact 25%/75% layout that
 *     `enforceTileRoleMask` expects — no post-hoc geometry fix needed.
 */

export function buildTileSheetGuideDataUrl(): string {
  const canvas = document.createElement('canvas')
  canvas.width = TILE_TEMPLATE_W
  canvas.height = TILE_TEMPLATE_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const key = '#ff00ff'
  const material = '#808080'
  const sz = TILE_TEMPLATE_CELL
  const q = sz / 4

  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = key
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = material
  for (let y = 0; y < TILE_TEMPLATE_ROWS; y++) {
    for (let x = 0; x < TILE_TEMPLATE_COLS; x++) {
      const role = templateRoleForCell(x, y)
      if (!role) continue
      const ox = x * sz
      const oy = y * sz
      switch (role) {
        case 'body':
          ctx.fillRect(ox, oy, sz, sz)
          break
        case 'top':
          ctx.fillRect(ox, oy + q, sz, sz - q)
          break
        case 'bottom':
          ctx.fillRect(ox, oy, sz, sz - q)
          break
        case 'left':
          ctx.fillRect(ox + q, oy, sz - q, sz)
          break
        case 'right':
          ctx.fillRect(ox, oy, sz - q, sz)
          break
        case 'tl_outer':
          ctx.fillRect(ox + q, oy + q, sz - q, sz - q)
          break
        case 'tr_outer':
          ctx.fillRect(ox, oy + q, sz - q, sz - q)
          break
        case 'bl_outer':
          ctx.fillRect(ox + q, oy, sz - q, sz - q)
          break
        case 'br_outer':
          ctx.fillRect(ox, oy, sz - q, sz - q)
          break
        case 'tl_inner':
          ctx.fillRect(ox + q, oy, sz - q, q)
          ctx.fillRect(ox, oy + q, sz, sz - q)
          break
        case 'tr_inner':
          ctx.fillRect(ox, oy, sz - q, q)
          ctx.fillRect(ox, oy + q, sz, sz - q)
          break
        case 'bl_inner':
          ctx.fillRect(ox, oy, sz, sz - q)
          ctx.fillRect(ox + q, oy + sz - q, sz - q, q)
          break
        case 'br_inner':
          ctx.fillRect(ox, oy, sz, sz - q)
          ctx.fillRect(ox, oy + sz - q, sz - q, q)
          break
      }
    }
  }

  return canvas.toDataURL('image/png')
}

/**
 * Re-aligns Gemini's restyled output to the template silhouette before we
 * slice. In practice the model often paints the platform CENTERED but
 * SMALLER than the canvas, surrounded by extra magenta — when we slice at
 * fixed coordinates the right/bottom cells fall in that empty margin and
 * the role mask wipes them, leaving us with missing tiles.
 *
 * The fix: detect the bounding box of non-magenta, non-transparent content
 * in the AI output, then scale/translate it back into the position our
 * template expects (a 25%-cell magenta margin on each side). Magenta
 * elsewhere is filled flat so chroma-keying still works. If the model
 * already nailed it within a 3% tolerance, we skip the resample to avoid
 * unnecessary blur.
 */

export async function alignAiOutputToTemplate(rawUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const W = TILE_TEMPLATE_W
      const H = TILE_TEMPLATE_H
      const src = document.createElement('canvas')
      src.width = W
      src.height = H
      const sctx = src.getContext('2d')
      if (!sctx) {
        reject(new Error('Failed to get bbox source canvas'))
        return
      }
      sctx.imageSmoothingEnabled = true
      sctx.imageSmoothingQuality = 'high'
      sctx.drawImage(img, 0, 0, W, H)
      const buf = sctx.getImageData(0, 0, W, H).data

      // Scan for the bounding box of "content": pixels that are neither
      // alpha-transparent (some Gemini variants emit real alpha) nor close
      // to pure magenta (the alpha-key sentinel). Loosely matches the same
      // notion of "this pixel is real material" that chromaKeyToAlpha uses.
      let minX = W
      let minY = H
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4
          const a = buf[i + 3]
          if (a < 16) continue
          const r = buf[i]
          const g = buf[i + 1]
          const b = buf[i + 2]
          if (r > 200 && g < 80 && b > 200) continue
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }

      if (maxX < 0 || maxY < 0) {
        // No content detected at all — pass through, downstream code will
        // raise the empty-tile failure path.
        resolve(src.toDataURL('image/png'))
        return
      }

      const actW = maxX - minX + 1
      const actH = maxY - minY + 1

      // The template draws every outer-edge / outer-corner cell with a 25%
      // magenta strip on its outside, so the platform's outer bbox lives
      // INSIDE the canvas by exactly one quarter-cell on each side.
      const inset = TILE_TEMPLATE_CELL / 4
      const expMinX = inset
      const expMinY = inset
      const expMaxX = W - inset - 1
      const expMaxY = H - inset - 1
      const expW = expMaxX - expMinX + 1
      const expH = expMaxY - expMinY + 1

      const tol = Math.round(W * 0.03)
      if (
        Math.abs(minX - expMinX) <= tol &&
        Math.abs(minY - expMinY) <= tol &&
        Math.abs(maxX - expMaxX) <= tol &&
        Math.abs(maxY - expMaxY) <= tol
      ) {
        resolve(src.toDataURL('image/png'))
        return
      }

      const dst = document.createElement('canvas')
      dst.width = W
      dst.height = H
      const dctx = dst.getContext('2d')
      if (!dctx) {
        reject(new Error('Failed to get bbox destination canvas'))
        return
      }
      dctx.fillStyle = '#ff00ff'
      dctx.fillRect(0, 0, W, H)
      dctx.imageSmoothingEnabled = true
      dctx.imageSmoothingQuality = 'high'
      dctx.drawImage(src, minX, minY, actW, actH, expMinX, expMinY, expW, expH)
      resolve(dst.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Failed to load AI output for alignment'))
    img.src = rawUrl
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Corner seam reconciliation
// ─────────────────────────────────────────────────────────────────────────────
// The 8 corner tiles are sliced from DIFFERENT cells of the AI sheet than the
// edge/body tiles they sit next to in a real platform. So when the autotiler
// butts a corner against its edge neighbors, the grain at the shared border
// doesn't line up — a faint but real seam, most visible at the rounded grass
// caps. Edges are made tileable, but corners get no border reconciliation.
//
// Fix: for each straight side of a corner that abuts an edge neighbor, graft a
// thin band of that neighbor's matching edge into the corner with a feathered
// cross-fade. The outermost seam line becomes identical to the neighbor's edge,
// fading back into the corner's own (AI) content within BAND px. Because every
// grafted neighbor is tileable along the shared axis, the corner's edge also
// matches the NEXT edge tile in the run — so the join is seamless in both
// directions. The corner's unique rounded cap (which faces the silhouette/hole,
// not a neighbor) is left untouched.

export type GraftSide = 'top' | 'bottom' | 'left' | 'right'

export interface CornerGraft {
  side: GraftSide
  neighbor: TileSetRole
}
// Per-corner: which side abuts which edge neighbor. Derived from the platform
// autotiler (PlatformPreview.roleForCell) on the rectangle-with-hole layout.
// Note every left/right graft pairs with a horizontally-tileable neighbor
// (top/bottom) and every top/bottom graft with a vertically-tileable neighbor
// (left/right), which is what makes the far-side join seamless too.

export const CORNER_GRAFTS: Partial<Record<TileSetRole, CornerGraft[]>> = {
  tl_outer: [{ side: 'right', neighbor: 'top' }, { side: 'bottom', neighbor: 'left' }],
  tr_outer: [{ side: 'left', neighbor: 'top' }, { side: 'bottom', neighbor: 'right' }],
  bl_outer: [{ side: 'right', neighbor: 'bottom' }, { side: 'top', neighbor: 'left' }],
  br_outer: [{ side: 'left', neighbor: 'bottom' }, { side: 'top', neighbor: 'right' }],
  tl_inner: [{ side: 'top', neighbor: 'left' }, { side: 'left', neighbor: 'top' }],
  tr_inner: [{ side: 'top', neighbor: 'right' }, { side: 'right', neighbor: 'top' }],
  bl_inner: [{ side: 'bottom', neighbor: 'left' }, { side: 'left', neighbor: 'bottom' }],
  br_inner: [{ side: 'bottom', neighbor: 'right' }, { side: 'right', neighbor: 'bottom' }],
}
// Width of the graft band as a fraction of the tile. Kept under 25% so the
// band never reaches the corner's rounded cap (which lives ~25% in).

export const CORNER_GRAFT_BAND_FRAC = 0.12
// Master switch for the corner seam pass. Flip to false to fall back to raw
// AI corners if a particular material ever reveals a graft artefact.

export const ENABLE_CORNER_RECONCILE = true

// Width (in px) of the anti-aliasing ramp applied across a role-mask cut. The
// cut lines sit on integer pixel boundaries, so a binary alpha (0/255) stair-
// steps the silhouette edge and aliases into a hairline once scaled (preview)
// or filtered (engine). Ramping alpha over ~1.5px centered on the cut gives a
// clean sub-pixel edge. This is a pure alpha feather — no material color bleed
// into the transparent side (atlas filter bleed is covered by the 2px extrude).

export const TILE_MASK_FEATHER_PX = 1.5

/**
 * Signed distance (px) from a pixel center to a role's material boundary.
 * Positive = inside material, negative = outside. The mask regions are
 * unions/intersections of axis-aligned half-planes, so this is analytic. Only
 * needs to be accurate within a couple px of the boundary (it gets clamped
 * beyond the feather band), so the corner approximations are sufficient.
 */

export function signedDistToMaterial(
  role: TileSetRole,
  px: number,
  py: number,
  w: number,
  h: number,
  qx: number,
  qy: number
): number {
  const cx = px + 0.5
  const cy = py + 0.5
  const dxL = cx - qx // material to the RIGHT of the left cut
  const dyT = cy - qy // material BELOW the top cut
  const dxR = w - qx - cx // material to the LEFT of the right cut
  const dyB = h - qy - cy // material ABOVE the bottom cut

  // Intersection of two half-planes (convex quadrant) → outer corners.
  const intersect = (a: number, b: number): number => {
    if (a >= 0 && b >= 0) return Math.min(a, b)
    if (a < 0 && b < 0) return -Math.hypot(a, b)
    return Math.min(a, b)
  }
  // Union of two half-planes (concave L) → inner corners.
  const union = (a: number, b: number): number => {
    if (a < 0 && b < 0) return Math.max(a, b)
    if (a >= 0 && b >= 0) return Math.hypot(a, b)
    return Math.max(a, b)
  }

  switch (role) {
    case 'body':
      return Math.max(w, h) // fully solid
    case 'top':
      return dyT
    case 'bottom':
      return dyB
    case 'left':
      return dxL
    case 'right':
      return dxR
    case 'tl_outer':
      return intersect(dxL, dyT)
    case 'tr_outer':
      return intersect(dxR, dyT)
    case 'bl_outer':
      return intersect(dxL, dyB)
    case 'br_outer':
      return intersect(dxR, dyB)
    case 'tl_inner':
      return union(dxL, dyT)
    case 'tr_inner':
      return union(dxR, dyT)
    case 'bl_inner':
      return union(dxL, dyB)
    case 'br_inner':
      return union(dxR, dyB)
  }
}

/** Multiply each pixel's alpha by its feathered material coverage for `role`. */

export function applyFeatheredRoleMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  role: TileSetRole,
  qx: number,
  qy: number,
  feather: number = TILE_MASK_FEATHER_PX
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sd = signedDistToMaterial(role, x, y, w, h, qx, qy)
      const coverage = 0.5 + sd / feather
      const idx = (y * w + x) * 4
      if (coverage <= 0) {
        data[idx + 3] = 0
        continue
      }
      if (coverage >= 1) continue // fully inside — keep original alpha
      data[idx + 3] = Math.round(data[idx + 3] * coverage)
    }
  }
}


export function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image for corner reconcile'))
    img.src = src
  })
}

/**
 * Rebuild ONE corner tile by grafting neighbor-edge bands along its straight
 * (neighbor-facing) sides. Returns a new data URL, or the original if any
 * neighbor is missing.
 */

export async function reconcileCornerTile(
  cornerUrl: string,
  grafts: CornerGraft[],
  neighborUrls: Partial<Record<TileSetRole, string>>
): Promise<string> {
  const cornerImg = await loadImageEl(cornerUrl)
  const w = cornerImg.width
  const h = cornerImg.height
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return cornerUrl
  ctx.drawImage(cornerImg, 0, 0)
  const out = ctx.getImageData(0, 0, w, h)
  const dst = out.data

  const band = Math.max(4, Math.round(w * CORNER_GRAFT_BAND_FRAC))

  for (const graft of grafts) {
    const nUrl = neighborUrls[graft.neighbor]
    if (!nUrl) continue
    let nImg: HTMLImageElement
    try {
      nImg = await loadImageEl(nUrl)
    } catch {
      continue
    }
    const nW = nImg.width
    const nH = nImg.height
    const tmp = document.createElement('canvas')
    tmp.width = nW
    tmp.height = nH
    const tctx = tmp.getContext('2d')
    if (!tctx) continue
    tctx.drawImage(nImg, 0, 0)
    const nData = tctx.getImageData(0, 0, nW, nH).data

    const sampleNeighbor = (nx: number, ny: number): number =>
      (Math.min(nH - 1, Math.max(0, ny)) * nW +
        Math.min(nW - 1, Math.max(0, nx))) *
      4

    // For each pixel in the band: t = distance from the seam line (0 at the
    // shared edge), weight ramps 1→0 across `band`. The neighbor is sampled so
    // its tileable edge aligns to the corner's shared edge (see header note).
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let t = -1
        let nx = 0
        let ny = 0
        if (graft.side === 'right') {
          t = w - 1 - x
          if (t >= band) continue
          nx = nW - 1 - t
          ny = y
        } else if (graft.side === 'left') {
          t = x
          if (t >= band) continue
          nx = t
          ny = y
        } else if (graft.side === 'top') {
          t = y
          if (t >= band) continue
          nx = x
          ny = t
        } else {
          // bottom
          t = h - 1 - y
          if (t >= band) continue
          nx = x
          ny = nH - 1 - t
        }

        const di = (y * w + x) * 4
        // Never paint into the corner's transparent silhouette/hole, and never
        // pull from the neighbor's transparent side — keeps the cut crisp.
        if (dst[di + 3] === 0) continue
        const si = sampleNeighbor(nx, ny)
        if (nData[si + 3] === 0) continue

        const wgt = 1 - t / band
        dst[di] = Math.round(dst[di] * (1 - wgt) + nData[si] * wgt)
        dst[di + 1] = Math.round(dst[di + 1] * (1 - wgt) + nData[si + 1] * wgt)
        dst[di + 2] = Math.round(dst[di + 2] * (1 - wgt) + nData[si + 2] * wgt)
        // Alpha: bias toward the more-opaque of the two near the seam so the
        // band stays solid material (avoids re-introducing a soft edge inside
        // the opaque region).
        dst[di + 3] = Math.max(
          dst[di + 3],
          Math.round(dst[di + 3] * (1 - wgt) + nData[si + 3] * wgt)
        )
      }
    }
  }

  ctx.putImageData(out, 0, 0)
  return canvas.toDataURL('image/png')
}

// ── Inner-corner assembly (deterministic) ────────────────────────────────────
// Band-grafting works great for OUTER corners (it preserves the AI's rounded
// grass cap that faces the silhouette). But INNER corners were inconsistent:
// their hole-edge surfaces live on the tile's INTERIOR cut boundary, which the
// border graft never touches — so they stayed raw AI art and varied run-to-run
// (a clean hole one generation, a stepped notch the next).
//
// Fix: stop trusting the AI inner-corner cell at all. An inner corner is just
// body with a small q×q bite, where the two edges of the bite are the hole's
// wall + ceiling/floor. We rebuild it deterministically:
//   • base = body (the solid interior pillar),
//   • the FULL-WIDTH half away from the bite = the horizontal edge neighbor
//     (top/bottom floor/ceiling) — so its grass cap sits at the same place and
//     height as the straight floor tiles beside it (continuous, no step),
//   • the FULL-HEIGHT column away from the bite = the vertical edge neighbor
//     (left/right wall), drawn LAST so it reclaims that column and its hole
//     edge lines up with the straight wall tiles above/below,
//   • then cut the q×q bite with the feathered role mask.
// Because the wall/floor come from the SAME tiles the neighbors use (and those
// are tileable), the hole edges and surfaces line up exactly, every time.

export interface InnerCornerSpec {
  /** Which q×q corner of the tile is the hole bite. */
  cut: 'tl' | 'tr' | 'bl' | 'br'
  /** Vertical edge neighbor (wall) that borders the bite horizontally. */
  vEdge: TileSetRole
  /** Horizontal edge neighbor (floor/ceiling) that borders the bite vertically. */
  hEdge: TileSetRole
}

export const INNER_CORNER_SPECS: Partial<Record<TileSetRole, InnerCornerSpec>> = {
  tl_inner: { cut: 'tl', vEdge: 'left', hEdge: 'top' },
  tr_inner: { cut: 'tr', vEdge: 'right', hEdge: 'top' },
  bl_inner: { cut: 'bl', vEdge: 'left', hEdge: 'bottom' },
  br_inner: { cut: 'br', vEdge: 'right', hEdge: 'bottom' },
}

/**
 * Rebuild ONE inner corner from body + its two hole-edge neighbors. Returns a
 * new data URL, or null if body / either edge neighbor is missing (caller
 * should then fall back to the raw corner).
 */

export async function assembleInnerCorner(
  role: TileSetRole,
  neighborUrls: Partial<Record<TileSetRole, string>>
): Promise<string | null> {
  const spec = INNER_CORNER_SPECS[role]
  if (!spec) return null
  const vUrl = neighborUrls[spec.vEdge]
  const hUrl = neighborUrls[spec.hEdge]
  // The wall + floor neighbors are the only ESSENTIAL inputs: between them
  // (full-height wall column + full-width floor half) they cover the entire
  // tile except the q×q bite, which we cut away anyway. The body tile is just
  // an optional base for the deep-interior quadrant — if it is missing OR fails
  // to load we must NOT abort (a single rejected load here used to throw the
  // whole assembly and silently fall back to the raw AI corner, which is what
  // left the misaligned dirt chunk at the bottom inner corners).
  if (!vUrl || !hUrl) return null

  const [vImg, hImg] = await Promise.all([loadImageEl(vUrl), loadImageEl(hUrl)])
  let bodyImg: HTMLImageElement | null = null
  const bodyUrl = neighborUrls['body']
  if (bodyUrl) {
    try {
      bodyImg = await loadImageEl(bodyUrl)
    } catch {
      bodyImg = null
    }
  }

  const w = (bodyImg?.width || vImg.width || hImg.width) || 512
  const h = (bodyImg?.height || vImg.height || hImg.height) || 512
  const qx = Math.round(w / 4)
  const qy = Math.round(h / 4)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const left = spec.cut === 'tl' || spec.cut === 'bl' // bite is on the LEFT x-half
  const top = spec.cut === 'tl' || spec.cut === 'tr' //  bite is on the TOP  y-half

  // ── 1. Plain-material BULK ────────────────────────────────────────────────
  // The corner is mostly solid interior material; the wall/floor edges only
  // exist along the L that faces the hole. So we fill the whole tile with plain
  // material FIRST and then paint just the two hole-facing strips. This is what
  // keeps the wall edge from bleeding its lit bevel down/up across the whole
  // tile (the previous full-column wall draw made the vertical edge run the
  // entire height and clash with the horizontal floor / ceiling).
  if (bodyImg) {
    ctx.drawImage(bodyImg, 0, 0, w, h)
  } else {
    // No body tile available — synthesize a tileable dirt fill from a band of
    // pure material in the floor / ceiling tile (sampled away from its grass
    // cap / lit bevel) so the bulk still reads as seamless interior material.
    const bandY = top ? Math.round(h * 0.6) : Math.round(h * 0.15)
    const band = document.createElement('canvas')
    band.width = w
    band.height = qy
    const bctx = band.getContext('2d')
    if (bctx) {
      bctx.drawImage(hImg, 0, bandY, w, qy, 0, 0, w, qy)
      const pattern = ctx.createPattern(band, 'repeat')
      if (pattern) {
        ctx.fillStyle = pattern
        ctx.fillRect(0, 0, w, h)
      } else {
        ctx.drawImage(hImg, 0, 0, w, h)
      }
    }
  }

  // ── 2. Floor / ceiling CAP along the hole's horizontal border ─────────────
  // Only the q-wide column directly under / over the hole, on the solid side.
  // Drawing the whole floor tile here lands its grass cap at the exact same
  // height as the straight floor tiles beside the corner, so the surface is
  // flush — and because the strip is limited to the hole's column it never
  // paints grass into the dry interior.
  const floorRegion = {
    x: left ? 0 : w - qx,
    y: top ? qy : 0,
    w: qx,
    h: h - qy,
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(floorRegion.x, floorRegion.y, floorRegion.w, floorRegion.h)
  ctx.clip()
  ctx.drawImage(hImg, 0, 0, w, h)
  ctx.restore()

  // ── 3. Wall BEVEL along the hole's vertical border ────────────────────────
  // Only the q-tall band beside the hole, on the solid side, so the wall's lit
  // edge appears exactly where it faces the hole and turns into the floor /
  // ceiling at the corner point instead of running the full tile height.
  const wallRegion = {
    x: left ? qx : 0,
    y: top ? 0 : h - qy,
    w: w - qx,
    h: qy,
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(wallRegion.x, wallRegion.y, wallRegion.w, wallRegion.h)
  ctx.clip()
  ctx.drawImage(vImg, 0, 0, w, h)
  ctx.restore()

  // ── 4. Cut the q×q bite (feathered) so the concave corner is transparent ──
  const out = ctx.getImageData(0, 0, w, h)
  applyFeatheredRoleMask(out.data, w, h, role, qx, qy)
  ctx.putImageData(out, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Rebuild a single corner by preserving the AI-painted corner artwork and only
 * grafting the neighbor-facing seams. We intentionally do NOT replace inner
 * corners with a fully synthetic L-shape here: that made organic materials
 * (grass, dirt, moss) turn into hard square steps around the hole. The model
 * already painted inner corners in full map context; the safest correction is
 * to keep that art and just blend the sides that touch straight edge tiles.
 * Returns the original url on any failure / missing neighbor.
 */

export async function rebuildCornerTile(
  role: TileSetRole,
  cornerUrl: string,
  neighborUrls: Partial<Record<TileSetRole, string>>
): Promise<string> {
  const grafts = CORNER_GRAFTS[role]
  if (grafts) {
    try {
      return await reconcileCornerTile(cornerUrl, grafts, neighborUrls)
    } catch {
      /* fall through */
    }
  }
  return cornerUrl
}

/**
 * Reconcile all 8 corner tiles against their edge neighbors. Takes and returns
 * a role→imageUrl map; corners with a missing neighbor are passed through.
 */

export async function reconcileAllCorners(
  tilesByRole: Partial<Record<TileSetRole, string>>
): Promise<Partial<Record<TileSetRole, string>>> {
  const result: Partial<Record<TileSetRole, string>> = { ...tilesByRole }
  if (!ENABLE_CORNER_RECONCILE) return result
  const cornerRoles = Object.keys(CORNER_GRAFTS) as TileSetRole[]
  await Promise.all(
    cornerRoles.map(async (role) => {
      const cornerUrl = tilesByRole[role]
      if (!cornerUrl) return
      try {
        result[role] = await rebuildCornerTile(role, cornerUrl, tilesByRole)
      } catch {
        // Leave the original corner on any failure.
      }
    })
  )
  return result
}


export interface TileSetSlot {
  role: TileSetRole
  imageUrl: string | null
  /** True while this specific tile is being generated. */
  generating: boolean
  /** True after a successful generation; gates the "regenerate" affordance. */
  hasImage: boolean
}


export function createEmptyTileSet(): TileSetSlot[] {
  return TILESET_SLOTS.map((slot) => ({
    role: slot.role,
    imageUrl: null,
    generating: false,
    hasImage: false,
  }))
}

/**
 * Starter prompts for tile-set mode. The API drops this text into "The user's
 * material is: '…'", so each preset is a rich, color-specific MATERIAL
 * description — palette, surface micro-detail, and where the top cap vs core
 * detail sits. The system prompt already enforces the geometry (flat 2D
 * side-view, caps only on top-facing edges, no magenta-crossing colors, even
 * lighting, tileable interior), so these lean into beauty: cohesive saturated
 * palettes, hand-painted feel, clean readable shapes. The user can edit after
 * picking — these are scaffolds, not locks.
 */

export interface TilePreset {
  id: string
  label: string
  prompt: string
}


export const TILESET_PRESETS: TilePreset[] = [
  {
    id: 'grass-dirt',
    label: 'Lush meadow',
    prompt:
      'Lush meadow turf — a vibrant fresh-green grass cap of soft blades crowning the top, a rich chocolate-brown soil core flecked with tiny pebbles and pale fibrous roots, a sprinkle of small white and buttercup-yellow wildflowers and clover nestled in the grass, gentle hand-painted shading, warm and inviting storybook palette',
  },
  {
    id: 'mossy-stone',
    label: 'Mossy stone',
    prompt:
      'Weathered grey granite — a cool slate-grey stone core with fine hairline cracks and small embedded pebbles, a blanket of velvety emerald moss draped over the top and trailing into a few upper cracks, scattered pale sage lichen freckles, soft painterly highlights, calm mossy-forest palette',
  },
  {
    id: 'red-brick',
    label: 'Red brick',
    prompt:
      'Old-town red brick — warm terracotta and clay-red bricks in a clean offset bond with deep umber mortar, softly chipped rounded edges, gentle sun-faded weathering, a thin run of green moss only along the very top, even matte hand-painted finish',
  },
  {
    id: 'snowy-stone',
    label: 'Snowy peak',
    prompt:
      'Snow-capped mountain rock — a slate-grey stone core threaded with pale glacier-blue mineral veins, a thick pillow of pristine white snow crowning the top with a faint cool blue underglow, a couple of small icicles hanging from the top edge, crisp clean shapes, fresh wintry palette',
  },
  {
    id: 'wood-planks',
    label: 'Oak planks',
    prompt:
      'Stacked weathered oak planks — warm honey-amber timber with flowing wood grain and soft knots, slightly darker worn edges, thin shadowed gaps between boards, the occasional iron nail, cozy hand-painted woodland-cabin palette',
  },
  {
    id: 'sand-stone',
    label: 'Desert temple',
    prompt:
      'Sun-bleached desert sandstone — a warm golden-tan core with gentle wind-rippled striations and softly eroded rounded edges, faint ancient carved glyphs pressed into the surface, a dusting of pale sand along the top, dry sunlit ochre palette',
  },
  {
    id: 'lava-rock',
    label: 'Volcanic rock',
    prompt:
      'Volcanic basalt — a rough porous jet-black rock core with molten orange, amber and gold lava glowing deep inside the cracks, a charred darker underside, faint rising heat shimmer, intense ember palette, glow confined to the cracks only',
  },
  {
    id: 'cave-stone',
    label: 'Glow cave',
    prompt:
      'Damp glow-cavern rock — a charcoal-grey stone core with a subtle teal mineral sheen and cool shadowy crevices, clusters of small luminescent blue-and-cyan mushrooms lining the top, a soft bioluminescent glow, mysterious underground palette',
  },
  {
    id: 'crystal-ice',
    label: 'Crystal ice',
    prompt:
      'Enchanted glacier ice — a translucent pale-cyan ice core with faceted crystal shards glinting inside, a delicate frosted-snow cap on top, fine internal fractures, cold glassy white and sky-blue highlights, clean magical winter palette',
  },
  {
    id: 'jungle-moss',
    label: 'Jungle floor',
    prompt:
      'Rainforest floor — a deep damp dark-earth core laced with pale tangled roots, a thick cushion of emerald and lime moss across the top, small tropical ferns and a few tiny red-capped mushrooms sprouting up top, lush humid jungle palette',
  },
  {
    id: 'autumn-soil',
    label: 'Autumn earth',
    prompt:
      'Autumn woodland soil — a rich russet-brown earth core speckled with tiny stones and roots, a top crown of golden, amber and warm-crimson fallen leaves over short dry grass, cozy seasonal palette, soft warm painterly shading',
  },
  {
    id: 'temple-gold',
    label: 'Marble & gold',
    prompt:
      'Ancient temple marble — a pale ivory marble core with soft grey veining, ornate engraved scrollwork picked out in warm antique-gold inlay, gently chipped corners, a whisper of moss settled in the top grooves, elegant regal palette',
  },
  {
    id: 'obsidian',
    label: 'Obsidian glass',
    prompt:
      'Polished obsidian — a glossy jet-black volcanic-glass core with a smooth surface and a subtle teal-and-gold iridescent sheen, sharp glassy chipped edges catching cool reflections, sleek dark luxurious palette',
  },
  {
    id: 'coral-reef',
    label: 'Coral reef',
    prompt:
      'Sunlit coral reef rock — a warm sandy-tan stone core encrusted with turquoise and bright-orange coral, tiny white shells and barnacles dotted about, a soft seafoam-green algae cap along the top, cheerful clean underwater palette (no pinks)',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Props / decoration — generate a contact sheet of standalone decoration
// sprites (grass tufts, rocks, vines, mushrooms, crystals…) in ONE AI call,
// laid out as a grid on a flat magenta key the client replaces with alpha.
// These are NOT tiles: they have no seamless-loop constraint — they are loose
// transparent assets meant to be scattered ON TOP of a tile map (the same way
// games like Hollow Knight layer foreground/background decoration over the
// collision geometry). One call keeps the whole set on a single matched palette.
//
// Sheet layout: fixed 4 cols × 3 rows = 12 props at 512×512 each → 2048×1536.
// Reading order is row-major to match how the API is told to fill the grid.
// ─────────────────────────────────────────────────────────────────────────────

