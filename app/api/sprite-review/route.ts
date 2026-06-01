import { NextRequest, NextResponse } from 'next/server'
import {
  ProviderHttpError,
  assertProviderReady,
  callTextProvider,
  resolveProvider,
} from '@/app/lib/providers/server'

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

// Per-body-plan animation expectations. The QA director judges the sheet
// against the animation the user actually asked for, and the anatomy of the
// body plan it belongs to (biped, quadruped, serpent, flyer, blob).
const ANIM_EXPECTATION_BY_PLAN: Record<string, Record<string, string>> = {
  biped: {
    idle: 'a subtle idle/breathing loop — the character stands still in right-facing profile; only the chest/shoulders rise and fall and knees softly flex. The lowest-motion animation, so identity and size consistency matter most.',
    walk: 'a walk cycle in place (profile, facing right) — alternating contact/pass/high poses, arms swinging opposite to legs, character does NOT slide horizontally across cells.',
    run: 'a run cycle in place (profile, facing right) — forward lean, high knees, airborne mid-stride frames, strong arm pumping, no horizontal sliding.',
    jump: 'a single jump action (profile, facing right, plays once) — crouch wind-up, launch, tucked peak, descend, landing impact, recover. Purely vertical motion.',
    attack: 'a single attack action (profile, facing right, plays once) — ready, wind-up/coil, forward burst, max-extension impact, follow-through, recover.',
    hurt: 'a single hurt/take-damage reaction (profile, facing right, plays once) — recoil from an impact and recover.',
    death: 'a single death animation (profile, facing right, plays once) — the character is struck and collapses.',
  },
  quadruped: {
    idle: 'a subtle standing idle — the four-legged creature stands still on all fours in right-facing profile, only breathing. Lowest motion, so size/identity consistency matters most.',
    walk: 'a 4-beat walk cycle in place (profile, head to the right) — the four legs step in a natural sequence; the creature does NOT slide horizontally.',
    run: 'a gallop in place (profile, head to the right) — gathered and extended phases with airborne suspension frames; no horizontal sliding.',
    jump: 'a single vertical leap (profile, head to the right, plays once) — crouch, launch, tucked peak, land, recover.',
    pounce: 'a single forward pounce (profile, head to the right, plays once) — crouch/coil, explosive leap forward, airborne reach, strike down, recover.',
    hurt: 'a single hurt reaction (profile, head to the right, plays once) — recoil from a hit and recover.',
    death: 'a single death animation (profile, head to the right, plays once) — the beast is struck and collapses to the ground.',
    sleep: 'a slow sleep loop (profile, head to the right) — curled on the ground, only breathing.',
  },
  serpent: {
    idle: 'a gentle resting undulation (profile, head to the right) — very low amplitude, body in place.',
    slither: 'a slither/swim loop (profile, head to the right) — a smooth sine wave travels tail-to-head; the body stays in place; frame 8 loops back to frame 1.',
    strike: 'a single strike (profile, head to the right, plays once) — draw back into a coil, lunge the head far forward (mouth open), then retract.',
    coil: 'a single coil-up (profile, head to the right, plays once) — the body tightens from a loose wave into a compact coil with the head raised; ends coiled.',
    hurt: 'a single hurt thrash (profile, head to the right, plays once) — a sharp recoil wave that settles.',
    death: 'a single death (profile, head to the right, plays once) — one last thrash, then the body goes limp and lies flat on the ground.',
  },
  flyer: {
    idle: 'a hover loop (profile, facing right) — gentle wing beats with the body floating in mid-air (airborne, not standing on the ground).',
    flap: 'a powered wing-flap loop (profile, facing right) — full up/down flap with the body bobbing; airborne; frame 8 loops back to frame 1.',
    glide: 'a glide loop (profile, facing right) — wings held extended and steady with only subtle motion; airborne.',
    dive: 'a single dive (profile, facing right, plays once) — wings tuck/sweep back, body pitches nose-down and plunges, then flares to pull out.',
    hurt: 'a single hurt reaction in mid-air (profile, facing right, plays once) — jolt back, wings splay, recover.',
    death: 'a single death (profile, facing right, plays once) — the wings collapse and the creature tumbles from mid-air down to the ground.',
  },
  blob: {
    idle: 'a breathing pulse loop (profile, eyes to the right) — gentle squash/stretch in place at constant volume.',
    hop: 'a hop loop (profile, eyes to the right) — squash on the ground, stretch in the air; in place; frame 8 loops back to frame 1.',
    bounce: 'a bigger, snappier bounce loop (profile, eyes to the right) — exaggerated squash & stretch; in place.',
    lunge: 'a single forward lunge (profile, eyes to the right, plays once) — wind back, stretch forward to attack, snap back.',
    hurt: 'a single hurt reaction (profile, eyes to the right, plays once) — slammed flat, wobble, settle.',
    death: 'a single death (profile, eyes to the right, plays once) — the blob collapses and spreads into a flat puddle.',
  },
}

