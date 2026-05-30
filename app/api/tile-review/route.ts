import { NextRequest, NextResponse } from 'next/server'

// QA ART DIRECTOR — the review half of the reverse two-call tile pipeline.
//
// The image model paints a tileset first; we composite it into a platform
// PREVIEW (and attach the raw sheet) and hand both to a *vision* model here.
// Its job is to judge the assembled result like a picky art director: are
// there visible seams where tiles meet, lighting/palette mismatches between
// neighbours, broken silhouettes, magenta/pink fringe, blurry or off-style
// tiles? If it's clean it APPROVES; otherwise it returns a concise fix report
// that the image model uses to repaint. This catches the cohesion problems a
// single blind generation can't see.
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001'

interface Review {
  ok: boolean
  issues: string[]
  fix: string
}

function parseReview(raw: string): Review | null {
  if (!raw) return null
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }
  let data: unknown = tryParse(text)
  if (!data) {
    const s = text.indexOf('{')
    const e = text.lastIndexOf('}')
    if (s !== -1 && e > s) data = tryParse(text.slice(s, e + 1))
  }
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  const ok = o.ok === true || o.approved === true || o.pass === true
  const issues = Array.isArray(o.issues)
    ? o.issues.map((x) => String(x).trim()).filter(Boolean)
    : []
  const fix =
    typeof o.fix === 'string'
      ? o.fix.trim()
      : typeof o.report === 'string'
        ? o.report.trim()
        : issues.join('; ')
  return { ok, issues, fix }
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, sceneBrief, apiKey, model, previewImage, sheetImage } =
      await request.json()

    if (
      typeof previewImage !== 'string' ||
      !previewImage.startsWith('data:image/')
    ) {
      return NextResponse.json(
        { error: 'Missing preview image' },
        { status: 400 }
      )
    }

    const openRouterKey =
      typeof apiKey === 'string' && apiKey.trim()
        ? apiKey.trim()
        : process.env.OPENROUTER_API_KEY

    if (!openRouterKey) {
      return NextResponse.json(
        { error: 'OpenRouter API key missing. Add one in Settings.' },
        { status: 401 }
      )
    }

    const modelId =
      typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL

    const systemPrompt = `You are a SENIOR ENVIRONMENT / TILESET ARTIST doing the final QA pass on a generated 2D-platformer tileset before it ships into the engine. You have the authority to REJECT work, and the experience to not nitpick natural hand-painted texture.

CRITICAL — KNOW WHAT THE PAINTER ACTUALLY CONTROLS:
The image model paints ONLY the FLAT tiles — the repeating BODY fill and the four STRAIGHT EDGE tiles (top cap, bottom, left wall, right wall). The app then builds the rounded OUTER corners and the concave INNER corners DETERMINISTICALLY by compositing those flat tiles — the painter does not, and cannot, draw a corner. Therefore a repaint can NEVER redraw, re-align, or de-seam a corner directly; it can only change the flat tiles the corners are assembled from. So you must judge only defects a REPAINT CAN FIX, and you must NOT reject just because a composited corner looks geometrically off, has a small notch, or a seam — that is the app's compositing job, not the painter's, and re-rolling the tiles will not fix it (it usually makes the whole set worse).

You are shown a PREVIEW: a platform composited from the tiles — a rounded-rectangle ground block on a blue sky, with a hole in the middle. You may also see the raw tile sheet (where you can inspect the individual flat tiles directly — prefer judging the sheet for tile quality).

REJECT ONLY for these painter-fixable defects:

★ BACKGROUND / CHROMA-KEY (the #1 thing to catch):
1. Every non-material pixel must be fully TRANSPARENT — the blue sky must show through cleanly around the platform AND through the hole in the middle. If you instead see an OPAQUE rectangular block of colour (grey, beige, black, white, or any flat fill) where there should be open sky — most visible around the hole, the inner corners, and outside the outer corners — the generator failed to paint pure magenta #FF00FF, so the app could not key it out. REJECT.

★ EDGE-CAP CONSISTENCY (this is what lets the corners build cleanly — judge it on the STRAIGHT edge tiles, not the corners):
2. The top grass/snow/moss cap (or rounded edge treatment) must sit at a CONSISTENT height/thickness and colour all along the straight top edge. A cap that jumps height, changes colour, or is missing on some top tiles is painter-fixable — REJECT.
3. The straight left/right wall edges and the bottom edge must each read consistently along their run, with the wall's lit edge in the same place on every wall tile.

★ FLAT-TILE COHESION:
4. PALETTE: all tiles share the same colours; no drifting or odd-coloured tile.
5. LIGHTING: all tiles lit the same way; none noticeably brighter/darker or lit from a different direction.
6. SEAMLESS BODY: the repeating body fill must read as one continuous surface — no hard grid line, gap, or ridge between body tiles, and no obvious repeating "hero" blob the eye snaps to.
7. FRINGE: no leftover magenta/pink halo or semi-transparent garbage clinging to tile edges.
8. QUALITY: no blurry, smeared, or much-lower-detail tile; tile content matches the material prompt.

DO NOT REJECT FOR (these are NOT painter-fixable or are desirable):
- The shape, alignment, or seam of a composited OUTER or INNER corner; a small corner notch; the corner outline. (App-composited — a repaint cannot change it.)
- Natural hand-painted variation, intentional cracks/moss/pebbles/roots, or organic edges.

Be conservative. An unnecessary repaint re-rolls EVERY tile and usually drifts the set WORSE, so when you are unsure, or when the only complaint is about a corner's geometry, APPROVE. Reject only when you can name a concrete painter-fixable defect from the list above.

Respond with STRICT JSON only — no prose, no markdown fences:
{"ok": true|false, "issues": ["rule number + location, e.g. '1: an opaque grey block fills the hole instead of transparent sky', '2: the top grass cap is much thicker on the right half than the left'", ...], "fix": "one concise paragraph telling the painter exactly what to correct — lead with the magenta key (fill EVERY non-material pixel with pure flat #FF00FF, never grey or any other colour) and edge-cap consistency, then palette/lighting/blur. Do NOT mention corners. Empty string if approved."}`

    const sceneLine =
      typeof sceneBrief === 'string' && sceneBrief.trim()
        ? `\nIntended art direction: ${sceneBrief.trim()}`
        : ''

    const userText = `Material prompt: "${(prompt || '').toString().trim()}".${sceneLine}

Review the attached platform preview${
      typeof sheetImage === 'string' && sheetImage.startsWith('data:image/')
        ? ' (and the raw tile sheet)'
        : ''
    } and return your verdict as strict JSON.`

    const content: Array<Record<string, unknown>> = [
      { type: 'image_url', image_url: { url: previewImage } },
    ]
    if (typeof sheetImage === 'string' && sheetImage.startsWith('data:image/')) {
      content.push({ type: 'image_url', image_url: { url: sheetImage } })
    }
    content.push({ type: 'text', text: userText })

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': request.headers.get('referer') || 'http://localhost:3000',
        'X-Title': 'AI Image Extender - Tile QA',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        max_tokens: 600,
        // Low temperature: this is a judgment call, we want consistency.
        temperature: 0.2,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to review tileset' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const raw = data.choices?.[0]?.message?.content
    const text =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw
              .map((p: { text?: string }) => (typeof p?.text === 'string' ? p.text : ''))
              .join('')
          : ''

    const review = parseReview(text)
    if (!review) {
      // Don't block the user on a parse failure — treat as approved.
      return NextResponse.json({ ok: true, issues: [], fix: '' })
    }
    return NextResponse.json(review)
  } catch (error) {
    console.error('Error in tile-review route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
