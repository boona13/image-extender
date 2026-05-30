/**
 * poseRig.ts — deterministic 2D skeletal pose engine for sprite animation.
 *
 * WHY THIS EXISTS
 * ----------------
 * Asking an image model to *invent* a walk/run cycle across 8 panels is the
 * single least reliable thing you can ask a diffusion model to do: it has no
 * notion of biomechanics or temporal continuity, so legs land in the wrong
 * phase, frames mirror incorrectly, and the character slides across cells.
 *
 * The fix is to stop asking the model to invent motion. We author the motion
 * here, in code, as a rig: a small humanoid skeleton driven by hand-tuned
 * gait curves (joint angles per keyframe). For each animation frame we render
 * a clean grey "mannequin" in the exact pose that frame should hold. That
 * rendered figure becomes a POSE MAP the image model only has to *skin* —
 * i.e. paint the character onto a pose that is already guaranteed correct.
 *
 * This is a from-scratch, dependency-free analogue of ControlNet/OpenPose
 * conditioning, built on the same browser <canvas> the rest of the app uses.
 * Motion correctness becomes deterministic; the model does only what it is
 * good at (style + identity), never the kinematics.
 *
 * CONVENTIONS
 * -----------
 * - Canvas space: +x = right, +y = down. The character faces RIGHT (+x).
 * - Limb angles are measured from straight-DOWN, positive = swung FORWARD.
 *     leg shin absolute angle  = hipAngle - kneeFlex   (knee tucks foot back)
 *     arm forearm absolute     = shoulderAngle + elbowFlex (elbow curls fwd)
 * - `lean` is the torso angle from straight-UP, positive = leaning forward.
 * - `bodyY` is a vertical hip offset as a fraction of figure height H,
 *    positive = up (used for bob, jumps, airborne run frames, collapses).
 */

export type PoseAnimType =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'attack'
  | 'hurt'
  | 'death'

interface Limb2 {
  /** Angle of the proximal segment from straight-down, deg, + = forward. */
  base: number
  /** Flex of the distal segment, deg, >= 0. */
  flex: number
}

export interface FramePose {
  /** Torso lean from vertical, deg, + = forward. */
  lean: number
  /** Hip vertical offset as a fraction of figure height, + = up. */
  bodyY: number
  /** Near leg (drawn on top, darker). */
  legA: Limb2
  /** Far leg (drawn behind, lighter). */
  legB: Limb2
  /** Near arm. */
  armA: Limb2
  /** Far arm. */
  armB: Limb2
  /** Optional head tilt, deg, + = forward/down. */
  headTilt?: number
}

// --- Figure proportions, as fractions of total figure height H -------------
const P = {
  thigh: 0.245,
  shin: 0.245,
  torso: 0.3,
  neck: 0.05,
  headR: 0.075,
  upperArm: 0.16,
  foreArm: 0.15,
  hipSepX: 0.03,
  shoulderSepX: 0.03,
} as const

const LEG_LEN = P.thigh + P.shin // 0.49 H

const deg = (d: number) => (d * Math.PI) / 180

/** Project a point downward-ish (legs/arms) by `len` at `angleDeg` from down. */
function projDown(x: number, y: number, len: number, angleDeg: number) {
  const a = deg(angleDeg)
  return { x: x + len * Math.sin(a), y: y + len * Math.cos(a) }
}

/** Project a point upward-ish (torso/head) by `len` at `angleDeg` from up. */
function projUp(x: number, y: number, len: number, angleDeg: number) {
  const a = deg(angleDeg)
  return { x: x + len * Math.sin(a), y: y - len * Math.cos(a) }
}

// ---------------------------------------------------------------------------
// Gait authoring
// ---------------------------------------------------------------------------

/**
 * A single leg's full stride over 8 frames, as [hipAngle, kneeFlex] pairs.
 * The opposite leg reuses this curve phase-shifted by half a cycle (4 frames),
 * which is exactly what real bipedal gait does. Arms are derived as the
 * anti-phase swing of the same-side leg unless an animation overrides them.
 */
const WALK_LEG: Array<[number, number]> = [
  [25, 5], // 1 contact: forward, planted, near-straight
  [10, 18], // 2 loading: moving back under body, slight bend
  [-8, 12], // 3 mid-stance: under/behind, supporting
  [-22, 6], // 4 toe-off: back, extended
  [-20, 40], // 5 lift: knee folds to begin swing
  [-2, 55], // 6 swing: knee high, passing forward
  [18, 35], // 7 reach: extending forward
  [27, 12], // 8 pre-contact: about to plant
]

