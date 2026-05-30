'use client'

export type SpriteAnimType =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'attack'
  | 'hurt'
  | 'death'


export const SPRITE_FRAME_SIZE = 512

export const SPRITE_FRAME_COUNT = 8

export const SPRITE_GRID_COLS = 4

export const SPRITE_GRID_ROWS = 2

export const SPRITE_SHEET_W = SPRITE_GRID_COLS * SPRITE_FRAME_SIZE

export const SPRITE_SHEET_H = SPRITE_GRID_ROWS * SPRITE_FRAME_SIZE
/** Horizontal strip layout for engine export (1 row × N frames). */

export const SPRITE_STRIP_W = SPRITE_FRAME_COUNT * SPRITE_FRAME_SIZE

export const SPRITE_STRIP_H = SPRITE_FRAME_SIZE

export interface SpriteAnimSpec {
  type: SpriteAnimType
  label: string
  /** Default playback frames-per-second. Editable per-anim in the studio. */
  defaultFps: number
  /** Whether the animation should loop continuously in the live preview. */
  loop: boolean
  /** One-line description shown in the studio. */
  hint: string
  /** AI-prompt scaffold describing how the 8 keyframes should be staged. */
  keyframeChoreography: string
}


export const SPRITE_ANIMATIONS: Record<SpriteAnimType, SpriteAnimSpec> = {
  idle: {
    type: 'idle',
    label: 'Idle',
    defaultFps: 6,
    loop: true,
    hint: 'Subtle breathing loop · 8 frames @ 6 FPS',
    keyframeChoreography:
      'Subtle breathing / standing idle loop. Frames 1–4 = chest rising and shoulders slightly lifting; frames 5–8 = chest lowering and shoulders settling back. Feet planted, weight evenly distributed, very subtle weight shift. No big motion — the character should clearly look CALM and STATIONARY across all 8 frames. The pose in frame 1 and frame 8 should be near-identical so the loop reads as continuous.',
  },
  walk: {
    type: 'walk',
    label: 'Walk',
    defaultFps: 12,
    loop: true,
    hint: 'Classic 8-frame walk cycle @ 12 FPS',
    keyframeChoreography:
      'Side-view 8-frame walk cycle in profile, character facing RIGHT, moving in place. Frame 1: contact (right leg forward & straight, left leg back & lifting off). Frame 2: down (weight shifts onto right leg, body lowest). Frame 3: pass (left leg passes under body, body rising). Frame 4: high point (left leg forward, right leg back). Frame 5: contact mirror (left leg forward & straight, right leg back & lifting). Frame 6: down mirror (weight on left leg, body lowest). Frame 7: pass mirror (right leg passes under, body rising). Frame 8: high point mirror (right leg forward, left leg back). Arms swing OPPOSITE to legs (right arm forward when left leg forward). Cycle loops: frame 8 → frame 1 must feel continuous.',
  },
  run: {
    type: 'run',
    label: 'Run',
    defaultFps: 14,
    loop: true,
    hint: 'Energetic 8-frame run cycle @ 14 FPS',
    keyframeChoreography:
      'Side-view 8-frame run cycle in profile, character facing RIGHT, moving in place. More vigorous than a walk: both feet leave the ground at peak moments, body leans FORWARD throughout, arms bent at ~90° and swinging strongly. Frame 1: right foot strike (right leg forward, planted; left leg pulled up behind). Frame 2: push-off (right leg straightens & pushes back, body launches forward). Frame 3: airborne (both feet off ground, knees high). Frame 4: left foot reach (left leg extending forward to plant). Frames 5–8: mirror the pattern with the opposite leg. Arms pump OPPOSITE to legs. Loop must read continuous from frame 8 back to frame 1.',
  },
  jump: {
    type: 'jump',
    label: 'Jump',
    defaultFps: 10,
    loop: false,
    hint: 'Crouch → launch → peak → land · 8 frames @ 10 FPS',
    keyframeChoreography:
      'Side-view 8-frame jump action, character facing RIGHT. Frame 1: standing neutral. Frame 2: deep crouch wind-up (knees bent, arms back). Frame 3: explosive launch (legs straightening, arms swinging forward & up, feet just leaving ground). Frame 4: ascending (body straightening, knees tucking up). Frame 5: peak (highest point, body compact, knees up, arms up for balance). Frame 6: descending (legs extending downward, body anticipating landing). Frame 7: landing impact (knees bent on contact, arms forward for balance). Frame 8: recovery to neutral standing. NOT a loop — frame 8 settles back to the starting pose.',
  },
  attack: {
    type: 'attack',
    label: 'Attack',
    defaultFps: 12,
    loop: false,
    hint: 'Wind-up → strike → recover · 8 frames @ 12 FPS',
    keyframeChoreography:
      'Side-view 8-frame attack action, character facing RIGHT. Frame 1: neutral combat stance. Frame 2: anticipation (weapon/fist pulled back, body coiling). Frame 3: deep wind-up (peak coil, weight on back leg, weapon at maximum back position). Frame 4: forward burst (body uncoiling, weapon traveling forward fast, motion blur acceptable). Frame 5: impact / max extension (weapon at FURTHEST forward point, body in full lunge, front leg planted forward). Frame 6: follow-through (weapon swinging slightly past impact, body still committed). Frame 7: recovery start (weapon pulling back toward body, weight shifting back). Frame 8: return to neutral combat stance, matching frame 1. NOT a loop — the action plays once.',
  },
  hurt: {
    type: 'hurt',
    label: 'Hurt',
    defaultFps: 8,
    loop: false,
    hint: 'Take damage recoil · 8 frames @ 8 FPS',
    keyframeChoreography:
      'Side-view 8-frame hurt / take-damage reaction, character facing RIGHT. Frame 1: neutral stance. Frame 2: impact (body sharply jolted BACKWARD, head snaps back, arms flying outward, expression pained). Frame 3: peak recoil (body leaning farthest back, knees slightly buckled, off-balance). Frame 4: stagger 1 (body still leaning back but starting to recover, arms coming inward for balance). Frame 5: stagger 2 (body returning toward upright, head straightening). Frame 6: nearly recovered (slight remaining lean). Frame 7: settling (almost back to neutral, weight rebalancing). Frame 8: recovered neutral stance, matching frame 1. NOT a loop — the action plays once.',
  },
  death: {
    type: 'death',
    label: 'Death',
    defaultFps: 10,
    loop: false,
    hint: 'Collapse to ground · 8 frames @ 10 FPS',
    keyframeChoreography:
      'Side-view 8-frame death / collapse animation, character facing RIGHT. Frame 1: standing, body taking a final hit, slight shock pose. Frame 2: knees buckling, body sagging downward. Frame 3: dropping to one knee, body folding forward. Frame 4: both knees on ground, torso slumping. Frame 5: falling sideways, torso tilting toward the ground. Frame 6: nearly horizontal, one arm reaching out to break the fall. Frame 7: on the ground, body settling, last twitches. Frame 8: lying motionless on the ground, fully collapsed, character defeated. NOT a loop — the final frame is the resting "dead" pose.',
  },
}

