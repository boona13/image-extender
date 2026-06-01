import { NextRequest, NextResponse } from 'next/server'
import {
  ProviderHttpError,
  assertProviderReady,
  callImageProvider,
  resolveProvider,
} from '@/app/lib/providers/server'

const DEFAULT_MODEL = 'google/gemini-3.1-flash-image-preview'

export async function POST(request: NextRequest) {
  try {
    const {
      prompt,
      width,
      height,
      artStyle,
      apiKey,
      model,
      layerRole,
      sceneBrief,
      tileMode,
      tileRole,
      tileSheet,
      tileGuideImage,
      tileFixNotes,
      spriteSheet,
      spriteAnchor,
      spriteAnim,
      spriteBodyPlan,
      spriteFrameCount,
      spriteGridCols,
      spriteGridRows,
      spriteFrameSize,
      spriteGuideImage,
      spritePoseGuide,
      spriteIdentityImage,
      spriteFixNotes,
      propSheet,
      propMode,
      propRole,
      propList,
      propCols,
      propRows,
      propCount,
      propRefImage,
      propAvoidHint,
      providerSettings,
    } = await request.json()

    if (!prompt || !width || !height) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // 生成类工作流统一走 image provider；旧的 apiKey/model 字段继续作为回退，
    // 这样未配置自定义 provider 的用户仍然保持原 OpenRouter 行为。
    const provider = resolveProvider({
      capability: 'image',
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

    // Art style descriptions
    const artStyleDescriptions: { [key: string]: string } = {
      'cinematic': 'cinematic photography with dramatic lighting and film grain',
      'vintage': 'vintage film photography with faded colors and retro feel',
      'black-white': 'black and white photography with rich contrast',
      'macro': 'macro photography with shallow depth of field',
      'oil-painting': 'oil painting style with visible brush strokes and rich textures',
      'watercolor': 'watercolor painting with soft washes and flowing colors',
      'impressionism': 'impressionist painting style with loose brushwork',
      'abstract': 'abstract art with bold shapes and colors',
      'pop-art': 'pop art style with bold colors and graphic elements',
      'cubism': 'cubist style with geometric shapes and multiple perspectives',
      'minimalist': 'minimalist art with simple forms and limited colors',
      'digital-art': 'digital art with smooth gradients and modern aesthetics',
      'cyberpunk': 'cyberpunk style with neon colors and futuristic elements',
      'vaporwave': 'vaporwave aesthetic with pastel colors and retro-futuristic vibes',
      'low-poly': 'low poly 3D art with geometric faceted surfaces',
      'pixel-art': 'pixel art style with retro video game aesthetics',
      '3d-render': '3D rendered look with realistic lighting and materials',
      'anime': 'anime/manga style with bold lines and vibrant colors',
      'cartoon': 'cartoon illustration with exaggerated features',
      'comic-book': 'comic book style with bold inking and halftone dots',
      'sketch': 'pencil sketch with cross-hatching and shading',
      'ink': 'ink drawing with bold black lines and dramatic contrast',
      'studio-ghibli': 'Studio Ghibli animation style with whimsical, hand-drawn aesthetics and rich environmental details',
      'pixar': 'Pixar animation style with smooth 3D rendering, expressive characters, and vibrant colors',
      'disney': 'Disney animation style with classic hand-drawn or modern 3D aesthetics and magical atmosphere',
      'dreamworks': 'DreamWorks animation style with dynamic expressions and cinematic lighting',
      'illumination': 'Illumination Entertainment style with bright colors, playful characters, and bold shapes',
      'laika': 'Laika Studios stop-motion style with intricate textures and handcrafted details',
      'cartoon-network': 'Cartoon Network style with bold outlines, simplified shapes, and vibrant colors',
      'nickelodeon': 'Nickelodeon animation style with energetic, expressive characters and bright color palettes',
      'aardman': 'Aardman claymation style with textured plasticine characters and British humor aesthetics',
      'blue-sky': 'Blue Sky Studios animation style with detailed 3D rendering and dynamic action sequences',
      'fantasy': 'fantasy art with magical and ethereal elements',
      'sci-fi': 'science fiction with futuristic technology and environments',
      'steampunk': 'steampunk style with Victorian-era and industrial elements',
      'surreal': 'surrealist style with dreamlike and impossible elements',
      'art-deco': 'Art Deco style with geometric patterns and elegant lines',
      'art-nouveau': 'Art Nouveau with flowing organic lines and natural motifs',
      'retro-80s': '1980s retro style with bright colors and bold graphics',
      'retro-50s': '1950s vintage style with pastel colors and classic aesthetics'
    }

    // Build the full prompt
    let fullPrompt = prompt

    if (artStyle && artStyleDescriptions[artStyle]) {
      fullPrompt = `Create an image in ${artStyleDescriptions[artStyle]}. ${prompt}`
    }

    // Parallax mode: when a layer role is provided, scaffold the prompt with
    // role-specific composition rules. Non-sky layers must isolate elements
    // on a flat magenta background that the client will key out into alpha.
    const KEY_COLOR_HEX = '#FF00FF'
    const layerRoleInstructions: Record<string, string> = {
      sky: `\n\nPARALLAX LAYER — SKY / BACK BACKGROUND (must tile horizontally):
- This is the back-most layer of a parallax scene. It must be FULLY OPAQUE (no transparency).
- Composition: a wide, continuous sky and far-distance atmosphere only — no characters, no foreground objects, no mid-ground details. A subtle, level distant horizon line is fine.
- HORIZONTALLY UNIFORM TONE — this is critical and non-negotiable, the image will be tiled horizontally:
  • Sky color/brightness/saturation must be IDENTICAL on the LEFT edge and the RIGHT edge of the frame, and identical at every X position in between.
  • Any tonal gradient must run TOP-TO-BOTTOM ONLY (e.g. lighter near the horizon, deeper toward the zenith). NO left-to-right gradient at all.
  • Do NOT depict the sun, the moon, sunbeams, sunrise/sunset glow on one side, gradient backlighting, vignettes, or any directional light source that makes one half of the frame brighter or warmer than the other.
  • Cloud distribution must be roughly even across X — do not pile cloud mass on one side and leave the other side clear.
- Treat the frame as a slice of an endless horizon: a viewer sliding left or right by any amount must see the same overall sky tone, just with different cloud detail.
- Even, ambient, omnidirectional lighting only. Designed to extend AND to repeat seamlessly on its left and right edges.`,
      far: `\n\nPARALLAX LAYER — FAR DISTANT (will be alpha-keyed):
- Render ONLY far-distant silhouettes (distant mountains, far skyline, faint forest line) as solid shapes occupying the lower-middle of the frame.
- Everywhere else MUST be a perfectly flat solid pure magenta color exactly ${KEY_COLOR_HEX} (R=255, G=0, B=255). The magenta will be removed by the client to produce transparency.
- No gradient sky, no foreground, no mid-ground, no characters. The far silhouettes should be clearly separated from the magenta — minimize anti-alias halos.
- Designed to extend seamlessly left/right; magenta background must remain pure ${KEY_COLOR_HEX} everywhere outside the silhouettes.`,
      mid: `\n\nPARALLAX LAYER — MID-GROUND (will be alpha-keyed):
- Render ONLY mid-distance scene elements (mid-size trees, buildings, terrain features) sitting roughly in the middle band of the frame.
- Everywhere else MUST be a perfectly flat solid pure magenta color exactly ${KEY_COLOR_HEX} (R=255, G=0, B=255). The magenta will be removed by the client to produce transparency.
- No sky, no far background, no near foreground, no characters. Element edges should be crisp against the magenta.
- Designed to extend seamlessly left/right; the magenta background must remain pure ${KEY_COLOR_HEX} everywhere outside the elements.`,
      near: `\n\nPARALLAX LAYER — NEAR FOREGROUND (will be alpha-keyed):
- Render ONLY near foreground elements (near grass, foreground bushes, foreground rocks, near tree trunks) along the bottom of the frame.
- Everywhere else MUST be a perfectly flat solid pure magenta color exactly ${KEY_COLOR_HEX} (R=255, G=0, B=255). The magenta will be removed by the client to produce transparency.
- No sky, no mid-ground, no characters. Foreground elements should be crisp against the magenta with detailed silhouettes.
- Designed to extend seamlessly left/right; the magenta background must remain pure ${KEY_COLOR_HEX} everywhere outside the elements.`,
    }

    // Tile-set role instructions — when `tileMode === true` and a `tileRole`
    // (other than 'body') is provided, render a single non-body tile of a
    // platformer auto-tile set against a magenta background that the client
    // will key out into alpha. The body tile is generated with `tileRole`
    // omitted (or set to 'body') and uses the existing 2D-seamless prompt.
    const tileBaseInstructions = `\n\nTILE-SET TILE — this tile sits in a 4x4 sprite-sheet alongside 12 other variants of the SAME material:
- Render the SAME MATERIAL described above, with palette, texture detail, and scale identical to the body tile of this set. Assume a body tile already exists; match its look exactly.
- The BACKGROUND outside the platform MUST be a perfectly flat solid pure magenta #FF00FF (R=255, G=0, B=255). No gradients, no shading, no color bleed inside the magenta region.
- The MATERIAL inside the platform must transition to magenta with an ORGANIC, NATURAL boundary — surface decoration that fits the material (grass tufts on dirt, weathered chips on stone, jagged crystals on ice, etc.). Avoid perfectly straight cut lines.
- Even, ambient, omnidirectional lighting. No directional shadows, no cast shadows, no vignette.
- Crisp anti-alias-free edges between material and magenta — minimize halos and color fringing.
- NO PINK/RED/MAGENTA LINES inside the tile. The "cut" is just where material pixels end and magenta pixels begin — it is NEVER a drawn line. Do not draw a thin pink stripe to mark the boundary. Material pixels are normal material color right up to the edge; magenta pixels are pure flat #FF00FF on the other side; nothing in between.`

    const tileRoleInstructions: Record<string, string> = {
      top: `\n\nROLE: TOP EDGE TILE.
- Top ~25% of the frame is pure magenta #FF00FF.
- Bottom ~75% of the frame is the material.
- The cut between magenta and material is a roughly horizontal but ORGANIC line with surface decoration (grass, moss, snow, etc.) poking up into the magenta.
- Tiles HORIZONTALLY ONLY: the LEFT edge content (both magenta region and material region) must match the RIGHT edge content exactly so this tile can loop side-to-side.
- The bottom edge of the material must look like the top of the body tile so the two stack cleanly.`,
      bottom: `\n\nROLE: BOTTOM EDGE TILE (mirror of TOP).
- Bottom ~25% of the frame is pure magenta #FF00FF.
- Top ~75% is the material with an organic underside boundary (roots, hanging moss, dripping rock, etc.) into the magenta.
- Tiles HORIZONTALLY ONLY (left/right edges match).`,
      left: `\n\nROLE: LEFT EDGE TILE.
- Left ~25% of the frame is pure magenta #FF00FF.
- Right ~75% is the material with an organic vertical boundary on the left side.
- Tiles VERTICALLY ONLY: the TOP edge content must match the BOTTOM edge content exactly so this tile can loop top-to-bottom.`,
      right: `\n\nROLE: RIGHT EDGE TILE (mirror of LEFT).
- Right ~25% of the frame is pure magenta #FF00FF.
- Left ~75% is the material with an organic vertical boundary on the right side.
- Tiles VERTICALLY ONLY (top/bottom edges match).`,
      tl_outer: `\n\nROLE: TOP-LEFT OUTER (CONVEX) CORNER TILE.
- The top ~25% AND the left ~25% are pure magenta #FF00FF — forming an L-shaped magenta region wrapping the top-left.
- The bottom-right ~75%×75% area is the material.
- The cut transitions naturally — top has surface decoration (grass, etc.), left has weathered material edge, and they meet in a softly rounded OUTER corner.
- Does NOT tile in any direction.`,
      tr_outer: `\n\nROLE: TOP-RIGHT OUTER (CONVEX) CORNER TILE.
- The top ~25% AND the right ~25% are pure magenta #FF00FF.
- The bottom-left ~75%×75% area is the material.
- Rounded outer corner where top decoration meets the right weathered edge.`,
      bl_outer: `\n\nROLE: BOTTOM-LEFT OUTER (CONVEX) CORNER TILE.
- The bottom ~25% AND the left ~25% are pure magenta #FF00FF.
- The top-right ~75%×75% area is the material.
- Rounded outer corner where bottom underside meets the left weathered edge.`,
      br_outer: `\n\nROLE: BOTTOM-RIGHT OUTER (CONVEX) CORNER TILE.
- The bottom ~25% AND the right ~25% are pure magenta #FF00FF.
- The top-left ~75%×75% area is the material.
- Rounded outer corner where bottom underside meets the right weathered edge.`,
      tl_inner: `\n\nROLE: TOP-LEFT INNER (CONCAVE) CORNER TILE — imagine the SOLID body tile, then take a SMALL SQUARE BITE out of its TOP-LEFT corner.
- The tile is almost entirely MATERIAL (not magenta) — material covers everything except the small top-left bite.
- The bite (the magenta region) is ONLY a small 25%×25% square in the top-left corner. It must not grow toward one third of the tile. That small bite is pure magenta #FF00FF.
- DO NOT invert this. The MAJORITY of the tile is material; the SMALL minority is magenta.
- The right edge of this tile is 100% material from top to bottom (no magenta on the right edge).
- The bottom edge of this tile is 100% material from left to right (no magenta on the bottom edge).
- The boundary of the bite is a softly rounded inner corner with organic decoration (grass, moss, etc. on the top of the bite; weathered material on the left of the bite).
- Does NOT tile in any direction.`,
      tr_inner: `\n\nROLE: TOP-RIGHT INNER (CONCAVE) CORNER TILE — SOLID body tile with a SMALL SQUARE BITE taken out of the TOP-RIGHT corner.
- Tile is almost entirely MATERIAL; only 25%×25% in the top-right is the magenta bite. It must not grow toward one third of the tile.
- The LEFT edge is 100% material. The BOTTOM edge is 100% material.
- DO NOT invert — material is the majority, magenta is the small bite.`,
      bl_inner: `\n\nROLE: BOTTOM-LEFT INNER (CONCAVE) CORNER TILE — SOLID body tile with a SMALL SQUARE BITE taken out of the BOTTOM-LEFT corner.
- Tile is almost entirely MATERIAL; only 25%×25% in the bottom-left is the magenta bite. It must not grow toward one third of the tile.
- The RIGHT edge is 100% material. The TOP edge is 100% material.
- DO NOT invert — material is the majority, magenta is the small bite.`,
      br_inner: `\n\nROLE: BOTTOM-RIGHT INNER (CONCAVE) CORNER TILE — SOLID body tile with a SMALL SQUARE BITE taken out of the BOTTOM-RIGHT corner.
- Tile is almost entirely MATERIAL; only 25%×25% in the bottom-right is the magenta bite. It must not grow toward one third of the tile.
- The LEFT edge is 100% material. The TOP edge is 100% material.
- DO NOT invert — material is the majority, magenta is the small bite.`,
    }

    // tileSheet mode — image-to-image style transfer on a structural
    // reference. The attached reference image is the geometry (a rectangle
    // with a rectangular hole on flat magenta). Gemini's image-edit path is
    // far more reliable at preserving an existing silhouette than at
    // inventing a 4×4 autotile atlas from text, so we hand it the exact
    // platform map and ask only for restyling. The client slices the
    // restyled map at known cell coordinates to pull each of the 13 unique
    // tile roles out (outer corners, edges, inner corners, body).
    if (tileSheet === true) {
      fullPrompt = `You are restyling a structural reference image for a side-view 2D platformer tile set. The reference is attached.

THE REFERENCE — what it shows:
- A rectangular platform silhouette on a flat magenta (#FF00FF) background.
- The rectangle has a smaller rectangular hole cut out of its middle, so the silhouette has FOUR outer convex corners at its outside, FOUR inner concave corners at the hole's corners, four straight outer edges (top / bottom / left / right of the rectangle), and four straight inner edges (the walls around the hole).
- Gray = "paint platform material here" — replace it with the user's material art.
- Magenta = "empty keyed background" — must remain perfectly flat pure #FF00FF.

ABSOLUTE RULES (these are not suggestions):
1. SAME SILHOUETTE: the output has the EXACT SAME silhouette as the reference. The same pixels are material, the same pixels are empty. Do NOT move, resize, soften, round, or redraw any edge.
2. FILL THE CANVAS: the platform's outer rectangle reaches the same outer extent as the reference (the reference has a ~25%-cell magenta margin on each side; match that margin exactly). DO NOT shrink the platform smaller, DO NOT center it inside a larger empty margin, DO NOT add extra magenta around the outside. If you find yourself drawing a platform that occupies less than ~85% of the canvas width/height, you are wrong — scale it up.
3. FLAT MAGENTA: wherever the reference is magenta, the output is perfectly flat solid pure magenta #FF00FF (R=255, G=0, B=255). No gradient, no shading, no halo, no anti-alias bleed. The hole in the middle is also flat magenta.
4. MATERIAL ONLY IN GRAY: wherever the reference is gray, paint the user's material. The gray itself is a placeholder — never copy plain gray into the final art.
5. NO PINK / RED-MAGENTA INSIDE THE MATERIAL. The material's color is its natural color. The client deletes ANY pixel where (R > 200 AND G < 80 AND B > 200), so:
   - Brick mortar between bricks must be DARK GRAY, TAN, or DEEP BROWN — never pink, never reddish-magenta.
   - Lava cracks must be ORANGE / YELLOW / RED-ORANGE — never pink-magenta.
   - Crystal highlights must be BLUE / WHITE / CYAN — never pink-magenta.
   - Flowers, gems, or any decoration must NOT use any color that crosses the magenta threshold above.
   - There must be ZERO thin pink stripes anywhere inside the material region. Boundaries between material and magenta are crisp organic edges with NO intermediate transition color.
6. CONTINUOUS PAINTING — the platform is ONE shape, painted as ONE continuous surface. Do NOT divide it into a grid of separate beveled blocks. Do NOT add visible boundary lines, mortar gaps, or seams at any internal location.

ART DIRECTION:
- FLAT 2D SIDE-VIEW only. NOT a 3D render, NOT isometric, NOT top-down. NO perspective, NO depth, NO extruded side faces on individual cells, NO drop shadows behind cells, NO bevels that suggest the platform is a stack of chiseled blocks. The whole platform reads as a flat painted shape against the magenta.
- For LAYERED materials (grass on dirt, snow on rock, moss on stone): apply the TOP CAP (grass / snow / moss) ONLY along TOP-FACING edges. There are EXACTLY TWO top-facing edges:
   1. The TOP edge of the outer rectangle (the platform's outermost top surface), wrapping continuously across the top-left and top-right outer corners. The cap MUST be visible at the four outer corners, not just the middle of the top edge — do not let the cap fade or stop before reaching the corner.
   2. The BOTTOM edge of the hole (the surface a player would land on if standing INSIDE the hole), wrapping continuously across the hole's bottom-left and bottom-right inner corners.
  Everywhere else shows the CORE material (dirt / rock / stone) with core detail (roots / cracks / chips / minerals). The cap is at most ~15% of the platform's vertical extent. Specifically there is NO CAP on: the BOTTOM edge of the outer rectangle (platform underside), the TOP edge of the hole (a "ceiling" from inside the hole — players cannot stand there), the LEFT or RIGHT vertical edges of either the outer rectangle or the hole.
- For HOMOGENEOUS materials (red brick, lava rock, crystal ice, wood planks): paint the same material throughout, with consistent palette and texture detail. Use SUBTLE lighting cues (slightly darker undersides, slightly brighter tops) instead of a separate top cap. Bricks / planks / blocks should NOT have visible 3D side faces; render them as flat 2D pattern on a continuous shape.
- NO INTERIOR HIGHLIGHT STRIPES OR ACCENT BARS. The interior of every brick face / plank face / stone block / etc. is a uniform color of the natural material with only small-scale natural texture (subtle grain, tiny pebbles, hairline cracks). The model is forbidden from painting:
   - Bright vertical highlight stripes through brick faces (a common red-brick failure).
   - Glowing accent lines, "shiny" streaks, or specular bars across stone / wood / ice blocks.
   - Bright diagonal slashes across any individual tile-unit of the pattern.
   - Any bright colored line that runs the full height or full width of the canvas.
  Lighting on a brick / plank / block is ambient and even across its face. If the model finds itself painting a 2-4 px bright stripe inside a brick or a plank, that is wrong — remove it and keep the face uniform.
- INNER CORNERS (the four cells at the corners of the hole, where the platform's interior wraps around the hole): paint these as continuous interior material identical to the adjacent body cells, with a clean ~25%×25% square magenta bite at the cell corner that faces the hole. The bite is a hard right-angle square — do not round it, do not make it bigger, do not let it grow toward a third of the cell. The bite's two edges carry the same organic surface detail as the adjacent straight edges of the hole. CRITICAL: the brick / plank / stone / texture pattern in an inner-corner cell must be CONTINUOUS with the adjacent body and edge cells — same brick row offset, same plank direction, same crack scale, same palette. An inner-corner cell that visibly differs from its neighbors (darker, different brick layout, different shading) is a failure.
- BODY TILE-FRIENDLINESS — the platform interior (rows / cells away from the cap edge and away from the hole) is going to be CROPPED into a single tile and REPEATED in a 2D game grid. For that to be invisible, the interior must be small-scale and uniform:
   - DO NOT paint cell-sized panels, square patches, vertical columns, horizontal rows, or subtle rectangular shading blocks inside the interior. The viewer must NOT be able to guess where the 512×512 body tile boundary will be.
   - NO long streaks that run the full height or full width of a cell. Long vertical roots that span top-to-bottom of the cell, long cracks that span left-to-right, long mortar lines that span the full width — all forbidden. Roots / cracks / mortar lines are SHORT segments (no more than about a third of the cell extent).
   - NO large geometric patterns invented by the model — no diamond scales, no hexagonal facets, no faceted plates, no large repeating decorative shapes. Stone is craggy and uneven, not crystalline. Snow/ice surfaces are smooth or finely cracked, not diamond-scaled.
   - NO single "hero" feature in the interior (one big crack, one large stone, one big root cluster).
   - The interior pattern density and scale is IDENTICAL in every region of the platform. If a 128-pixel patch of the interior is sampled from any position, it must look interchangeable with a 128-pixel patch from any other interior position.
- Even ambient lighting across the whole image. No directional shadows, no vignette, no center spotlight, no hero crack, no centered decorative cluster. Texture detail (cracks, moss, flowers, pebbles, chips, stains) is small-to-medium and evenly distributed.
- Palette and texture scale are LOCKED across the whole material region — same crack scale, same moss density, same color values everywhere there is material.
- No grid lines, no labels, no text, no captions, no arrows, no UI chrome.

The user's material is: "${prompt.trim()}". Paint this material onto the gray region of the reference exactly. Keep the magenta exactly as it is. Fill the canvas.${
        typeof tileFixNotes === 'string' && tileFixNotes.trim()
          ? `\n\nQA FIX REPORT — a previous attempt was reviewed and had the following problems. This regeneration MUST correct them while keeping everything else that was already good:\n${tileFixNotes.trim()}`
          : ''
      }`
    } else if (tileMode === true) {
      const role = typeof tileRole === 'string' ? tileRole : 'body'
      if (role === 'body' || !tileRoleInstructions[role]) {
        fullPrompt += `\n\nTILE TEXTURE — must tile seamlessly in BOTH directions:
- Render a single repeating MATERIAL across the entire frame (e.g. stone, grass, brick, dirt, wood, sand).
- No horizon, no sky, no isolated subjects, no scene composition, no characters.
- Even, ambient, omnidirectional lighting. No directional shadows, no cast shadows on one side, no vignette, no spotlight.
- Edge content on the TOP must match edge content on the BOTTOM; LEFT must match RIGHT — the image will be repeated as a tile in 2D.
- Distribute texture variation evenly across the whole frame — no concentrated focal point or hero detail in the center.
- Fully opaque. No transparency, no magenta key.`
      } else {
        fullPrompt += tileBaseInstructions + tileRoleInstructions[role]
      }
    } else if (spriteAnchor === true) {
      // Sprite ANCHOR pass — generate a single high-quality reference image
      // of the character in a neutral standing pose. This anchor gets fed
      // back into the sprite-sheet pass as a visual reference, which is by
      // far the strongest known technique for keeping the character on-model
      // across 8 frames (confirmed across multiple AI-sprite open-source
      // projects and dev blogs in 2026).
      const KEY_COLOR_HEX = '#FF00FF'

      // Body plan controls the neutral reference POSE so the anchor's body
      // matches the rig the sheet pass will skin (a quadruped on all fours, a
      // serpent in an S-curve, a winged flyer, a resting blob, etc.).
      const anchorBodyPlan =
        typeof spriteBodyPlan === 'string' ? spriteBodyPlan : 'biped'
      const ANCHOR_POSE: Record<
        string,
        { pose: string; composition: string }
      > = {
        biped: {
          pose: `POSE — NEUTRAL STANDING IDLE:
- Character stands upright in a natural, relaxed idle pose.
- Profile view (side-view), facing RIGHT.
- Feet flat on an implied floor, weight evenly distributed.
- Arms hanging naturally at the sides (or holding the character's weapon at REST — sword pointing down, bow held loosely, etc.). Do NOT show the weapon being swung, drawn, or used.
- Head looking forward (in the same direction the character faces — RIGHT).
- Calm, attentive expression. Not surprised, not attacking, not crouching, not jumping.`,
          composition: `- Character occupies ~70–85% of the frame's height.
- Character's FEET sit near the bottom of the frame (with a small magenta margin below the feet).
- Character's HEAD sits near the top of the frame (with a small magenta margin above the head).`,
        },
        quadruped: {
          pose: `POSE — NEUTRAL STANDING (ON ALL FOURS):
- Four-legged creature standing squarely on all four legs in a calm, relaxed stance.
- Profile view (side-view), the whole body in profile, HEAD to the RIGHT.
- All four feet flat on an implied floor; the two near-side legs slightly lit, the far-side legs slightly shaded so all four legs are distinguishable.
- Head up and forward (facing RIGHT), neck relaxed, tail visible and hanging naturally.
- Calm, attentive expression. Not crouching, not pouncing, not rearing.`,
          composition: `- The full body length (nose to tail) is visible and occupies ~70–88% of the frame's WIDTH; the standing height fills most of the frame's height.
- The FEET sit near the bottom of the frame (small magenta margin below the feet).
- Nothing is cut off by the frame edges — the whole creature including tail and head is inside the frame.`,
        },
        serpent: {
          pose: `POSE — NEUTRAL RESTING CURVE:
- A long, limbless serpent / eel / fish body laid out in a gentle, readable S-curve.
- Profile view (side-view), HEAD at the RIGHT end, tail tapering to the LEFT.
- The body is a smooth tapered tube: thicker at the middle, thinner at the tail, with a clearly defined head and a small eye.
- Calm and at rest. Mouth closed, not striking, not coiled tight.`,
          composition: `- The whole body fills ~75–90% of the frame's WIDTH, the S-curve spanning a good part of the height.
- The head (right) and tail tip (left) are both fully inside the frame with a small magenta margin.
- Nothing is cut off by the frame edges.`,
        },
        flyer: {
          pose: `POSE — NEUTRAL FLIGHT (WINGS SPREAD):
- A winged creature shown in side profile, facing RIGHT, hovering with both wings SPREAD OUT and clearly visible.
- The near wing is slightly lit, the far wing slightly shaded so the two wings are distinguishable.
- Body level, head forward (RIGHT), tail extended behind, legs tucked or hanging relaxed.
- Calm and steady, mid-air — not diving, not folded, not flapping hard.`,
          composition: `- The full wingspan and body are visible and occupy ~70–90% of the frame.
- The creature floats around the middle of the frame with magenta margins all around (it is airborne — do NOT plant it at the bottom).
- Nothing (wing tips, tail, head) is cut off by the frame edges.`,
        },
        blob: {
          pose: `POSE — NEUTRAL RESTING BLOB:
- An amorphous blob / slime / ooze creature at rest, a rounded body sitting on an implied floor, slightly settled (a touch wider than tall).
- Profile view (side-view), the EYES toward the RIGHT to establish facing.
- Smooth, readable silhouette with a soft highlight on the upper-left and a clear bottom that rests on the ground.
- Calm at rest — not hopping, not stretched, not splattered.`,
          composition: `- The blob occupies ~60–80% of the frame and sits near the bottom (small magenta margin below where it meets the ground).
- The whole body is visible with magenta margins on the sides and top.
- Nothing is cut off by the frame edges.`,
        },
      }
      const anchorPlan = ANCHOR_POSE[anchorBodyPlan] ?? ANCHOR_POSE.biped

      fullPrompt = `You are generating a single CHARACTER REFERENCE IMAGE for a 2D side-view game creature. This image will be used downstream as a VISUAL ANCHOR for generating an 8-frame animation sprite-sheet — the model that paints those 8 frames will be shown THIS image and asked to match it exactly. The creature's appearance in this image therefore needs to be definitive, readable, and crisp.

${anchorPlan.pose}

COMPOSITION:
- Character is centered horizontally in the frame.
${anchorPlan.composition}
- The full character is visible — no body parts cut off by the frame edges, no zoom-in on the face, no head-only portrait.

BACKGROUND:
- The background OUTSIDE the character silhouette MUST be perfectly flat solid pure magenta exactly ${KEY_COLOR_HEX} (R=255, G=0, B=255).
- The magenta fills every pixel that is not part of the character. No gradient, no shading, no halo, no anti-alias bleed.
- The character's own pixels MUST AVOID pure magenta colors — no hot pink hair, no pure magenta clothing, no pure magenta jewels. If you'd otherwise paint magenta, choose a slightly desaturated cousin (rose, hot pink with more red, etc.) so the chroma-key doesn't eat it.

ART DIRECTION:
- Crisp silhouette against the magenta. NO drop shadow, NO ground plane, NO motion blur, NO ground decorations.
- Even ambient lighting — no directional cast shadows on the character, no rim light, no center spotlight.
- No text, no captions, no labels, no UI, no health bars, no signature, no watermark.

THE CHARACTER IS: "${prompt.trim()}".

Paint that creature in the neutral pose described above, with pure flat ${KEY_COLOR_HEX} magenta everywhere else. The output is ONE SINGLE CHARACTER, not a sheet, not a grid, not multiple poses — just one definitive reference at ${width}×${height} pixels.`
    } else if (spriteSheet === true) {
      // Sprite-animation SHEET mode — single-call generation of an entire
      // N-frame keyframe sequence for a character animation.
      //
      // The prompt encodes everything 2026's AI-sprite community discovered
      // about getting frame-to-frame consistency out of a multi-panel
      // image-gen call:
      //   1. STRUCTURAL GUIDE IMAGE. When `spriteGuideImage` is attached,
      //      it's a 2048×1024 PNG with the anchor character pre-placed in
      //      each of the 8 cells at pixel-locked position/scale/baseline.
      //      This is by far the strongest known consistency lever — far
      //      stronger than a loose anchor reference, because the model now
      //      has concrete pixel coordinates to anchor position and scale
      //      against, the way tile generation uses its gray-shape guide.
      //      Prompt explicitly tells the model NOT to copy the neutral
      //      pose, only the spatial layout.
      //   2. IN-PLACE / STATIONARY language. Without it, the model
      //      translates the character horizontally across cells (the
      //      single most common failure mode for walk/run cycles).
      //   3. SAME BASELINE / SAME EYE LEVEL / SAME SCALE. Without these
      //      the character drifts vertically and changes size between
      //      cells, causing the "bouncing height" flicker.
      //   4. STRICT PER-CELL ROW/COL MAPPING. Spelling out "Row 0 Col 0 =
      //      Frame 1: ..." reduces frame-order errors substantially over
      //      generic "various poses" prompts.
      //   5. CHARACTER DETAILS REPEATED. The model "forgets" early-prompt
      //      details — re-stating outfit/palette in every cell helps.
      const cols = typeof spriteGridCols === 'number' ? spriteGridCols : 4
      const rows = typeof spriteGridRows === 'number' ? spriteGridRows : 2
      const frames =
        typeof spriteFrameCount === 'number' ? spriteFrameCount : cols * rows
      const cellPx =
        typeof spriteFrameSize === 'number' ? spriteFrameSize : 512

      const KEY_COLOR_HEX = '#FF00FF'

      // Per-animation choreography — explicit pose direction for each
      // keyframe, with cell coordinates (col, row) inlined so the model
      // sees position and pose paired in the same line.
      const buildFrameMap = (lines: string[]): string =>
        lines
          .map((line, i) => {
            const c = i % cols
            const r = Math.floor(i / cols)
            return `- FRAME ${i + 1} (column ${c}, row ${r}): ${line}`
          })
          .join('\n')

      const animChoreography: Record<string, string> = {
        idle: `IDLE / BREATHING LOOP (character is STANDING STILL and CALM — this is the lowest-motion animation, so consistency between cells matters MORE here than anywhere else):
${buildFrameMap([
  'rest pose. Standing relaxed, feet planted, weight even. Chest at relaxed midpoint, arms hanging at the sides (or weapon held at rest, pointing down).',
  'inhale begins — chest and shoulders rise a few pixels, knees straighten a hair. Hands stay at the sides.',
  'inhaling — chest fuller, shoulders a touch higher, head holds steady.',
  'PEAK INHALE — chest at its HIGHEST/fullest, shoulders highest, posture tallest. Knees nearly straight.',
  'exhale begins — chest and shoulders settling back down.',
  'exhaling — chest lowering toward the midpoint, shoulders relaxing.',
  'SETTLE — lowest point of the breath, knees soften slightly so the body dips a hair, head tips down a touch. Feet stay planted.',
  'return to the rest pose, NEAR-IDENTICAL to FRAME 1. Frame 8 → frame 1 must loop seamlessly.',
])}
- The motion is SUBTLE but REAL: the chest/shoulders rise and fall and the knees softly flex. The FEET stay planted on the same baseline; the HORIZONTAL position never changes.
- ZERO TOLERANCE ON DRIFT (idle exposes it the most): the character is the EXACT SAME SIZE in every cell — do NOT draw the character larger in some cells and smaller in others, and do NOT zoom in or out between the top row and the bottom row. The head sits at the same height (±a few px for breathing) and the feet sit on the same line in all 8 cells.
- EXACTLY ONE character per cell — never two figures, never a duplicate or ghost, never the character drawn twice in one cell.
- The character does NOT turn to face the camera and does NOT change facing — it stays in RIGHT-facing profile, calm and standing, in all 8 frames.`,
        walk: `WALK CYCLE — character WALKS IN PLACE, profile, facing RIGHT, feet stay at the SAME horizontal position relative to the cell (no horizontal translation across frames):
${buildFrameMap([
  'CONTACT — right leg forward and straight, right foot just touching ground at the front; left leg back and lifted slightly off ground. Body upright. Left arm forward, right arm back.',
  'DOWN — weight shifts onto right (front) leg. Body at LOWEST point of cycle. Left foot lifted higher behind. Arms swinging through.',
  'PASS — left leg passes directly under body (vertical, foot below hip). Body rising back up. Right leg straight behind. Arms near sides.',
  'HIGH POINT — left leg now forward and reaching, right leg straight behind and lifting off. Body at HIGHEST point of cycle. Right arm forward, left arm back.',
  'CONTACT (mirror of frame 1) — left leg forward and straight, foot just touching ground; right leg back and lifted slightly. Right arm forward, left arm back.',
  'DOWN (mirror of frame 2) — weight on left leg, body at LOWEST point, right foot lifted behind.',
  'PASS (mirror of frame 3) — right leg passes directly under body. Body rising.',
  'HIGH POINT (mirror of frame 4) — right leg forward and reaching, left leg straight behind. Body at HIGHEST point. Left arm forward, right arm back. Frame 8 → frame 1 must loop seamlessly.',
])}
- Arms swing OPPOSITE to legs (when left leg is forward, right arm is forward).
- The character DOES NOT advance forward across cells — it walks in place. Treat each cell as a snapshot of the character on an invisible treadmill.`,
        run: `RUN CYCLE — character RUNS IN PLACE, profile, facing RIGHT, body leaning FORWARD throughout, feet stay at the SAME horizontal position relative to the cell (no horizontal translation):
${buildFrameMap([
  'RIGHT FOOT STRIKE — right leg planted forward at ground, left leg pulled up high behind with knee bent ~90°. Body leaning forward. Right arm back, left arm forward.',
  'PUSH-OFF — right leg straightening and driving back, body launching upward. Left knee still high in front.',
  'AIRBORNE — BOTH FEET OFF THE GROUND. Knees high. Body in mid-air, leaning forward. Mid-stride.',
  'LEFT FOOT REACH — left leg extending forward to land. Right leg trailing behind.',
  'LEFT FOOT STRIKE (mirror of frame 1) — left leg planted forward, right leg pulled up high behind. Left arm back, right arm forward.',
  'PUSH-OFF (mirror of frame 2) — left leg straightening and driving back, body launching upward. Right knee high in front.',
  'AIRBORNE (mirror of frame 3) — BOTH FEET OFF THE GROUND. Knees high. Mid-air.',
  'RIGHT FOOT REACH (mirror of frame 4) — right leg extending forward to land. Frame 8 → frame 1 must loop seamlessly.',
])}
- Arms bent ~90° at the elbows, pumping STRONGLY in opposition to the legs.
- Character does NOT advance forward across cells — it runs in place on an invisible treadmill.`,
        jump: `JUMP ACTION — character jumps IN PLACE, profile, facing RIGHT, plays ONCE (does NOT loop). Feet stay at the SAME horizontal position relative to the cell on takeoff and landing (purely vertical motion):
${buildFrameMap([
  'standing neutral pose, feet planted at the cell baseline. Arms at sides.',
  'CROUCH wind-up — knees bent deeply, body lowered, arms swinging back behind the body. Feet still on ground.',
  'LAUNCH — legs straightening explosively, arms swinging forward and up, feet just leaving the ground. Body still relatively low.',
  'ASCENDING — body straightening, rising, knees beginning to tuck up under the body. Arms reaching up.',
  'PEAK — HIGHEST point of jump. Body compact: knees tucked up to chest, arms up overhead for balance. Body high in cell.',
  'DESCENDING — legs extending downward toward the ground, body falling. Arms still mostly up.',
  'LANDING IMPACT — feet just touching the ground at the cell baseline, knees bent absorbing impact, arms forward for balance, body slightly forward.',
  'recovery to standing — matching the neutral pose of FRAME 1.',
])}
- Vertical motion only. The character's horizontal position (left/right within its cell) does NOT change between cells.`,
        attack: `ATTACK ACTION — character attacks IN PLACE, profile, facing RIGHT, plays ONCE (does NOT loop). Character's feet are PLANTED at the cell baseline through the whole action (no horizontal translation):
${buildFrameMap([
  'neutral combat stance. Weapon held at the ready (sword in hand, fist clenched, staff vertical, etc.).',
  'anticipation — weapon pulled back slightly, body coiling, weight shifting onto back leg.',
  'DEEP WIND-UP — PEAK COIL. Weight FULLY on back leg, front leg slightly raised, weapon at MAXIMUM back position behind the body.',
  'forward burst — body uncoiling, weapon traveling forward fast, weight shifting onto front leg.',
  'IMPACT / MAX EXTENSION — weapon at FURTHEST forward point of the swing, body in a full lunge forward, front leg planted firmly forward, back leg straightening behind. Peak energy.',
  'follow-through — weapon swinging slightly past the impact point, body still committed forward.',
  'recovery start — weapon pulling back toward the body, weight rebalancing onto the back leg.',
  'return to neutral combat stance — matching FRAME 1 exactly.',
])}
- Only the upper body and weapon arm have large motion; the feet rotate planted-front to planted-back but stay at roughly the same horizontal position.`,
        hurt: `HURT / TAKE DAMAGE — character takes a hit IN PLACE, profile, facing RIGHT, plays ONCE. Feet stay at the SAME horizontal position relative to the cell:
${buildFrameMap([
  'neutral standing stance.',
  'IMPACT — body sharply jolted BACKWARD (away from facing direction), head snaps back, arms flying outward, expression pained, knees slightly buckling.',
  'PEAK RECOIL — body leaning farthest back, knees buckled, off-balance, arms still flailing.',
  'stagger 1 — body still leaning back but starting to recover, arms coming inward to find balance.',
  'stagger 2 — body returning toward upright, head straightening, arms settling.',
  'nearly recovered — slight remaining backward lean, knees re-straightening.',
  'settling — almost back to neutral, weight rebalancing onto both feet.',
  'recovered neutral stance — matching FRAME 1.',
])}`,
        death: `DEATH / COLLAPSE — character collapses IN PLACE, profile, facing RIGHT, plays ONCE, ends in a final resting pose. Character does NOT translate horizontally — body folds down toward the cell baseline:
${buildFrameMap([
  'standing, taking a final hit, shock pose, body just beginning to lose strength.',
  'knees buckling, body sagging downward, head dropping.',
  'dropping to one knee, body folding forward, one arm reaching to the ground for support.',
  'both knees on the ground now, torso slumping forward, head hanging.',
  'falling sideways, torso tilting down toward the ground, balance lost.',
  'nearly horizontal, one arm extended along the ground, body collapsing.',
  'on the ground, body settling, last small movements.',
  'lying motionless on the ground at the bottom of the cell — final defeated rest pose, eyes closed.',
])}`,
      }

      // Non-biped body plans: each has its own animation set + choreography.
      // The deterministic pose map (utils/rigs/*) is still the authority on the
      // exact per-frame pose; this text just names the motion for the model.
      const quadrupedChoreography: Record<string, string> = {
        idle: `IDLE — four-legged creature STANDING STILL on all fours, profile, head to the RIGHT, only slow breathing:
${buildFrameMap([
  'rest. All four legs planted, weight even, head up, tail relaxed.',
  'inhale begins — ribcage rises a hair, head holds steady.',
  'inhaling — chest fuller, back rises very slightly.',
  'PEAK INHALE — chest fullest, posture tallest. Legs unchanged.',
  'exhale begins — chest settling back down.',
  'exhaling — chest lowering, tail sways a touch.',
  'SETTLE — lowest point, body dips a hair, head tips down slightly. Feet planted.',
  'return to rest, NEAR-IDENTICAL to FRAME 1 — loops seamlessly.',
])}
- ZERO horizontal drift, identical SIZE in every cell. Exactly ONE creature per cell.`,
        walk: `WALK — four-legged creature WALKS IN PLACE, profile, head to the RIGHT, feet stay at the same horizontal position (no sliding):
${buildFrameMap([
  'a hind leg reaches forward and plants; diagonally opposite front leg supports.',
  'weight transfers; body lowest; a front leg begins to lift.',
  'mid-stride — a front leg swings forward under the chest, others support.',
  'that front leg reaches forward and plants; body rising.',
  'mirror of frame 1 — opposite hind leg reaches and plants.',
  'mirror of frame 2 — weight transfers, body lowest.',
  'mirror of frame 3 — opposite front leg swings forward.',
  'mirror of frame 4 — that front leg plants; loops back to frame 1.',
])}
- A natural 4-beat walk; the near-side legs (lighter) and far-side legs (darker) stay distinguishable. Walks IN PLACE on an invisible treadmill.`,
        run: `GALLOP — four-legged creature RUNS IN PLACE, profile, head to the RIGHT, with airborne suspension frames:
${buildFrameMap([
  'GATHER — all four legs bunched under the body, back rounded, body low.',
  'hind legs drive back powerfully, front legs reach forward, body launching up.',
  'EXTENDED SUSPENSION — all four legs stretched out, body fully airborne (off the ground), stretched long.',
  'front legs reach down to land, hind legs trailing.',
  'front legs plant, hind legs swing forward under the belly.',
  'COLLECTED SUSPENSION — legs gathered under the body, airborne again, body compact.',
  'hind legs reach forward to plant.',
  'regather — back to the bunched gather pose; loops to frame 1.',
])}
- Strong forward lean, body bobs up at both airborne suspensions. Runs IN PLACE.`,
        jump: `JUMP — four-legged creature leaps IN PLACE (vertical), profile, head to the RIGHT, plays ONCE:
${buildFrameMap([
  'standing neutral on all fours.',
  'CROUCH — all legs bend deeply, body lowers, gathering to spring.',
  'LAUNCH — legs straighten explosively, body lifts, front rising first.',
  'ASCENDING — body rising, legs tucking up under the belly.',
  'PEAK — highest point, body compact, all legs tucked.',
  'DESCENDING — legs extending down toward the ground.',
  'LANDING — feet touching down, legs bending to absorb impact.',
  'recover to the neutral all-fours stance of FRAME 1.',
])}
- Vertical motion only; horizontal position never changes.`,
        pounce: `POUNCE — four-legged predator leaps FORWARD to strike, profile, head to the RIGHT, plays ONCE:
${buildFrameMap([
  'alert low stance, eyes forward.',
  'CROUCH & COIL — body low to the ground, haunches gathered, ready to spring.',
  'load — weight shifts onto the hind legs, front light.',
  'EXPLOSIVE LAUNCH — hind legs drive, body springs forward and up, front paws reaching ahead.',
  'AIRBORNE — body stretched forward through the air, front paws extended toward the target.',
  'descend — front paws lead down toward the strike point.',
  'STRIKE / LAND — front paws slam down, body landing, hind legs catching up.',
  'recover to a low crouch.',
])}`,
        hurt: `HURT — four-legged creature takes a hit IN PLACE, profile, head to the RIGHT, plays ONCE:
${buildFrameMap([
  'neutral all-fours stance.',
  'IMPACT — front rears up / head snaps back and up, body recoils away from the hit.',
  'PEAK RECOIL — head thrown back, off-balance, legs splaying.',
  'stagger — starting to recover, head coming back down.',
  'settling — body returning toward level, legs re-planting.',
  'nearly recovered.',
  'recovered neutral stance.',
  'hold neutral.',
])}`,
        death: `DEATH / COLLAPSE — four-legged creature collapses IN PLACE, profile, head to the RIGHT, plays ONCE:
${buildFrameMap([
  'standing, taking a final hit, shock pose.',
  'legs buckling, body sagging.',
  'front collapsing, chest sinking toward the ground, head dropping.',
  'chest hits the ground, hindquarters following.',
  'rolling onto the side, legs sliding out.',
  'legs splayed out on the ground, body limp.',
  'settling flat onto the ground.',
  'lying motionless on the ground — final defeated rest pose.',
])}`,
        sleep: `SLEEP — four-legged creature lies CURLED and asleep on the ground, profile, head to the RIGHT, slow breathing loop:
${buildFrameMap([
  'curled up on the ground, legs folded, tail wrapped around, head resting. Resting baseline.',
  'gentle inhale — ribcage rises a hair.',
  'inhaling — body swells very slightly.',
  'peak inhale — chest fullest.',
  'exhale begins — chest settling.',
  'exhaling — body relaxing back down.',
  'settle — lowest, fully relaxed.',
  'return to the resting pose — loops seamlessly to frame 1.',
])}
- Very low motion; the whole body stays curled on the ground in every cell.`,
      }

      const serpentChoreography: Record<string, string> = {
        idle: `IDLE — limbless serpent/eel/fish at rest, head to the RIGHT, only a slow gentle undulation:
${buildFrameMap([
  'resting in a loose, low S-curve, head raised slightly, tail to the left.',
  'a very slight wave begins to travel along the body.',
  'gentle undulation continues, head steady.',
  'wave at mid-travel, body softly curved.',
  'wave continues toward the head.',
  'body easing back toward rest.',
  'nearly at rest, smallest curve.',
  'back to the resting S-curve — loops seamlessly.',
])}
- Very low amplitude. Body stays IN PLACE (no horizontal drift). One creature per cell.`,
        slither: `SLITHER / SWIM — serpent moves with a traveling wave IN PLACE, head to the RIGHT:
${buildFrameMap([
  'a sinusoidal wave runs from tail (left) to head (right) — phase 0.',
  'the wave has advanced one step toward the head.',
  'wave advanced further — crests have shifted right.',
  'wave at the halfway phase of the loop.',
  'wave advanced — mirror-ish of frame 2.',
  'wave advanced further.',
  'wave nearly back to the start phase.',
  'wave completes one full cycle — frame 8 → frame 1 loops seamlessly.',
])}
- The body undulates in place; the head does NOT translate across cells. Smooth flowing S-curves, consistent body thickness.`,
        strike: `STRIKE — serpent pulls back then LUNGES the head forward, head to the RIGHT, plays ONCE:
${buildFrameMap([
  'ready, head raised in a loose coil.',
  'drawing the head BACK, body coiling tighter behind it.',
  'TIGHT COIL — head pulled fully back, body loaded like a spring, mouth beginning to open.',
  'release — body uncoiling, head beginning to shoot forward.',
  'FULL LUNGE — head thrust far FORWARD (to the right), mouth wide open at maximum reach.',
  'overshoot — head still forward, beginning to retract.',
  'retracting the head back toward the body.',
  'settled back into a ready coil.',
])}`,
        coil: `COIL — serpent tightens from a loose wave into a compact coil, head to the RIGHT, plays ONCE:
${buildFrameMap([
  'loose, low S-curve.',
  'body begins to draw in, curves tightening.',
  'tighter — more, smaller curves forming.',
  'coiling further, head rising over the body.',
  'tight coil forming, head on top.',
  'nearly fully coiled, compact.',
  'fully coiled, head raised and alert on top of the coil.',
  'rest in the tight coil — final pose (does not loop).',
])}`,
        hurt: `HURT — serpent thrashes from a hit IN PLACE, head to the RIGHT, plays ONCE:
${buildFrameMap([
  'neutral low S-curve.',
  'VIOLENT JOLT — body whips into a sharp, high-amplitude wave, head recoiling.',
  'PEAK THRASH — maximum contortion, body kinked.',
  'thrash easing, body still agitated.',
  'settling — amplitude dropping.',
  'nearly calm.',
  'back toward the resting curve.',
  'resting neutral curve.',
])}`,
        death: `DEATH — serpent thrashes once, goes limp and flattens onto the ground, head to the RIGHT, plays ONCE:
${buildFrameMap([
  'struck, body tensing into a curve.',
  'LAST THRASH — one violent high wave.',
  'thrash collapsing, body losing tension.',
  'going limp, curves loosening and lowering.',
  'body sagging toward the ground, amplitude dropping.',
  'nearly straight, settling flat.',
  'almost flat along the ground.',
  'lying straight and motionless on the ground — final dead pose.',
])}`,
      }

      const flyerChoreography: Record<string, string> = {
        idle: `IDLE / HOVER — winged creature hovers in place, profile, facing RIGHT, gentle wing motion (it is AIRBORNE — floating in the middle of the cell, NOT on the ground):
${buildFrameMap([
  'wings at mid-height, body level, gentle hover.',
  'wings rising toward the top of a soft beat.',
  'wings near the top, body bobbing up slightly.',
  'wings starting back down.',
  'wings at mid-height, body settling.',
  'wings drooping toward the bottom of the soft beat.',
  'wings rising again.',
  'back to mid-height — loops seamlessly.',
])}
- The near wing (lighter) and far wing (darker) stay distinguishable. The body floats; it is NOT planted on a ground line.`,
        flap: `FLY / FLAP — winged creature flies in place with a POWERFUL wing-flap loop, profile, facing RIGHT, airborne:
${buildFrameMap([
  'TOP of the upstroke — both wings raised HIGH above the body, body bobbed up.',
  'wings beginning the downstroke.',
  'mid DOWNSTROKE — wings sweeping down past horizontal.',
  'BOTTOM of the downstroke — wings fully DOWN below the body, body dipped low.',
  'wings beginning to lift (recovery).',
  'mid upstroke — wings sweeping back up.',
  'wings nearing the top again.',
  'back to the top of the upstroke — loops seamlessly.',
])}
- Strong, readable flap; body bobs up on the upstroke and dips on the downstroke. Near wing lighter, far wing darker. Flies IN PLACE.`,
        glide: `GLIDE — winged creature soars with wings HELD extended and mostly still, profile, facing RIGHT, airborne:
${buildFrameMap([
  'wings fully extended out to the sides, steady, body level.',
  'only the wing tips flutter a touch; tail adjusts slightly.',
  'body drifts up a few pixels, wings steady.',
  'wing tips flutter, body level.',
  'body drifts down a few pixels.',
  'wing tips flutter, tail sways.',
  'body easing back toward center.',
  'steady glide — loops seamlessly.',
])}
- Wings stay extended the whole time (no big flap). Subtle motion only.`,
        dive: `DIVE — winged creature tucks its wings and PLUNGES nose-down, profile, facing RIGHT, plays ONCE:
${buildFrameMap([
  'level flight, wings up, pulling up before the dive.',
  'tipping over — nose dropping, wings starting to sweep back.',
  'nose-DOWN, body angling steeply downward, wings sweeping back.',
  'STEEP PLUNGE — body pointed down, wings tucked back tight, plummeting.',
  'fastest descent — wings fully swept, body streamlined and low in the cell.',
  'beginning the pull-out — wings starting to flare.',
  'flaring the wings wide to brake.',
  'leveling back out at the bottom, wings spread.',
])}`,
        hurt: `HURT — winged creature is struck in mid-air, profile, facing RIGHT, plays ONCE:
${buildFrameMap([
  'neutral hover.',
  'IMPACT — body jolts up/back, wings flung wide, head snapping back.',
  'PEAK RECOIL — body thrown back, wings splayed, off-balance.',
  'beginning to recover, wings coming back in.',
  'settling toward level.',
  'nearly recovered hover.',
  'recovered neutral hover.',
  'hold hover.',
])}`,
        death: `DEATH — winged creature's wings collapse and it tumbles to the ground, profile, facing RIGHT, plays ONCE:
${buildFrameMap([
  'struck in mid-air, wings faltering.',
  'wings folding, body tipping forward.',
  'TUMBLING — wings collapsing, body rotating, beginning to fall.',
  'upside-down fall, wings limp.',
  'plummeting toward the ground, wings trailing.',
  'near the ground, body crumpling.',
  'crumpled onto the ground, wings splayed.',
  'lying motionless on the ground — final dead pose.',
])}
- Across the frames the creature falls from mid-air down to the ground.`,
      }

      const blobChoreography: Record<string, string> = {
        idle: `IDLE / PULSE — amorphous blob/slime at rest, profile, EYES to the RIGHT, only a slow breathing pulse:
${buildFrameMap([
  'rest — rounded blob sitting on the ground, neutral width.',
  'pulse out — body widens and flattens a touch (squash).',
  'fuller squash — widest/flattest of the breath.',
  'easing back toward neutral.',
  'neutral.',
  'pulse in — body narrows and rises a touch (stretch).',
  'tallest/narrowest of the breath.',
  'back to rest — loops seamlessly.',
])}
- Volume looks constant (wider = flatter, taller = narrower). Stays IN PLACE on the ground. Eyes face RIGHT.`,
        hop: `HOP — blob hops IN PLACE with squash & stretch, profile, EYES to the RIGHT:
${buildFrameMap([
  'resting on the ground, neutral.',
  'ANTICIPATION — squashes down low and wide, gathering to jump.',
  'LAUNCH — stretches tall and narrow as it springs up off the ground.',
  'AIRBORNE — body up off the ground, slightly stretched.',
  'APEX — highest point, body rounding out.',
  'falling — body stretching downward.',
  'LANDING — squashes down low and wide on impact with the ground.',
  'settles back to neutral — loops seamlessly.',
])}
- Hops in place (no horizontal drift). Strong squash on the ground, stretch in the air.`,
        bounce: `BOUNCE — blob bounces IN PLACE, a higher and snappier hop, profile, EYES to the RIGHT:
${buildFrameMap([
  'resting neutral.',
  'DEEP ANTICIPATION — squashes down hard and wide.',
  'EXPLOSIVE LAUNCH — stretches very tall and narrow, springing up.',
  'rising through the air, stretched.',
  'HIGH APEX — peak of a tall bounce.',
  'fast fall, stretched downward.',
  'HARD LANDING — strong squash on impact.',
  'rebounds toward neutral — loops seamlessly.',
])}
- Bigger and faster than the hop; exaggerated squash & stretch.`,
        lunge: `LUNGE — blob stretches FORWARD to attack, profile, EYES to the RIGHT, plays ONCE:
${buildFrameMap([
  'resting neutral.',
  'wind up — compresses and leans BACK (to the left).',
  'peak wind-up — fully loaded back.',
  'stretching FORWARD — body elongates to the right toward the target.',
  'FULL LUNGE — body stretched far forward (right), pointed, attacking.',
  'overshoot — still extended forward.',
  'recoil — snapping back, squashing.',
  'settles back to the neutral resting blob.',
])}`,
        hurt: `HURT — blob is struck IN PLACE, profile, EYES to the RIGHT, plays ONCE:
${buildFrameMap([
  'neutral resting blob.',
  'IMPACT — slammed flat and wide, pushed back, jiggling.',
  'rebound wobble — squishes the other way.',
  'wobble settling.',
  'smaller wobble.',
  'nearly settled.',
  'back to neutral.',
  'hold neutral.',
])}`,
        death: `DEATH — blob collapses and spreads into a flat puddle, profile, EYES to the RIGHT, plays ONCE:
${buildFrameMap([
  'struck, body shuddering upward.',
  'losing form, beginning to sag.',
  'sagging and spreading outward.',
  'spreading wider, flattening.',
  'flattening further into a low pool.',
  'a wide, low puddle.',
  'almost completely flat.',
  'a flat, motionless puddle on the ground — final dead pose.',
])}
- Across the frames the blob flattens and spreads wider as it dies.`,
      }

      const CHOREOGRAPHY_BY_PLAN: Record<string, Record<string, string>> = {
        biped: animChoreography,
        quadruped: quadrupedChoreography,
        serpent: serpentChoreography,
        flyer: flyerChoreography,
        blob: blobChoreography,
      }
      const bodyPlan =
        typeof spriteBodyPlan === 'string' && CHOREOGRAPHY_BY_PLAN[spriteBodyPlan]
          ? spriteBodyPlan
          : 'biped'
      const planChoreography = CHOREOGRAPHY_BY_PLAN[bodyPlan]

      const animType =
        typeof spriteAnim === 'string' && planChoreography[spriteAnim]
          ? spriteAnim
          : Object.keys(planChoreography)[0]
      const choreography = planChoreography[animType]

      // Per-body-plan POSE MAP instructions. The biped's "left/right leg, depth
      // shading" language doesn't translate to four legs, a wing pair, a single
      // sinuous tube, or a limbless blob — so each plan describes which parts to
      // match, how to keep overlapping parts readable, and how facing works.
      interface PoseMapParts {
        match: string
        depth: string
        sameStays: string
        facing: string
        footprint: string
      }
      const POSE_MAP_PARTS: Record<string, PoseMapParts> = {
        biped: {
          match:
            'same torso lean, same hip/knee bend on each leg, same shoulder/elbow swing on each arm, same head position. The mannequin\u2019s limbs ARE the character\u2019s limbs.',
          depth:
            'LEFT vs RIGHT LIMBS \u2014 DEPTH SHADING (critical for walk/run; without it the two legs merge into one blob): the mannequin draws the NEAR-side limbs (leg + arm closest to camera) LIGHT and the FAR-side limbs DARK. Reproduce this as DEPTH SHADING \u2014 far arm/leg noticeably darker/in shadow, near arm/leg lighter/lit \u2014 even when both legs are the same garment color. Add a dark separation edge where the near leg overlaps the far leg. The two legs and two arms must ALWAYS stay individually distinguishable.',
          sameStays:
            'SAME LEG STAYS NEAR: the light (near) leg is the SAME physical leg in every cell and the dark (far) leg the SAME \u2014 do NOT swap which leg is light vs dark between frames.',
          facing:
            'ONE FACING: the character faces RIGHT in every cell (profile / side view), exactly like the mannequins.',
          footprint:
            'same horizontal center, same height (head-top to feet), same foot baseline. The mannequin already encodes \u201Cin place\u201D / no sliding (airborne frames lift the whole skeleton uniformly).',
        },
        quadruped: {
          match:
            'same spine tilt, the same bend on EACH of the four legs (front-near, front-far, hind-near, hind-far), the same neck + head position, and the same tail position. The mannequin\u2019s limbs ARE the creature\u2019s limbs.',
          depth:
            'FOUR LEGS \u2014 DEPTH SHADING (critical; without it the legs merge into a blob): the mannequin draws the NEAR-side legs LIGHT and the FAR-side legs DARK. Reproduce this \u2014 far legs darker/in shadow, near legs lighter/lit \u2014 even in one fur color, with a dark separation edge where legs overlap. All FOUR legs must stay individually distinguishable.',
          sameStays:
            'SAME LEGS STAY NEAR: the two light (near) legs are the SAME physical legs in every cell and the two dark (far) legs the SAME \u2014 do NOT swap which side is light vs dark between frames.',
          facing:
            'ONE FACING: the creature stays in RIGHT-facing profile (head to the right) in every cell, exactly like the mannequins.',
          footprint:
            'same horizontal center, same body length and standing height, same foot baseline. The mannequin encodes \u201Cin place\u201D / no sliding (airborne gallop/jump/pounce frames lift the whole body uniformly).',
        },
        serpent: {
          match:
            'the creature\u2019s body follows the SAME sinuous spine curve the grey tube shows in that cell \u2014 same wave shape, same head position. The mannequin tube IS the creature\u2019s body.',
          depth:
            'BODY READABILITY: keep the body ONE smooth tapered tube (thicker through the middle, thinner at the tail) with a clean dark outline so overlapping curves never merge; shade the lower/under side a little darker for form.',
          sameStays:
            'CONSISTENT THICKNESS: the body keeps the same thickness profile in every cell \u2014 only the curve of the wave changes.',
          facing:
            'ONE FACING: the HEAD is at the RIGHT end of the body in every cell (side profile), exactly like the mannequins.',
          footprint:
            'same body length and the same horizontal center; the body undulates IN PLACE and does not slide across cells.',
        },
        flyer: {
          match:
            'same body pitch, the same position of EACH wing (near and far), the same tail position, and the same head position. The mannequin\u2019s wings ARE the creature\u2019s wings.',
          depth:
            'TWO WINGS \u2014 DEPTH SHADING (critical; without it the wings merge): the mannequin draws the NEAR wing LIGHT and the FAR wing DARK. Reproduce this \u2014 far wing darker/in shadow, near wing lighter/lit \u2014 with a dark separation edge where they overlap, so BOTH wings stay individually distinguishable.',
          sameStays:
            'SAME WING STAYS NEAR: the light (near) wing is the SAME physical wing in every cell and the dark (far) wing the SAME \u2014 do NOT swap which wing is light vs dark between frames.',
          facing:
            'ONE FACING: the creature faces RIGHT (head to the right) and stays AIRBORNE \u2014 floating around the middle of the cell, NOT standing on a ground line.',
          footprint:
            'same horizontal center, same body size and wingspan, floating at the same in-cell height the mannequin shows (the mannequin lifts uniformly between frames \u2014 follow it).',
        },
        blob: {
          match:
            'match the SAME silhouette the grey mannequin shows in that cell \u2014 the same squash/stretch shape, the same width and height, the same lean. The mannequin\u2019s outline IS the creature\u2019s outline.',
          depth:
            'VOLUME: keep ONE smooth blob silhouette with a clean dark outline and a soft highlight on the upper surface so it reads as a rounded 3D volume, not a flat shape.',
          sameStays:
            'CONSISTENT VOLUME: the blob looks like the same amount of material in every cell \u2014 wider means flatter, taller means narrower \u2014 never a different-sized creature.',
          facing:
            'ONE FACING: the EYES face RIGHT in every cell to establish facing (side profile).',
          footprint:
            'same horizontal center; the blob rests on the same ground baseline and does not slide across cells (airborne hop/bounce frames lift the whole body uniformly).',
        },
      }
      const poseParts = POSE_MAP_PARTS[bodyPlan] ?? POSE_MAP_PARTS.biped

      const hasGuide =
        typeof spriteGuideImage === 'string' &&
        spriteGuideImage.startsWith('data:image/')

      // Pose-map mode: the guide is no longer a neutral copy of the character
      // in every cell — it is a SKELETAL POSE MAP that already shows the
      // correct, distinct pose for each frame (rendered deterministically from
      // a rig). A separate identity reference carries the character's
      // appearance. This flips the dominant signal from "stand still" to
      // "hold THIS pose," which is the whole point of the fix.
      const hasIdentity =
        typeof spriteIdentityImage === 'string' &&
        spriteIdentityImage.startsWith('data:image/')
      const poseMode = spritePoseGuide === true && hasGuide

      const guideBlock = poseMode
        ? `

YOU ARE GIVEN ${hasIdentity ? 'TWO REFERENCE IMAGES' : 'ONE REFERENCE IMAGE'} — READ THIS, IT IS HOW THE ANIMATION IS KEPT CORRECT:
${
  hasIdentity
    ? `• IMAGE 1 = IDENTITY REFERENCE. A single picture of the character on flat magenta ${KEY_COLOR_HEX}. This is the GROUND TRUTH for what the character LOOKS LIKE: outfit, colors, hairstyle, weapon, proportions, face. Every cell of your output must depict THIS exact character.
• IMAGE 2 = POSE MAP. A ${cols * cellPx}×${rows * cellPx} canvas laid out as a ${cols}×${rows} grid of ${cellPx}×${cellPx} cells. Each cell contains a grey skeletal MANNEQUIN frozen in the EXACT pose that frame of the animation must hold. The poses differ from cell to cell — that difference IS the animation.`
    : `• POSE MAP. A ${cols * cellPx}×${rows * cellPx} canvas laid out as a ${cols}×${rows} grid of ${cellPx}×${cellPx} cells. Each cell contains a grey skeletal MANNEQUIN frozen in the EXACT pose that frame of the animation must hold. The poses differ from cell to cell — that difference IS the animation.`
}

HOW TO USE THE POSE MAP — every one of these is mandatory:
- MATCH THE POSE EXACTLY: In each output cell, pose the creature so it lines up with that cell's mannequin — ${poseParts.match} Do NOT invent your own pose; do NOT default to a neutral resting pose.
- ${poseParts.depth}
- ${poseParts.sameStays}
- DO NOT DRAW THE MANNEQUIN: The grey mannequin is scaffolding only. Replace it with the fully-drawn creature (skin, fur, scales, feathers, outfit). No grey sticks, joints, or dots in the final image — but DO keep its light-near / dark-far shading.
- ${poseParts.facing}
- POSITION & SCALE: The creature occupies the SAME footprint as the mannequin in each cell — ${poseParts.footprint} Follow it.
- IDENTITY: Every cell is the SAME creature — ${hasIdentity ? 'the one in IMAGE 1' : 'consistent across all cells'}: same colors, markings, proportions, features. ONLY the pose changes between cells.
- BACKGROUND: Outside the creature silhouette, every pixel is flat pure magenta ${KEY_COLOR_HEX}. No grid lines, no cell borders, no leftover grey.

The choreography text below NAMES each pose so you understand the motion, but the POSE MAP is the authority on the exact configuration for each frame. When in doubt, trust the mannequin.`
        : hasGuide
        ? `

STRUCTURAL GUIDE (ATTACHED IMAGE — READ THIS CAREFULLY, THIS IS HOW WE FIX FLICKER):
The image attached to this request is a STRUCTURAL TEMPLATE. It is a ${cols * cellPx}×${rows * cellPx} canvas already laid out as a ${cols}×${rows} grid of ${cellPx}×${cellPx} cells. In each of the ${frames} cells, the character has been pre-placed in a NEUTRAL standing pose at the EXACT position, scale, and baseline they must occupy in the final sheet. The background is flat magenta ${KEY_COLOR_HEX}.

USE THIS GUIDE AS A SPATIAL ANCHOR — every one of these is mandatory:
- POSITION: The character in each output cell MUST be at the SAME (x, y) pixel position inside its cell as in the guide. Do NOT shift the character left, right, up, or down between cells.
- SCALE: The character in each output cell MUST be at the SAME vertical extent (head-top to feet) as in the guide. Do NOT draw the character larger or smaller in any cell.
- BASELINE: The character's feet MUST sit at the SAME y-coordinate inside the cell as in the guide. Imagine a horizontal line across the whole canvas at the foot level of the guide — every output frame's feet must land on that line (or, for airborne frames in jump/run, above it by the choreographed amount).
- IDENTITY: The character in every output cell MUST be the EXACT SAME character shown in every cell of the guide: same outfit, same colors, same hairstyle, same weapon, same proportions, same face. The guide is the ground truth for what the character looks like.
- BACKGROUND: The flat magenta ${KEY_COLOR_HEX} in the guide is preserved EXACTLY in the output — outside the character silhouette, every pixel stays pure magenta.

CRITICAL — DO NOT JUST COPY THE GUIDE:
The guide shows the character in the SAME NEUTRAL POSE in all ${frames} cells. You are NOT being asked to reproduce that. Your job is to REPLACE THE POSE in each cell with the choreography pose described below, WHILE preserving position, scale, baseline, identity, and background EXACTLY. If your output shows the same neutral pose in every cell, you have failed the task — read the choreography section and use the prescribed pose for each cell.`
        : ''

      fullPrompt = `You are generating a single SPRITE-SHEET IMAGE: a ${cols}×${rows} grid of ${frames} animation keyframes for a 2D side-view game character. Each grid cell is exactly ${cellPx}×${cellPx} pixels. The full sheet is exactly ${cols * cellPx}×${rows * cellPx} pixels, a WIDE ${cols * cellPx}:${rows * cellPx} canvas — NOT a square canvas and NOT a screenshot/mockup containing a smaller sheet.${guideBlock}

GRID LAYOUT (single most important rule — read it twice):
- The output is ONE IMAGE containing ${frames} separate frames laid out as ${cols} columns × ${rows} rows.
- Reading order is ROW-MAJOR: top-left cell is FRAME 1, then left-to-right across the top row, then left-to-right across the next row. Concretely: (col=0, row=0)=FRAME 1, (col=1, row=0)=FRAME 2, ..., (col=${cols - 1}, row=0)=FRAME ${cols}, then (col=0, row=1)=FRAME ${cols + 1}, ..., (col=${cols - 1}, row=${rows - 1})=FRAME ${frames}.
- EACH CELL CONTAINS EXACTLY ONE FRAME of the animation, fully drawn inside that cell. Do NOT draw multiple poses in one cell. Do NOT draw the character spanning multiple cells. Do NOT draw a film-strip with sprocket holes — there are NO visible cell borders, gridlines, frame numbers, frame labels, or separators between cells in the output.
- EXACTLY ONE SINGLE CHARACTER PER CELL — this is the most important rule. Each cell shows ONE figure, centered. NEVER paint the character twice in the same cell: no twin, no clone, no duplicate, no mirror image, no reflection, no shadow-copy, no "before/after" pair, no second figure standing beside the main one. If you find yourself about to place a second character next to the first inside one cell, STOP — that is the single worst possible error for this task. One cell = one character.
- HARD CELL BOUNDARIES: each ${cellPx}×${cellPx} cell is a CLIPPING BOX. The creature in a cell must stay fully inside that cell. No head, tail, wing, leg, body, shadow, fur, or motion shape may cross into the neighbouring cell above, below, left, or right.
- MAGENTA GUTTER: leave at least ~8% of the cell as flat magenta margin around the creature inside every cell. For long creatures (wolves, snakes, birds with wings), scale the creature DOWN so the entire nose-to-tail / wingtip-to-wingtip silhouette fits comfortably inside one cell. Never crop a creature at the cell edge.
- The MAGENTA background is CONTINUOUS across the whole sheet wherever the character isn't drawn. There is no white line, dark line, or pink stripe between cells.

ONE CONTINUOUS ANIMATION (critical — do NOT split the sheet into two animations):
- All ${frames} cells are a SINGLE cycle of ONE motion: ${animType.toUpperCase()}. They are NOT two separate animations and NOT two different gaits. The cells flow 1 → ${frames} as one smooth progression, and frame ${frames} loops back into frame 1.
- The bottom row (cells ${cols + 1}–${frames}) is the CONTINUATION of the SAME cycle as the top row (cells 1–${cols}) — identical motion type, identical energy, identical forward lean, identical stride length and scale. It is the SECOND HALF of one animation, not a calmer second animation.
- NEVER render the top row as one motion (e.g. a fast run/gallop) and the bottom row as a different, slower motion (e.g. a walk or a stand). If the requested animation is ${animType.toUpperCase()}, EVERY one of the ${frames} cells — top row AND bottom row — must clearly be the SAME ${animType.toUpperCase()} motion at the SAME intensity.
- Use the per-frame choreography below for the exact pose of each numbered cell, including the bottom-row cells; those are mid-cycle poses of the SAME motion, not a second gait.

FRAME ALIGNMENT (this kills "flicker"):
- SAME BASELINE — the character's FEET sit on the SAME horizontal line in every cell. ${hasGuide ? 'Match the guide image\'s foot baseline pixel-for-pixel.' : 'Imagine drawing one straight horizontal line across the whole sheet at the character\'s foot level; every frame\'s feet touch that line.'} (For airborne frames in jump/run, the feet are above the line by the SAME amount each time, not at random heights.)
- SAME EYE LEVEL — the character's HEAD/EYES sit at the SAME horizontal line in every cell (with small natural variation from breathing or crouching, never more than ~10% of cell height).
- SAME SCALE — the character occupies the SAME vertical extent (head-top to feet) in every cell. Do NOT draw the character larger or smaller in different cells.
- SAME HORIZONTAL POSITION — the character's CENTER sits at the SAME relative horizontal position inside its cell across all frames. The character does NOT slide left or right across cells. Animations like walk and run are STATIONARY / "in place" — treat the character as if on an invisible treadmill. There is exactly ONE character centered in each cell — never a left-and-right pair of figures.
- CELL-SAFE SCALE — the complete silhouette must remain inside the same ${cellPx}×${cellPx} cell in every frame, with a magenta gutter. If a pose is long (quadruped tail/head, serpent body, wing span), make it smaller rather than letting it cross the hidden grid boundary.
- IDENTICAL CHARACTER — same outfit, same colors, same silhouette, same proportions, same head, same hair, same weapon in every cell. ONLY the pose changes.

BACKGROUND (every cell, no exceptions):
- Background outside the character silhouette is perfectly flat solid pure magenta exactly ${KEY_COLOR_HEX} (R=255, G=0, B=255).
- No gradient, no shading, no halo, no anti-alias bleed inside the magenta.
- The character's own pixels MUST AVOID pure magenta colors — no hot pink hair, no pure magenta clothing, no pure magenta jewels. The chroma-key downstream removes any pixel where (R > 200 AND G < 80 AND B > 200), so use slightly desaturated cousins (rose, hot pink with more red) if the character needs a magenta-adjacent color.

ART DIRECTION:
- Side-view (profile), character facing RIGHT in every cell.
- Crisp silhouette against the magenta. NO drop shadow, NO ground plane, NO ground line drawn, NO motion blur lines outside the character, NO ground decorations.
- Even ambient lighting — no directional cast shadows on the character, no rim light, no center spotlight.
- No text, no captions, no frame numbers, no UI, no health bars, no signature, no watermark.

ANIMATION CHOREOGRAPHY (${poseMode ? 'names each frame\u2019s pose so you understand the motion — the POSE MAP is the authority on the exact joints' : 'replace the neutral pose shown in the guide with the pose described here for each cell'}) — ${animType.toUpperCase()}:
${choreography}

CHARACTER DESCRIPTION (this is the SAME character in every cell): "${prompt.trim()}".

Output the sprite sheet: ${frames} cells in a ${cols}×${rows} grid, identical character${poseMode ? ' (appearance from the identity reference, pose from the pose map)' : hasGuide ? ' (matching the structural guide image)' : ''}, identical position/scale/baseline per the alignment rules above, ONE ${poseMode ? 'pose-map' : 'choreography'} pose per cell, magenta ${KEY_COLOR_HEX} everywhere else. Fill the canvas to the full ${cols * cellPx}×${rows * cellPx} resolution.${
        typeof spriteFixNotes === 'string' && spriteFixNotes.trim()
          ? `\n\nQA FIX REPORT — a previous attempt at this sheet was reviewed and had the following problems. This regeneration MUST correct them while keeping the character's identity (outfit, colors, proportions) IDENTICAL to the reference:\n${spriteFixNotes.trim()}`
          : ''
      }`
    } else if (propSheet === true) {
      // PROPS / DECORATION ATLAS — call #2 of the two-call pipeline. The ART
      // DIRECTOR (a separate text-model call) has already decided WHAT to paint
      // and handed us `propList` — one explicit decoration brief per cell. The
      // image model's only job here is to RENDER those exact items in a matched
      // style. (If the list is missing we fall back to free invention.) The
      // client slices the grid and chroma-keys every cell to transparency.
      const cols = Math.max(1, Math.round(Number(propCols) || 4))
      const rows = Math.max(1, Math.round(Number(propRows) || 2))
      const count = Math.max(1, Math.round(Number(propCount) || cols * rows))
      const hasRef =
        typeof propRefImage === 'string' && propRefImage.startsWith('data:image/')
      const briefs: string[] = Array.isArray(propList)
        ? propList.map((s: unknown) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
        : []
      const hasList = briefs.length > 0

      const whatToPaint = hasList
        ? `WHAT TO PAINT — render EXACTLY these ${briefs.length} decorations, ONE per cell in reading order (left-to-right, top-to-bottom). Paint each one faithfully as described; do NOT substitute or merge them:
${briefs.map((b, i) => `${i + 1}. ${b}`).join('\n')}`
        : `WHAT TO PAINT — YOU choose the decorations:
- Invent a VARIED, surprising mix of decorations that fit this world. Make every one of the ${count} cells a DIFFERENT KIND of object — no two alike, no near-duplicates.`

      fullPrompt = `${
        artStyle && artStyleDescriptions[artStyle]
          ? `Art style: ${artStyleDescriptions[artStyle]}. `
          : ''
      }You are painting a DECORATION / PROP ATLAS for a side-view 2D platformer — small standalone decoration sprites that get scattered ON TOP of a tile map.

LAYOUT — a clean contact sheet:
- A grid of EXACTLY ${cols} columns × ${rows} rows = ${count} equal cells on a flat pure magenta ${KEY_COLOR_HEX} background.
- ONE distinct decoration per cell, CENTERED, sized to fill about 70–80% of the cell with a clear magenta margin on all sides.
- Props must NOT touch or overlap each other or the cell edges — leave generous flat magenta gutters between every prop.

${whatToPaint}
${
  hasRef
    ? `\nSTYLE REFERENCE — the attached grid is a small sample of decorations already in this set. MATCH their palette, lighting, line quality, level of detail and rendering style EXACTLY so the new props clearly belong to the same set. Match only the STYLE — paint the items listed above, not copies of what's shown.\n`
    : ''
}
ABSOLUTE RULES:
1. FLAT PURE MAGENTA ${KEY_COLOR_HEX} (R=255, G=0, B=255) everywhere that is not a prop — no gradient, no shading, no halo, no anti-alias bleed, no drop shadow, and NO ground line or terrain under any prop. Each prop floats on flat magenta so it keys cleanly to transparency.
2. NO PINK / RED-MAGENTA inside the prop art. The client deletes any pixel where (R>200 AND G<80 AND B>200), so flowers, crystals, mushrooms must use colors that do NOT cross that threshold (favor greens, blues, cyans, oranges, yellows, whites, browns, and purples kept below R=200). Edges between prop and magenta must be crisp — NO intermediate pink transition.
3. FLAT 2D SIDE-VIEW only — NOT 3D, NOT isometric, NOT top-down. No perspective, no cast shadows, no horizon.
4. Even, ambient, omnidirectional lighting on every prop. No single hero light, no vignette.
5. NO text, NO labels, NO numbers, NO grid lines, NO borders, NO captions — only the props on magenta.

ART DIRECTION — the props share ONE cohesive material/palette so they look like a matched set from the same world: "${(prompt || '').toString().trim()}". Hand-painted, clean readable silhouettes, rich but cohesive palette, crisp edges.`
    } else if (propMode === true) {
      // Single decoration prop — used when the user re-rolls one prop. Open
      // ended (the model picks a fitting NEW decoration) and, when a reference
      // is supplied, matched to the rest of the library's style.
      const hasRef =
        typeof propRefImage === 'string' && propRefImage.startsWith('data:image/')
      const desc = (typeof propRole === 'string' && propRole.trim())
        ? propRole.trim()
        : 'an interesting decoration that fits this world (your choice — foliage, rock, crystal, fungus, flower, vine, root, branch, debris, etc.)'
      fullPrompt += `\n\nDECORATION PROP — paint a SINGLE standalone decoration sprite for a side-view 2D platformer, centered on a flat pure magenta ${KEY_COLOR_HEX} background:
- The prop: ${desc}.
- Centered, filling ~75% of the frame, with a clear magenta margin all around. Everywhere outside the prop is flat pure magenta ${KEY_COLOR_HEX} (R=255, G=0, B=255) which keys to transparency. No ground, no shadow, no horizon, no perspective — flat 2D side-view with even ambient lighting.
${
  hasRef
    ? '- STYLE REFERENCE: the attached image shows existing props from this world. Match their palette, lighting and rendering exactly, but make this a DIFFERENT decoration from the ones shown.\n'
    : ''
}- NO pink / red-magenta inside the art (the client deletes pixels where R>200 AND G<80 AND B>200). Crisp edges, no pink fringe. No text, labels, or grid lines.`
    } else if (typeof layerRole === 'string' && layerRoleInstructions[layerRole]) {
      fullPrompt += layerRoleInstructions[layerRole]
    }

    if (typeof sceneBrief === 'string' && sceneBrief.trim()) {
      if (tileSheet === true || tileMode === true) {
        fullPrompt += `\n\nSHARED SCENE DIRECTION — match this art direction (palette, lighting, mood, style). Apply it to the tile texture so it feels like it belongs in the same world:\n${sceneBrief.trim()}`
      } else if (spriteSheet === true) {
        fullPrompt += `\n\nSHARED SCENE DIRECTION — the character art must match this world's art direction (palette, lighting, mood, style). The character should look like it belongs in the same scene as the parallax / tile material you have already built:\n${sceneBrief.trim()}`
      } else if (propSheet === true || propMode === true) {
        fullPrompt += `\n\nSHARED SCENE DIRECTION — these decoration props must match this world's art direction (palette, lighting, mood, style) so they belong on the same tile map and in the same scene as the rest of the project:\n${sceneBrief.trim()}`
      } else if (layerRole && layerRole !== 'near') {
        fullPrompt += `\n\nSHARED SCENE DIRECTION — every parallax layer in this project must match this art direction exactly (palette, lighting, mood, style). Do not introduce colors, lighting, or stylistic choices that contradict it:\n${sceneBrief.trim()}`
      }
    }

    fullPrompt += `\n\nIMPORTANT: Create a high-quality, detailed image at exactly ${width}x${height} pixels. The image should be complete and cohesive.`

    const messageContent: any[] = []
    if (
      tileSheet === true &&
      typeof tileGuideImage === 'string' &&
      tileGuideImage.startsWith('data:image/')
    ) {
      messageContent.push({
        type: 'image_url',
        image_url: { url: tileGuideImage },
      })
    }
    // Props style reference — the existing library, so new batches / re-rolls
    // match palette + lighting while painting different decorations.
    if (
      (propSheet === true || propMode === true) &&
      typeof propRefImage === 'string' &&
      propRefImage.startsWith('data:image/')
    ) {
      messageContent.push({
        type: 'image_url',
        image_url: { url: propRefImage },
      })
    }
    // Sprite-sheet pass references, attached IN ORDER so the prompt's
    // "IMAGE 1 / IMAGE 2" labels line up:
    //   IMAGE 1 = identity reference (the anchor) — what the character looks
    //             like. Carries outfit/palette/proportions.
    //   IMAGE 2 = pose map — a grid of skeletal mannequins, one correct pose
    //             per frame. Carries the motion/structure.
    // Splitting identity from structure is the core of the pose-map fix: the
    // model skins a known character onto known-correct poses instead of
    // inventing either. (Legacy non-pose mode falls back to a single
    // structural guide image.)
    if (
      spriteSheet === true &&
      spritePoseGuide === true &&
      typeof spriteIdentityImage === 'string' &&
      spriteIdentityImage.startsWith('data:image/')
    ) {
      messageContent.push({
        type: 'image_url',
        image_url: { url: spriteIdentityImage },
      })
    }
    if (
      spriteSheet === true &&
      typeof spriteGuideImage === 'string' &&
      spriteGuideImage.startsWith('data:image/')
    ) {
      messageContent.push({
        type: 'image_url',
        image_url: { url: spriteGuideImage },
      })
    }
    messageContent.push({
      type: 'text',
      text: fullPrompt,
    })

    // 只把图片输入交给 provider；文本 prompt 始终使用前面整理好的 fullPrompt，
    // 避免 Responses 与 Chat 两种协议的 content 格式差异泄漏到业务流程。
    const inputImages = messageContent
      .map((part: any) => part?.image_url?.url)
      .filter((url: unknown): url is string => typeof url === 'string' && url.startsWith('data:image/'))
    const result = await callImageProvider(
      provider,
      {
        prompt: fullPrompt,
        inputImages,
        width,
        height,
        maxTokens: 2000,
        temperature:
          spriteSheet === true
            ? 0.2
            : tileSheet === true
              ? 0.35
              : propSheet === true
                ? 0.6
                : 0.7,
        title: 'AI Image Extender - Generator',
        forceEdit: inputImages.length > 0,
      },
      { referer: request.headers.get('referer') }
    )
    const imageUrl = result.imageUrl

    // For props, the model also returns a text line naming each decoration
    // ("ITEMS: a | b | c"). We parse it so the client can keep a cheap TEXT
    // de-dup list instead of shipping the whole library back as images.
    let names: string[] = []
    if (propSheet === true || propMode === true) {
      // 不同 provider 的文本伴随输出位置不同，适配层已经规整成 result.text。
      const text = result.text
      const m = text.match(/ITEMS?\s*:\s*(.+)/i)
      const raw = m ? m[1] : text
      names = raw
        .split(/[|\n,]+/)
        .map((s) => s.replace(/^[\s\-*\d.)]+/, '').trim().toLowerCase())
        .filter((s) => s.length > 0 && s.length <= 40)
        .slice(0, 64)
    }

    return NextResponse.json({ imageUrl, names })
  } catch (error) {
    console.error('Error in generate route:', error)
    if (error instanceof ProviderHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