const RUN_LEG: Array<[number, number]> = [
  [28, 30], // 1 strike: front, planted, bent
  [5, 18], // 2 drive: straightening, pushing back
  [-26, 35], // 3 toe-off: trailing back
  [-34, 95], // 4 recovery: foot pulled up high behind
  [-8, 110], // 5 swing: knee driving forward, high
  [26, 88], // 6 knee-up: knee high in front
  [40, 52], // 7 reach: leg extending forward to land
  [33, 36], // 8 pre-strike: about to plant
]

/** Build arm swing from a leg curve: arm swings opposite to same-side leg. */
function armFromLeg(
  legHip: number,
  swingScale: number,
  elbowBase: number
): Limb2 {
  const base = -swingScale * legHip
  return { base, flex: elbowBase + 0.25 * Math.abs(base) }
}

/** Assemble a cyclic locomotion animation (walk/run) into 8 full poses. */
function buildLocomotion(
  legCurve: Array<[number, number]>,
  opts: {
    lean: number
    bobAmp: number
    bobPhase?: number
    armSwing: number
    elbowBase: number
  }
): FramePose[] {
  const { lean, bobAmp, bobPhase = 0, armSwing, elbowBase } = opts
  const frames: FramePose[] = []
  for (let i = 0; i < 8; i++) {
    const a = legCurve[i]
    const b = legCurve[(i + 4) % 8] // opposite leg, half-cycle offset
    // Two vertical lows per stride (one per foot-strike): cos(2θ).
    const theta = (i / 8) * Math.PI * 2
    const bodyY = bobAmp * Math.cos(2 * theta + bobPhase)
    frames.push({
      lean,
      bodyY,
      legA: { base: a[0], flex: a[1] },
      legB: { base: b[0], flex: b[1] },
      armA: armFromLeg(a[0], armSwing, elbowBase),
      armB: armFromLeg(b[0], armSwing, elbowBase),
    })
  }
  return frames
}

/** Convenience for symmetric / one-shot poses (both sides identical legs). */
function pose(
  lean: number,
  bodyY: number,
  legHip: number,
  legKnee: number,
  armShoulder: number,
  armElbow: number,
  overrides: Partial<FramePose> = {}
): FramePose {
  return {
    lean,
    bodyY,
    legA: { base: legHip, flex: legKnee },
    legB: { base: legHip, flex: legKnee },
    armA: { base: armShoulder, flex: armElbow },
    armB: { base: armShoulder, flex: armElbow },
    ...overrides,
  }
}

const WALK = buildLocomotion(WALK_LEG, {
  lean: 6,
  bobAmp: 0.018,
  armSwing: 0.7,
  elbowBase: 18,
})

const RUN = buildLocomotion(RUN_LEG, {
  lean: 20,
  bobAmp: 0.05,
  armSwing: 0.55,
  elbowBase: 75, // run arms held ~90° bent
})

// A readable "breathing + settle" idle. The old idle was a 3px twitch on 8
// near-identical frames — it looked broken AND gave the model no per-cell
// structure, so the sheet drifted in scale/position. This version has a clear
// (but still calm) breath in → hold → breath out → settle loop: the chest and
// shoulders rise, the knees subtly straighten on the inhale and soften on the
// exhale, the arms sway a touch, and the head dips slightly on the settle.
// Feet stay planted (downstream baseline alignment keeps them there), so the
// motion reads as life, not levitation.
const IDLE: FramePose[] = [
  // lean, bodyY,   legHip, knee, armSh, armEl, headTilt
  pose(3, 0.0, 4, 11, -4, 15, { headTilt: 0 }), // 1 rest
  pose(3, 0.004, 4, 10, -5, 15, { headTilt: -1 }), // 2 inhale begins
  pose(4, 0.009, 4, 9, -6, 16, { headTilt: -2 }), // 3 inhale
  pose(4, 0.013, 4, 8, -7, 16, { headTilt: -2 }), // 4 peak inhale, chest full
  pose(4, 0.009, 4, 9, -6, 16, { headTilt: -1 }), // 5 exhale begins
  pose(3, 0.004, 4, 10, -5, 15, { headTilt: 0 }), // 6 exhale
  pose(2, -0.005, 4, 13, -3, 14, { headTilt: 2 }), // 7 settle (lowest, knees soften, head dips)
  pose(3, 0.0, 4, 11, -4, 15, { headTilt: 0 }), // 8 return to rest (loops to 1)
]