/** Visual / pick order in the studio toolbar. */

export const SPRITE_ANIM_ORDER: SpriteAnimType[] = [
  'idle',
  'walk',
  'run',
  'jump',
  'attack',
  'hurt',
  'death',
]


export interface SpriteFrame {
  /** 0-indexed frame position in the sheet (row-major). */
  index: number
  /** Post-chromakey (alpha-keyed) PNG data URL for a single frame cell. */
  imageUrl: string | null
  /** When true, the frame is excluded from playback AND from every export
   * (grid, strip, per-frame ZIP, manifest). Toggled by clicking the cell. */
  disabled?: boolean
}


export interface SpriteSheet {
  /** Animation type these frames represent. */
  anim: SpriteAnimType
  /** Individual chroma-keyed frame cells, length === SPRITE_FRAME_COUNT. */
  frames: SpriteFrame[]
  /** Stitched grid sheet PNG (chroma-keyed). Cached for export. */
  gridSheetUrl: string | null
  /** Pre-keying raw output from the AI (with magenta still in place). Kept
   * mostly for debug-mode export so users can inspect the original. */
  rawGridSheetUrl: string | null
  /** Prompt that produced this sheet — surfaced in the manifest for reproducibility. */
  prompt: string
  /** Frames-per-second the sheet should play back at. */
  fps: number
}