// Per-body-plan readability / anatomy / facing rules injected into the QA
// acceptance criteria, replacing the biped-only "left vs right arm/leg" wording.
const PLAN_RULES: Record<
  string,
  { subject: string; readability: string; anatomy: string; facing: string }
> = {
  biped: {
    subject: 'character',
    readability:
      'LIMB READABILITY — left vs right arm/leg stay distinguishable (near limb lighter/forward, far limb darker/behind); legs/arms do not merge into one unreadable blob.',
    anatomy:
      'Correct anatomy — no missing, extra, merged, or deformed limbs; no smeared faces/hands.',
    facing:
      'Consistent FACING — the character stays in right-facing profile every frame (no flip to left, no turn to camera).',
  },
  quadruped: {
    subject: 'four-legged creature',
    readability:
      'LIMB READABILITY — all FOUR legs stay distinguishable (near legs lighter/forward, far legs darker/behind); the legs do not merge into one blob; the neck/head and tail read clearly.',
    anatomy:
      'Correct anatomy — exactly four legs (no missing, extra, or merged legs), one head, one tail; no smeared or deformed parts.',
    facing:
      'Consistent FACING — the creature stays in right-facing profile (head to the right) every frame (no flip, no turn to camera).',
  },
  serpent: {
    subject: 'serpent / fish',
    readability:
      'BODY READABILITY — the body reads as ONE smooth tapered tube (thicker mid, thinner tail); overlapping curves stay separated by clean edges; no kinks or broken segments.',
    anatomy:
      'Correct anatomy — a single continuous body from head to tail; no accidental limbs, no severed segments, no smeared head.',
    facing:
      'Consistent FACING — the head stays at the RIGHT end of the body every frame (no flip, no turn to camera).',
  },
  flyer: {
    subject: 'winged creature',
    readability:
      'WING READABILITY — the two wings stay distinguishable (near wing lighter, far wing darker); the wings do not merge into one shape; the head and tail read clearly.',
    anatomy:
      'Correct anatomy — exactly two wings, one head, one tail (no missing, extra, or merged wings); no smeared or deformed parts.',
    facing:
      'Consistent FACING — the creature faces RIGHT (head to the right) every frame and stays airborne (no flip, no turn to camera).',
  },
  blob: {
    subject: 'amorphous blob',
    readability:
      'SILHOUETTE READABILITY — ONE clean blob silhouette per frame; the squash/stretch reads clearly; no stray detached globs (except intentional death/spread frames).',
    anatomy:
      'Form — a coherent amorphous body with a clean silhouette; no accidental limbs or faces; not torn into random pieces (except where the death animation intends to spread).',
    facing:
      'Consistent FACING — the eyes face RIGHT every frame (no flip to the left, no turn to camera).',
  },
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
    const { prompt, anim, bodyPlan, sceneBrief, apiKey, model, sheetImage, anchorImage, providerSettings } =
      await request.json()

    if (typeof sheetImage !== 'string' || !sheetImage.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Missing sprite sheet image' }, { status: 400 })
    }

    // Sprite QA 需要视觉理解，使用 vision provider。
    const provider = resolveProvider({
      capability: 'vision',
      providerSettings,
      legacyApiKey: apiKey,
      legacyModel: model,
      defaultModel: DEFAULT_MODEL,
    })
    const providerProblem = assertProviderReady(provider)
    if (providerProblem) {
      return NextResponse.json(
        { error: providerProblem.message },
        { status: providerProblem.status }
      )
    }

    const planKey =
      typeof bodyPlan === 'string' && ANIM_EXPECTATION_BY_PLAN[bodyPlan]
        ? bodyPlan
        : 'biped'
    const animKey = typeof anim === 'string' ? anim.toLowerCase() : ''
    const expectation =
      ANIM_EXPECTATION_BY_PLAN[planKey][animKey] ||
      'a coherent character animation sequence read left-to-right, top-to-bottom.'
    const planRules = PLAN_RULES[planKey] ?? PLAN_RULES.biped

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
3. CELL BOUNDARIES — the complete character/creature for each frame must fit fully inside its own cell. If a cell contains a full creature PLUS a cropped partial creature/body part from the row or column above/below/beside it, or if a creature is cut off at a cell edge, REJECT. This is a grid-boundary/spillover failure, not a valid animation pose.

B. IDENTITY CONSISTENCY (the professional definition of "no flicker")
3. Every frame is unmistakably the SAME character${hasAnchor ? ' as the anchor' : ''}: same outfit, palette, hairstyle, helmet, weapon, accessories, and body proportions.
4. No part appears or disappears between frames (e.g. a shield in some frames but not others, a cape that changes shape arbitrarily, color shifts).

C. SPATIAL STABILITY
5. Consistent SCALE — the character is the same size in every frame (no zooming in/out between cells).
6. Consistent BASELINE — feet/body rest on the same ground line in grounded frames; the silhouette sits at a consistent level (small breathing/crouch variation is fine). (For airborne/flying creatures, judge a consistent FLOATING level instead of feet on a ground line.)
7. STATIONARY framing — the ${planRules.subject} is centered the same way each frame and does not slide horizontally across cells (locomotion is "in place").
   (EXCEPTION: jump, run/gallop, pounce, hop, bounce, dive and flying animations have intentional airborne frames where the whole body lifts uniformly — that is correct, not a defect.)

D. ANIMATION QUALITY (senior-animator standards)
8. The frames READ as the intended action with clear, deliberate posing — recognizable key poses and in-betweens, not random or near-identical stances.
8b. SINGLE GAIT ACROSS THE WHOLE SHEET (top-priority defect) — all frames are ONE continuous cycle of the SAME motion at the SAME energy. REJECT if the sheet is split into two different animations — most commonly the TOP ROW showing one gait (e.g. a fast run/gallop with airborne extension) and the BOTTOM ROW showing a different, calmer gait (e.g. a walk or a near-stand). The bottom row must be the mid-cycle continuation of the same ${animKey || 'requested'} motion as the top row, not a second slower animation.
9. Believable WEIGHT & ARCS — limbs move on arcs, weight shifts read correctly; no stiff "T-pose drift" or frames that fight the motion.
10. ${planRules.readability}
11. LOOP INTEGRITY — for looping actions (idle, walk, run/gallop, slither/swim, flap, glide, hover, hop, bounce, pulse) the last frame flows back into the first with no jarring pop. (One-shot actions — jump, attack, pounce, strike, coil, dive, lunge, hurt, death — play once and do NOT need to loop.)
12. SILHOUETTE — each pose has a clean, readable silhouette; no broken, melted, or smeared shapes.

E. ANATOMY & CLEANLINESS
13. ${planRules.anatomy}
14. ${planRules.facing}
15. CLEAN EDGES — no leftover magenta/pink halo, colored outline, motion-blur streaks, drop shadow, ground line, or semi-transparent garbage around the character.

F. BACKGROUND / CHROMA-KEY (critical — a wrong key colour makes the frame unusable)
16. Everywhere that is NOT the character must be fully TRANSPARENT — the checkered/transparent background must show through cleanly around and between the character's limbs. If a frame instead has an OPAQUE background — a solid grey, beige, black, white, blue, or any flat-colour rectangle filling the cell behind the character — that means the generator did NOT paint pure magenta #FF00FF there, so the app could not key it out. This is an automatic REJECT.
17. Check the gaps INSIDE the silhouette too (between the legs, under a raised arm, inside a bent elbow): those must also be transparent, not filled with a leftover background colour.

Judge like a professional: intended pose changes, airborne run/jump frames, natural squash/stretch, and minor sub-pixel variation are GOOD — never flag them. Do NOT invent problems. But hold the bar: if identity drifts, a frame is a duplicate, a cell contains spillover from a neighbouring frame, the motion doesn't read, limbs are broken, or a non-magenta background survived so the cell isn't transparent, it FAILS.

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

    const text = await callTextProvider(
      provider,
      {
        capability: 'vision',
        systemPrompt,
        userContent: content as any,
        maxTokens: 600,
        temperature: 0.2,
        title: 'AI Image Extender - Sprite QA',
      },
      { referer: request.headers.get('referer') }
    )

    const review = parseReview(text)
    if (!review) {
      // Don't block the user on a parse failure — treat as approved.
      return NextResponse.json({ ok: true, issues: [], fix: '' })
    }
    return NextResponse.json(review)
  } catch (error) {
    console.error('Error in sprite-review route:', error)
    if (error instanceof ProviderHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