const JUMP: FramePose[] = [
  pose(2, 0.0, 2, 8, 2, 14), // 1 stand
  pose(14, -0.09, 18, 62, -42, 30), // 2 crouch, arms back
  pose(6, 0.02, 6, 26, 70, 22), // 3 launch, arms swing up
  pose(-4, 0.15, -8, 48, 120, 18), // 4 ascend, knees tuck, arms up
  pose(-6, 0.23, -4, 82, 140, 16, { headTilt: -4 }), // 5 apex, tuck
  pose(2, 0.12, 2, 44, 90, 22), // 6 descend, legs reaching down
  pose(12, -0.07, 14, 66, -20, 28), // 7 land impact, knees absorb
  pose(4, 0.0, 4, 16, 6, 16), // 8 recover
]

// Attack: feet planted in a stagger stance; near (weapon) arm drives the swing.
const ATTACK: FramePose[] = [
  {
    lean: 6,
    bodyY: 0,
    legA: { base: 14, flex: 14 },
    legB: { base: -16, flex: 18 },
    armA: { base: 30, flex: 60 },
    armB: { base: -10, flex: 30 },
  }, // 1 ready stance
  {
    lean: -2,
    bodyY: 0.005,
    legA: { base: 8, flex: 16 },
    legB: { base: -20, flex: 22 },
    armA: { base: -50, flex: 80 },
    armB: { base: -20, flex: 25 },
  }, // 2 anticipation, weapon back
  {
    lean: -8,
    bodyY: 0.01,
    legA: { base: 4, flex: 18 },
    legB: { base: -26, flex: 28 },
    armA: { base: -95, flex: 95 },
    armB: { base: -28, flex: 20 },
  }, // 3 peak coil, weapon max-back
  {
    lean: 10,
    bodyY: 0.0,
    legA: { base: 20, flex: 16 },
    legB: { base: -18, flex: 24 },
    armA: { base: 10, flex: 50 },
    armB: { base: 0, flex: 28 },
  }, // 4 forward burst
  {
    lean: 22,
    bodyY: -0.01,
    legA: { base: 32, flex: 18 },
    legB: { base: -24, flex: 12 },
    armA: { base: 70, flex: 12 },
    armB: { base: 20, flex: 30 },
  }, // 5 impact / max extension
  {
    lean: 16,
    bodyY: 0.0,
    legA: { base: 28, flex: 18 },
    legB: { base: -22, flex: 16 },
    armA: { base: 95, flex: 18 },
    armB: { base: 18, flex: 30 },
  }, // 6 follow-through
  {
    lean: 8,
    bodyY: 0.0,
    legA: { base: 18, flex: 16 },
    legB: { base: -18, flex: 20 },
    armA: { base: 55, flex: 45 },
    armB: { base: 0, flex: 28 },
  }, // 7 recovery start
  {
    lean: 6,
    bodyY: 0,
    legA: { base: 14, flex: 14 },
    legB: { base: -16, flex: 18 },
    armA: { base: 30, flex: 60 },
    armB: { base: -10, flex: 30 },
  }, // 8 back to ready
]

// Hurt: sharp backward recoil (lean negative = away from facing dir) and recover.
const HURT: FramePose[] = [
  pose(4, 0, 4, 10, 4, 16), // 1 neutral
  pose(-22, -0.02, -10, 30, -50, 35, { headTilt: -18 }), // 2 impact, jolt back
  pose(-30, -0.03, -16, 42, -70, 45, { headTilt: -24 }), // 3 peak recoil
  pose(-18, -0.02, -8, 30, -40, 35, { headTilt: -14 }), // 4 stagger
  pose(-8, -0.01, 0, 20, -20, 25, { headTilt: -6 }), // 5 settling
  pose(-2, 0, 4, 14, -6, 18), // 6 nearly recovered
  pose(2, 0, 4, 12, 2, 16), // 7 recovering
  pose(4, 0, 4, 10, 4, 16), // 8 neutral
]