export function createEmptySpriteSheet(anim: SpriteAnimType): SpriteSheet {
  return {
    anim,
    frames: Array.from({ length: SPRITE_FRAME_COUNT }, (_, i) => ({
      index: i,
      imageUrl: null,
    })),
    gridSheetUrl: null,
    rawGridSheetUrl: null,
    prompt: '',
    fps: SPRITE_ANIMATIONS[anim].defaultFps,
  }
}

/**
 * Starter prompts for Sprite mode. Each is a one-click character archetype
 * description — purposefully terse so it composes well with the per-frame
 * animation choreography injected by the API route.
 */

export interface SpritePreset {
  id: string
  label: string
  prompt: string
}


export const SPRITE_CHARACTER_PRESETS: SpritePreset[] = [
  {
    id: 'pixel-knight',
    label: 'Pixel knight',
    prompt:
      'Pixel-art knight in plate armor with a silver helmet, blue tabard, sword in right hand, small round shield in left hand. Crisp 16-bit retro pixel art, limited palette, clean outlines.',
  },
  {
    id: 'ninja',
    label: 'Shadow ninja',
    prompt:
      'Side-view ninja in a dark indigo gi with a black mask covering the lower face, white headband, lean athletic build, katana sheathed at the hip. Crisp anime-game pixel art.',
  },
  {
    id: 'wizard',
    label: 'Robed wizard',
    prompt:
      'Robed wizard in flowing deep-purple robes with golden trim, long white beard, pointed star-studded hat, wooden staff topped with a glowing blue crystal in the right hand.',
  },
  {
    id: 'archer',
    label: 'Forest archer',
    prompt:
      'Light forest archer in green leather armor with a hood, brown boots, leather quiver on the back full of arrows, recurve bow in the left hand. Agile build, side-view.',
  },
  {
    id: 'rogue',
    label: 'Hooded rogue',
    prompt:
      'Lean rogue in a dark hooded cloak, leather chest piece, twin daggers (one in each hand), face mostly shadowed under the hood. Stealthy posture.',
  },
  {
    id: 'mech-robot',
    label: 'Mech robot',
    prompt:
      'Chrome mech battle-robot, humanoid proportions, glowing cyan eye visor, articulated joint plates, antenna on the head, no weapon (unarmed combat). Sci-fi clean look.',
  },
  {
    id: 'slime',
    label: 'Slime humanoid',
    prompt:
      'Upright humanoid slime creature with a clear head, torso, two arms and two legs, translucent green jelly body, two big white eyes with small black pupils, small mouth. Bipedal stance, cute RPG enemy style.',
  },
  {
    id: 'dragon',
    label: 'Dragonkin warrior',
    prompt:
      'Bipedal dragonkin warrior, upright humanoid body with two arms and two legs, red scaled skin, horned reptilian head, small leathery wings folded on the back, clawed hands and feet, golden chest plate. Side-view fantasy fighter.',
  },
  {
    id: 'skeleton',
    label: 'Skeleton warrior',
    prompt:
      'Skeleton warrior, exposed bone body, tattered grey loincloth, rusty curved scimitar in the right hand, small wooden shield in the left hand, glowing red eye sockets.',
  },
  {
    id: 'villager',
    label: 'Villager NPC',
    prompt:
      'Friendly villager peasant, simple linen tunic in muted earth tones, brown trousers, leather belt, no weapon, slight smile. Side-view, NPC character art.',
  },

  // ── Enemies ───────────────────────────────────────────────────────────────
  {
    id: 'goblin',
    label: 'Goblin grunt',
    prompt:
      'Small hunched goblin, green warty skin, big pointed ears, yellow eyes, ragged brown loincloth, crude jagged dagger in the right hand. Mischievous low-level RPG enemy.',
  },
  {
    id: 'orc-brute',
    label: 'Orc brute',
    prompt:
      'Hulking orc brute, muscular grey-green skin, lower tusks, leather-and-fur armor straps, heavy two-handed cleaver axe, bald scarred head. Heavy aggressive build.',
  },
  {
    id: 'bat',
    label: 'Batfolk',
    prompt:
      'Upright bipedal batfolk humanoid, two legs and two arms with membranous wing-flaps along the arms, dark purple fur, large pointed ears, glowing red eyes, tiny fangs. Lean agile build, side-view enemy.',
  },
  {
    id: 'mushroom',
    label: 'Mushroom folk',
    prompt:
      'Humanoid mushroom-folk, round red cap with white spots as the head, pale stalk-like humanoid body with two arms and two legs, two beady eyes and a grumpy frown. Bipedal forest enemy style.',
  },
  {
    id: 'zombie',
    label: 'Rotting zombie',
    prompt:
      'Shambling undead zombie, pale green decaying skin, torn bloodstained shirt and trousers, one arm hanging loose, sunken white eyes, slouched posture. Side-view horror enemy.',
  },
  {
    id: 'imp',
    label: 'Fire imp',
    prompt:
      'Small mischievous fire imp, crimson-red skin, tiny horns, bat-like wings, pointed tail, glowing ember eyes, small claws, flickering flames on the shoulders. Agile demon minion.',
  },

  // ── Bosses ────────────────────────────────────────────────────────────────
  {
    id: 'demon-lord',
    label: 'Demon lord (boss)',
    prompt:
      'Towering demon lord boss, dark crimson muscular body, massive curved horns, large tattered black wings, glowing molten cracks across the skin, huge flaming greatsword. Imposing, menacing silhouette.',
  },
  {
    id: 'stone-golem',
    label: 'Stone golem (boss)',
    prompt:
      'Massive stone golem boss, body built from cracked grey boulders, glowing blue energy core in the chest, enormous heavy fists, mossy weathered surface, slow and powerful. Bulky towering build.',
  },
  {
    id: 'lich',
    label: 'Lich king (boss)',
    prompt:
      'Undead lich king boss, skeletal frame in a tattered royal purple robe, glowing green eye sockets, ornate golden crown, levitating bone staff topped with a green soul orb. Dark sorcerer aura.',
  },
  {
    id: 'dragon-boss',
    label: 'Dragon lord (boss)',
    prompt:
      'Towering bipedal dragon lord boss, upright humanoid body with two muscular arms and two legs, obsidian-black scales with red accents, horned draconic head, huge leathery wings spread from the back, glowing orange throat, massive clawed hands. Epic imposing stance.',
  },
  {
    id: 'spider-queen',
    label: 'Spider queen (boss)',
    prompt:
      'Spider queen boss as an upright humanoid (drider-style upper body): two arms and two legs in a bipedal stance, pale humanoid torso, cluster of glowing red eyes, sharp dripping fangs, dark chitin armor plates and bone-spike markings. Menacing arachnid-themed boss.',
  },
  {
    id: 'dark-knight',
    label: 'Dark knight (boss)',
    prompt:
      'Heavy dark knight boss in jagged blackened full plate armor, glowing red slit visor, tattered crimson cape, enormous two-handed greatsword wreathed in dark energy. Towering intimidating stance.',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Small presentational components
// ─────────────────────────────────────────────────────────────────────────────

