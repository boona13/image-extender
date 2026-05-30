import { NextRequest, NextResponse } from 'next/server'

// QA ART DIRECTOR for sprite sheets — the review half of the sprite pipeline.
//
// After the image model paints the N-frame sheet (and we chroma-key + align
// it), we hand the composed sheet + the character anchor to a *vision* model.
// Its job: judge whether all frames are the SAME character (no identity
// flicker), correctly proportioned, consistently sized/grounded, free of
// fringe, and whether they read as a coherent animation for the requested
// action. If clean it approves; otherwise it returns a fix report the image
// model uses to repaint the sheet (the locked anchor identity is preserved).
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001'

const ANIM_EXPECTATION: Record<string, string> = {
  idle: 'a subtle idle/breathing loop — the character stands still in right-facing profile; only the chest/shoulders rise and fall and knees softly flex. The lowest-motion animation, so identity and size consistency matter most.',
  walk: 'a walk cycle in place (profile, facing right) — alternating contact/pass/high poses, arms swinging opposite to legs, character does NOT slide horizontally across cells.',
  run: 'a run cycle in place (profile, facing right) — forward lean, high knees, airborne mid-stride frames, strong arm pumping, no horizontal sliding.',
  jump: 'a single jump action (profile, facing right, plays once) — crouch wind-up, launch, tucked peak, descend, landing impact, recover. Purely vertical motion.',
  attack: 'a single attack action (profile, facing right, plays once) — ready, wind-up/coil, forward burst, max-extension impact, follow-through, recover.',
  hurt: 'a single hurt/take-damage reaction (profile, facing right, plays once) — recoil from an impact and recover.',
  death: 'a single death animation (profile, facing right, plays once) — the character is struck and collapses.',
}

interface Review {
  ok: boolean
  issues: string[]
  fix: string
}