// Death: progressive forward fold and collapse toward the ground.
const DEATH: FramePose[] = [
  pose(-6, 0.0, 4, 12, -10, 30, { headTilt: -10 }), // 1 final hit, shock
  pose(18, -0.05, 16, 45, 10, 35, { headTilt: 12 }), // 2 knees buckle
  pose(40, -0.16, 30, 75, 35, 50, { headTilt: 28 }), // 3 down to one knee
  pose(62, -0.26, 55, 100, 60, 60, { headTilt: 45 }), // 4 both knees, slump
  pose(78, -0.34, 80, 120, 80, 70, { headTilt: 60 }), // 5 falling sideways
  pose(88, -0.4, 95, 130, 95, 80, { headTilt: 72 }), // 6 nearly horizontal
  pose(94, -0.44, 100, 135, 100, 85, { headTilt: 80 }), // 7 on the ground
  pose(96, -0.45, 100, 138, 102, 88, { headTilt: 84 }), // 8 motionless rest
]

const ANIMS: Record<PoseAnimType, FramePose[]> = {
  idle: IDLE,
  walk: WALK,
  run: RUN,
  jump: JUMP,
  attack: ATTACK,
  hurt: HURT,
  death: DEATH,
}

/** Return the 8-frame pose table for an animation (defaults to idle). */
export function getPoseFrames(anim: string): FramePose[] {
  return ANIMS[anim as PoseAnimType] ?? IDLE
}

// ---------------------------------------------------------------------------
// Subject measurement (so the mannequin matches the anchor's body plan)
// ---------------------------------------------------------------------------

export interface SubjectBounds {
  /** Height (px) of the character from head-top to feet within the cell. */
  height: number
  /** Horizontal center (px) of the character within the cell. */
  centerX: number
  /** Foot baseline (px, y) of the character within the cell. */
  baseline: number
}

/**
 * Measure the character's bounding box in a chroma-key (magenta) reference by
 * finding all non-key pixels. Returns null when the frame is essentially
 * empty so the caller can fall back to sensible defaults.
 */
export function measureSubjectBounds(
  data: Uint8ClampedArray,
  w: number,
  h: number
): SubjectBounds | null {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  let count = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const alpha = data[i + 3]
      const isKey = alpha < 24 || (r > 180 && g < 95 && b > 180)
      if (isKey) continue
      count++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (count < (w * h) / 400 || maxY < 0) return null
  return {
    height: maxY - minY + 1,
    centerX: (minX + maxX) / 2,
    baseline: maxY,
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface MannequinColors {
  key: string
  torso: string
  /** NEAR-side limbs (closer to camera) — rendered LIGHTER for depth. */
  near: string
  /** FAR-side limbs (behind the body) — rendered DARKER for depth. */
  far: string
  joint: string
  /** Dark separation edge drawn around every limb so legs/arms never merge. */
  outline: string
}

// Strong near/far value split is deliberate: in a side-view walk/run the two
// legs (and two arms) overlap constantly, and if they share one value they
// read as a single mushy blob. Lighter front limb + darker back limb + a dark
// outline is exactly how hand-drawn sprite walk cycles stay legible, and it
// tells the image model to shade the limbs the same way.
const DEFAULT_COLORS: MannequinColors = {
  key: '#ff00ff',
  torso: '#525a66',
  near: '#9aa2af',
  far: '#2c313a',
  joint: '#1b1e24',
  outline: '#101218',
}

function capsule(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  color: string,
  outline?: string,
  outlineW = 0
) {
  ctx.lineCap = 'round'
  if (outline && outlineW > 0) {
    ctx.strokeStyle = outline
    ctx.lineWidth = width + outlineW * 2
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function dot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  outline?: string,
  outlineW = 0
) {
  if (outline && outlineW > 0) {
    ctx.fillStyle = outline
    ctx.beginPath()
    ctx.arc(x, y, r + outlineW, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Draw one posed mannequin into the given cell. `subject` describes where the
 * character's height/center/baseline sit inside the cell so the pose map lines
 * up with the identity reference and the downstream baseline-alignment pass.
 */
export function drawMannequin(
  ctx: CanvasRenderingContext2D,
  frame: FramePose,
  opts: {
    cellX: number
    cellY: number
    subject: SubjectBounds
    colors?: MannequinColors
  }
) {
  const { cellX, cellY, subject } = opts
  const colors = opts.colors ?? DEFAULT_COLORS
  const H = subject.height

  // Limb thicknesses scale with the figure.
  const legW = H * 0.085
  const armW = H * 0.055
  const torsoW = H * 0.15
  const headR = H * P.headR

  // Hip pivot. We seat the figure so that a planted, near-straight leg reaches
  // the baseline; bodyY then bobs the whole figure up/down from there.
  const baseHipY =
    cellY + subject.baseline - LEG_LEN * H * 0.96 - frame.bodyY * H
  const hipX = cellX + subject.centerX
  const hipNearX = hipX + P.hipSepX * H * 0.5
  const hipFarX = hipX - P.hipSepX * H * 0.5

  // Torso + shoulders + head.
  const shoulder = projUp(hipX, baseHipY, P.torso * H, frame.lean)
  const headBase = projUp(
    shoulder.x,
    shoulder.y,
    (P.neck + P.headR) * H,
    frame.lean + (frame.headTilt ?? 0)
  )
  const shNearX = shoulder.x + P.shoulderSepX * H * 0.5
  const shFarX = shoulder.x - P.shoulderSepX * H * 0.5

  const ol = H * 0.012 // outline thickness scales with figure

  const drawLeg = (hx: number, limb: Limb2, w: number, color: string) => {
    const knee = projDown(hx, baseHipY, P.thigh * H, limb.base)
    const foot = projDown(knee.x, knee.y, P.shin * H, limb.base - limb.flex)
    capsule(ctx, hx, baseHipY, knee.x, knee.y, w, color, colors.outline, ol)
    capsule(ctx, knee.x, knee.y, foot.x, foot.y, w, color, colors.outline, ol)
    dot(ctx, knee.x, knee.y, w * 0.45, colors.joint)
  }

  const drawArm = (sx: number, sy: number, limb: Limb2, w: number, color: string) => {
    const elbow = projDown(sx, sy, P.upperArm * H, limb.base)
    const hand = projDown(elbow.x, elbow.y, P.foreArm * H, limb.base + limb.flex)
    capsule(ctx, sx, sy, elbow.x, elbow.y, w, color, colors.outline, ol)
    capsule(ctx, elbow.x, elbow.y, hand.x, hand.y, w, color, colors.outline, ol)
    dot(ctx, elbow.x, elbow.y, w * 0.45, colors.joint)
  }

  // Painter's order: far limbs (dark, behind), torso, near limbs (light, in
  // front), head on top. The outlines + the light/dark split keep the near
  // and far leg/arm visually separate even when they fully overlap.
  drawArm(shFarX, shoulder.y, frame.armB, armW, colors.far)
  drawLeg(hipFarX, frame.legB, legW, colors.far)

  capsule(
    ctx,
    hipX,
    baseHipY,
    shoulder.x,
    shoulder.y,
    torsoW,
    colors.torso,
    colors.outline,
    ol
  )
  dot(ctx, hipX, baseHipY, torsoW * 0.5, colors.torso)

  drawLeg(hipNearX, frame.legA, legW, colors.near)

  dot(ctx, headBase.x, headBase.y, headR, colors.torso, colors.outline, ol)
  // Small nose nub indicating facing direction (RIGHT).
  dot(ctx, headBase.x + headR * 0.85, headBase.y, headR * 0.28, colors.near)

  drawArm(shNearX, shoulder.y, frame.armA, armW, colors.near)
}

export interface PoseGuideOptions {
  anim: string
  cols: number
  rows: number
  cellSize: number
  frameCount: number
  subject: SubjectBounds
  colors?: MannequinColors
}

/**
 * Render the full pose-map sheet: a `cols`×`rows` grid where each cell shows
 * the mannequin in that frame's pose, on a flat key-color background. This is
 * the image fed to the model as the structural POSE reference.
 */
export function drawPoseGuideSheet(
  ctx: CanvasRenderingContext2D,
  opts: PoseGuideOptions
) {
  const { anim, cols, rows, cellSize, frameCount, subject } = opts
  const colors = opts.colors ?? DEFAULT_COLORS
  const frames = getPoseFrames(anim)

  ctx.fillStyle = colors.key
  ctx.fillRect(0, 0, cols * cellSize, rows * cellSize)

  for (let i = 0; i < frameCount; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    const frame = frames[i % frames.length]
    drawMannequin(ctx, frame, {
      cellX: c * cellSize,
      cellY: r * cellSize,
      subject,
      colors,
    })
  }
}