function parseReview(raw: string): Review | null {
  if (!raw) return null
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
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
    const { prompt, anim, sceneBrief, apiKey, model, sheetImage, anchorImage } =
      await request.json()

    if (typeof sheetImage !== 'string' || !sheetImage.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Missing sprite sheet image' }, { status: 400 })
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

    const animKey = typeof anim === 'string' ? anim.toLowerCase() : ''
    const expectation =
      ANIM_EXPECTATION[animKey] || 'a coherent character animation sequence read left-to-right, top-to-bottom.'

    const hasAnchor =
      typeof anchorImage === 'string' && anchorImage.startsWith('data:image/')

    const systemPrompt = `You are a SENIOR GAME ANIMATOR and animation director with 15+ years shipping 2D side-view games. You are doing the final QA approval pass on a CHARACTER SPRITE SHEET before it goes into the engine. You have the authority to REJECT work that does not meet professional standards, and the experience to not nitpick things that are actually fine.

You are shown the sprite sheet: a grid of animation frames read left-to-right, top-to-bottom, each frame on a transparent/checkered background.${
      hasAnchor
        ? ' You are ALSO shown the CHARACTER ANCHOR — the single reference image that defines the intended identity (outfit, colors, proportions, weapon). Every frame must be that same character.'
        : ''
    }

The intended animation is: ${expectation}

ACCEPTANCE CRITERIA — the sheet is APPROVED only if it passes EVERY rule below. If even ONE rule fails, REJECT and report it.

A. ONE CHARACTER PER FRAME
1. Each cell contains EXACTLY ONE character. No twin, clone, duplicate, mirror, reflection, ghost/echo, or second figure beside the main one. (Top-priority defect.)
2. No empty cell that should hold a frame; no character spanning two cells.

B. IDENTITY CONSISTENCY (the professional definition of "no flicker")
3. Every frame is unmistakably the SAME character${hasAnchor ? ' as the anchor' : ''}: same outfit, palette, hairstyle, helmet, weapon, accessories, and body proportions.
4. No part appears or disappears between frames (e.g. a shield in some frames but not others, a cape that changes shape arbitrarily, color shifts).

C. SPATIAL STABILITY
5. Consistent SCALE — the character is the same size in every frame (no zooming in/out between cells).
6. Consistent BASELINE — feet rest on the same ground line in grounded frames; the head sits at a consistent level (small breathing/crouch variation is fine).
7. STATIONARY framing — the character is centered the same way each frame and does not slide horizontally across cells (walk/run are "in place").
   (EXCEPTION: jump and run have intentional airborne frames where the whole body lifts uniformly — that is correct, not a defect.)

D. ANIMATION QUALITY (senior-animator standards)
8. The frames READ as the intended action with clear, deliberate posing — recognizable key poses and in-betweens, not random or near-identical stances.
9. Believable WEIGHT & ARCS — limbs move on arcs, weight shifts read correctly; no stiff "T-pose drift" or frames that fight the motion.
10. LIMB READABILITY — left vs right arm/leg stay distinguishable (near limb lighter/forward, far limb darker/behind); legs/arms do not merge into one unreadable blob.
11. LOOP INTEGRITY — for looping actions (idle/walk/run) the last frame flows back into the first with no jarring pop. (jump/attack/hurt/death play once and do NOT need to loop.)
12. SILHOUETTE — each pose has a clean, readable silhouette; no broken, melted, or smeared shapes.

E. ANATOMY & CLEANLINESS
13. Correct anatomy — no missing, extra, merged, or deformed limbs; no smeared faces/hands.
14. Consistent FACING — character stays in right-facing profile every frame (no flip to left or turn to camera).
15. CLEAN EDGES — no leftover magenta/pink halo, colored outline, motion-blur streaks, drop shadow, ground line, or semi-transparent garbage around the character.

F. BACKGROUND / CHROMA-KEY (critical — a wrong key colour makes the frame unusable)
16. Everywhere that is NOT the character must be fully TRANSPARENT — the checkered/transparent background must show through cleanly around and between the character's limbs. If a frame instead has an OPAQUE background — a solid grey, beige, black, white, blue, or any flat-colour rectangle filling the cell behind the character — that means the generator did NOT paint pure magenta #FF00FF there, so the app could not key it out. This is an automatic REJECT.
17. Check the gaps INSIDE the silhouette too (between the legs, under a raised arm, inside a bent elbow): those must also be transparent, not filled with a leftover background colour.

Judge like a professional: intended pose changes, airborne run/jump frames, natural squash/stretch, and minor sub-pixel variation are GOOD — never flag them. Do NOT invent problems. But hold the bar: if identity drifts, a frame is a duplicate, the motion doesn't read, limbs are broken, or a non-magenta background survived so the cell isn't transparent, it FAILS.

Respond with STRICT JSON only — no prose, no markdown fences:
{"ok": true|false, "issues": ["cite the failed rule letter/number + frame position, e.g. 'A1: frame 3 has two characters', 'F16: frame 5 has a solid grey background instead of transparent'", ...], "fix": "one concise paragraph of art-direction telling the painter exactly what to correct next pass (be specific: which frames, which rule). When the background failed to key, explicitly tell the painter to fill EVERY pixel that is not the character — including the gaps inside the silhouette — with pure flat magenta #FF00FF and never grey or any other colour. Empty string if approved."}`

    const sceneLine =
      typeof sceneBrief === 'string' && sceneBrief.trim()
        ? `\nIntended art direction: ${sceneBrief.trim()}`
        : ''

    const userText = `Character: "${(prompt || '').toString().trim()}". Animation: ${
      animKey || 'unknown'
    }.${sceneLine}

Review the attached sprite sheet${hasAnchor ? ' against the character anchor' : ''} and return your verdict as strict JSON.`

    const content: Array<Record<string, unknown>> = [
      { type: 'image_url', image_url: { url: sheetImage } },
    ]
    if (hasAnchor) {
      content.push({ type: 'image_url', image_url: { url: anchorImage } })
    }
    content.push({ type: 'text', text: userText })

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': request.headers.get('referer') || 'http://localhost:3000',
        'X-Title': 'AI Image Extender - Sprite QA',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        max_tokens: 600,
        temperature: 0.2,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to review sprite sheet' },
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
    console.error('Error in sprite-review route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
