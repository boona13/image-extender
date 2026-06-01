'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CommandBar } from '@/app/components/CommandBar'
import { EmptyState } from '@/app/components/EmptyState'
import { ApiKeyModal, ErrorToast, GenerateModal, SettingsDrawer, Toggle } from '@/app/components/Modals'
import { ParallaxStudio } from '@/app/components/ParallaxStudio'
import { PropStudio } from '@/app/components/PropStudio'
import { SpriteStudio } from '@/app/components/SpriteStudio'
import { TileStudio } from '@/app/components/TileStudio'
import { TopBar } from '@/app/components/TopBar'
import { ResultActions, VariantSelector } from '@/app/components/VariantSelector'
import { Workspace } from '@/app/components/Workspace'
import { Candidate, Direction, EXTENSION_PERCENT, Mode, STORAGE_KEY, STORAGE_MODE, STORAGE_MODEL } from '@/app/lib/app'
import { findStyleLabel } from '@/app/lib/artStyles'
import { DEFAULT_MODEL, MODELS, getModelConfig, skipsArtDirectorReview } from '@/app/lib/models'
import { PROVIDER_STORAGE_KEY, ProviderSettings, createDefaultProviderSettings, normalizeProviderSettings } from '@/app/lib/providers/types'
import { LAYER_ORDER, LAYER_ROLES, LayerRole, PARALLAX_MAX_AUTO_STEPS, ParallaxLayer, WORKFLOW_ORDER, createDefaultLayers, getRecommendedLayerIndex, getWorkflowPrerequisite } from '@/app/lib/parallax'
import { PROP_BATCH, PROP_BATCH_COLS, PROP_BATCH_H, PROP_BATCH_ROWS, PROP_BATCH_W, PROP_TILE_SIZE, PropItem, nextPropId, propAtlasLayout, resolvePropNames } from '@/app/lib/props'
import { SPRITE_ANIMATIONS, SPRITE_FRAME_COUNT, SPRITE_FRAME_SIZE, SPRITE_GRID_COLS, SPRITE_GRID_ROWS, SPRITE_SHEET_H, SPRITE_SHEET_W, SPRITE_STRIP_H, SPRITE_STRIP_W, SpriteAnimType, SpriteFrame, SpriteSheet, createEmptySpriteSheet } from '@/app/lib/sprite'
import { BODY_PLANS, BodyPlan, isAirborneAnim } from '@/app/lib/bodyPlans'
import { CORNER_GRAFTS, ENABLE_CORNER_RECONCILE, TILESET_ATLAS_EXTRUDE_PX, TILESET_BY_ROLE, TILESET_COLS, TILESET_PADDED_SHEET_H, TILESET_PADDED_SHEET_W, TILESET_PADDED_STRIDE, TILESET_ROWS, TILESET_SHEET_H, TILESET_SHEET_W, TILESET_SLOTS, TILESET_TILE_SIZE, TILE_TEMPLATE_CELL, TILE_TEMPLATE_COLS, TILE_TEMPLATE_H, TILE_TEMPLATE_MASK, TILE_TEMPLATE_ROWS, TILE_TEMPLATE_SAMPLES, TILE_TEMPLATE_W, TileSetRole, TileSetSlot, alignAiOutputToTemplate, applyFeatheredRoleMask, buildTileSheetGuideDataUrl, createEmptyTileSet, rebuildCornerTile, reconcileAllCorners, templateRoleForCell } from '@/app/lib/tileset'
import { alignSpriteFramesToBaseline, applyFullContextResult, centerSpriteFramesHorizontally, chromaKeyToAlpha, createChunkedExtension, createFullContextExtension, getImageDimensions, harmonizeHorizontalSeams, isolatePrimarySpriteComponent, isAiExtensionUnfilled, makeHorizontallyTileable, makeTileable2D, makeVerticallyTileable, measureSeamResidual, normalizeSpriteFrameScale, removeFrameBorder, removeUploadedBackground, sliceImageGrid, stitchExtendedChunk } from '@/app/utils/imageProcessor'
import { SubjectBounds, drawPoseGuideSheet, measureSubjectBounds } from '@/app/utils/poseRig'
import JSZip from 'jszip'

export default function Home() {
  // Image state
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [originalFileName, setOriginalFileName] = useState('extended')
  /**
   * Candidates returned by the most recent extension. Sorted by seam quality
   * (best first). Length is 0 when there's no active result, 1+ otherwise.
   */
  const [extendedCandidates, setExtendedCandidates] = useState<Candidate[]>([])
  /** Which candidate the user is currently previewing. */
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState(0)
  /**
   * Dimensions per candidate. Indexed alongside `extendedCandidates`; written
   * lazily as each image loads (they're all the same size in practice but
   * computed individually so we never display stale dims during cycling).
   */
  const [candidateDims, setCandidateDims] = useState<Array<{ width: number; height: number } | null>>([])
  const [currentImageDimensions, setCurrentImageDimensions] = useState<{
    width: number
    height: number
  } | null>(null)
  const [imageBeforeExtension, setImageBeforeExtension] = useState<string | null>(null)
  const [lastExtensionParams, setLastExtensionParams] = useState<{
    direction: Direction
    customPrompt: string
    artStyle: string
    /** Parallax layer this extension was made on (sky/far/mid/near). Carried
     * so regenerate replays the same role. */
    layerRole?: LayerRole
  } | null>(null)

  // Operation state
  const [loading, setLoading] = useState(false)
  const [activeDirection, setActiveDirection] = useState<Direction | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Live progress message shown in the loading pill (e.g. "Attempt 1/3 · 24s"). */
  const [progressMsg, setProgressMsg] = useState<string | null>(null)

  // Form state
  const [customPrompt, setCustomPrompt] = useState('')
  const [artStyle, setArtStyle] = useState('none')
  const [debugMode, setDebugMode] = useState(false)

  // Mode: which top-level tool the user is in. Persisted to localStorage so a
  // game designer doesn't have to re-pick parallax every visit.
  const [mode, setModeState] = useState<Mode>('extender')

  // Parallax-specific state. Target width is the "auto-extend until we hit
  // this width" goal; autoExtending tracks the loop; the stop ref lets the
  // user interrupt mid-loop without React re-render races. The layers array
  // holds the per-depth-band images that compose into a real parallax scene.
  const [parallaxTargetWidth, setParallaxTargetWidth] = useState<number | null>(null)
  const [parallaxAutoExtending, setParallaxAutoExtending] = useState(false)
  const parallaxAutoStopRef = useRef(false)
  const [parallaxLayers, setParallaxLayers] = useState<ParallaxLayer[]>(() =>
    createDefaultLayers()
  )
  const [parallaxActiveIdx, setParallaxActiveIdx] = useState(() =>
    LAYER_ORDER.indexOf(WORKFLOW_ORDER[0])
  )
  /** Shared art direction for all parallax layers — auto-derived from the
   * first Near layer generation prompt, editable before Mid / Far / Sky.
   * Also reused by Tile mode so generated material textures match the
   * existing project palette/lighting/style. */
  const [sceneBrief, setSceneBrief] = useState('')
  const [sceneBriefLoading, setSceneBriefLoading] = useState(false)

  // Tile-set state. A 13-slot autotile set for 2D platformer tile-maps:
  // body + 4 edges + 4 outer corners + 4 inner corners. Each non-body tile
  // is generated against magenta and chroma-keyed to alpha so the user can
  // drop tiles over any background. Generated text-only with role-specific
  // magenta-layout instructions; consistency comes from a shared prompt +
  // sceneBrief across calls.
  const [tileSet, setTileSet] = useState<TileSetSlot[]>(() => createEmptyTileSet())
  const [tilePrompt, setTilePrompt] = useState('')
  const [tileSetGenerating, setTileSetGenerating] = useState(false)
  const [tileProgressMsg, setTileProgressMsg] = useState<string | null>(null)
  const tileStopRef = useRef(false)

  // Props / decoration state — a sheet of standalone transparent decoration
  // sprites scattered on top of a tile map. Generated in one AI call (like the
  // tile set) so the whole set shares a palette; sliced + chroma-keyed client
  // side. Each prop can be re-rolled individually via a separate call.
  const [propItems, setPropItems] = useState<PropItem[]>([])
  const [propPrompt, setPropPrompt] = useState('')
  const [propSetGenerating, setPropSetGenerating] = useState(false)
  const [propProgressMsg, setPropProgressMsg] = useState<string | null>(null)
  const propStopRef = useRef(false)

  // Sprite-animation state. One sheet at a time (the active animation type).
  // Switching animation chips creates a fresh empty sheet so each animation
  // is independent; the previous sheet is replaced rather than archived.
  //
  // Frame consistency: we use a two-pass anchor → sheet workflow. Pass 1
  // generates a single neutral standing reference of the character ("the
  // anchor"); Pass 2 generates the 8-frame sheet and passes the anchor as
  // a visual reference, which 2026's AI-sprite community identified as the
  // strongest known technique for keeping the character on-model across
  // cells (chongdashu/ai-game-spritesheets, Robotic Ape, Auto-Sprite, etc.).
  // The anchor PERSISTS across animation switches so the same character can
  // be re-used for idle/walk/run/jump/attack/hurt/death without re-rolling
  // identity.
  // Which body plan we're animating (humanoid / quadruped / serpent / flyer /
  // blob). The plan selects the deterministic pose rig, the available
  // animations, and the choreography/QA the API uses.
  const [spriteBodyPlan, setSpriteBodyPlan] = useState<BodyPlan>('biped')
  const [spriteAnim, setSpriteAnim] = useState<SpriteAnimType>('idle')
  const [spriteSheet, setSpriteSheet] = useState<SpriteSheet>(() =>
    createEmptySpriteSheet('idle')
  )
  // Per-(plan, anim) cache so switching tabs/plans doesn't discard generated
  // sheets. Keyed by `${bodyPlan}:${anim}`; the latest sheet for each is kept
  // here so the user can flip between animations and still see prior results.
  // Cleared when the character identity (anchor) or body plan changes, since
  // cached sheets belong to the previous character/plan.
  const spriteSheetCacheRef = useRef<Record<string, SpriteSheet>>({})
  const spriteCacheKey = (plan: BodyPlan, anim: SpriteAnimType) =>
    `${plan}:${anim}`
  // Set of animation types (for the CURRENT plan) that have a generated
  // (cached) sheet, used to mark those tabs with a dot.
  const [spriteGeneratedAnims, setSpriteGeneratedAnims] = useState<
    Set<SpriteAnimType>
  >(new Set())
  useEffect(() => {
    spriteSheetCacheRef.current[spriteCacheKey(spriteBodyPlan, spriteSheet.anim)] =
      spriteSheet
    const prefix = `${spriteBodyPlan}:`
    const next = new Set<SpriteAnimType>()
    for (const [key, sheet] of Object.entries(spriteSheetCacheRef.current)) {
      if (key.startsWith(prefix) && sheet && sheet.frames.some((f) => !!f.imageUrl)) {
        next.add(key.slice(prefix.length) as SpriteAnimType)
      }
    }
    setSpriteGeneratedAnims(next)
  }, [spriteSheet, spriteBodyPlan])
  const [spriteAnchor, setSpriteAnchor] = useState<{
    /** Chroma-keyed thumbnail (transparent background) for display. */
    imageUrl: string
    /** Raw magenta-background version — fed to the AI as a reference image
     * on every sheet pass. The model sees magenta naturally, transparent
     * regions less so, so we keep the un-keyed version for inference. */
    rawImageUrl: string
    /** Prompt that produced this anchor. */
    prompt: string
    /** True when the anchor came from a user-uploaded image rather than the
     * anchor generation pass. Uploaded anchors are never auto-regenerated
     * from the prompt. */
    uploaded?: boolean
  } | null>(null)
  const [spritePrompt, setSpritePrompt] = useState('')
  const [spriteFps, setSpriteFps] = useState<number>(
    SPRITE_ANIMATIONS.idle.defaultFps
  )
  const [spriteGenerating, setSpriteGenerating] = useState(false)
  const [spriteProgressMsg, setSpriteProgressMsg] = useState<string | null>(null)
  const spriteStopRef = useRef(false)

  // Modal/drawer state
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [generatePrompt, setGeneratePrompt] = useState('')
  const [generateWidth, setGenerateWidth] = useState(1024)
  const [generateHeight, setGenerateHeight] = useState(1024)
  const [generating, setGenerating] = useState(false)

  // BYOK: API key + model are persisted to localStorage. We start in a
  // "hydrating" state so we don't flash the modal before reading storage.
  const [apiKey, setApiKey] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL)
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() =>
    createDefaultProviderSettings(DEFAULT_MODEL)
  )
  const skipArtDirectorReview = skipsArtDirectorReview(providerSettings.image.model || selectedModel)
  const [hydrated, setHydrated] = useState(false)
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  // Required-mode means the user can't dismiss the modal (first run, no key
  // anywhere). Optional-mode is used when editing an existing key from settings.
  const [apiKeyRequired, setApiKeyRequired] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Hydrate from localStorage on mount, and decide whether to show the modal.
  useEffect(() => {
    try {
      const k = localStorage.getItem(STORAGE_KEY) || ''
      const m = localStorage.getItem(STORAGE_MODEL) || ''
      const savedMode = localStorage.getItem(STORAGE_MODE) || ''
      const rawProviders = localStorage.getItem(PROVIDER_STORAGE_KEY)
      const parsedProviders = rawProviders ? JSON.parse(rawProviders) : null
      const normalizedProviders = normalizeProviderSettings(parsedProviders, DEFAULT_MODEL)
      setApiKey(k)
      setProviderSettings(normalizedProviders)
      if (m && MODELS.some((mm) => mm.value === m)) {
        setSelectedModel(m)
      }
      if (
        savedMode === 'parallax' ||
        savedMode === 'extender' ||
        savedMode === 'tile' ||
        savedMode === 'sprite' ||
        savedMode === 'props'
      ) {
        setModeState(savedMode)
      }
      // 若默认 key 和三类 provider 专属 key 都为空，则首次打开时提示用户；
      // 仍然允许用户选择“Use server env”来使用服务端环境变量。
      const hasProviderKey = Object.values(normalizedProviders).some((provider) => provider.apiKey.trim())
      if (!k && !hasProviderKey) {
        setApiKeyRequired(true)
        setShowApiKeyModal(true)
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — show modal anyway.
      setApiKeyRequired(true)
      setShowApiKeyModal(true)
    } finally {
      setHydrated(true)
    }
  }, [])

  /** Persist mode + reset parallax-specific transient state on change. */
  const setMode = useCallback((next: Mode) => {
    setModeState(next)
    try {
      localStorage.setItem(STORAGE_MODE, next)
    } catch {}
  }, [])

  // Persist key + model changes.
  useEffect(() => {
    if (!hydrated) return
    try {
      if (apiKey) localStorage.setItem(STORAGE_KEY, apiKey)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {}
  }, [apiKey, hydrated])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_MODEL, selectedModel)
    } catch {}
  }, [selectedModel, hydrated])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(providerSettings))
    } catch {}
  }, [providerSettings, hydrated])

  const handleSaveApiKey = (key: string) => {
    setApiKey(key)
    setShowApiKeyModal(false)
    setApiKeyRequired(false)
  }

  const handleSkipApiKey = () => {
    // User has env-set key on server; let them proceed without a client key.
    setShowApiKeyModal(false)
    setApiKeyRequired(false)
  }

  const handleClearApiKey = () => {
    setApiKey('')
  }

  const handleEditApiKey = () => {
    setApiKeyRequired(false)
    setShowApiKeyModal(true)
  }

  const ensureCanGenerate = (): boolean => {
    // If no key and we're in required mode, re-open the modal instead of
    // making a request that would fail with 401.
    if (!apiKey && apiKeyRequired) {
      setShowApiKeyModal(true)
      return false
    }
    return true
  }

  /** 所有 AI API 请求都带上统一 provider 配置；旧 apiKey/model 字段保留为回退。 */
  const aiRequestConfig = () => ({
    apiKey: apiKey || undefined,
    model: selectedModel,
    providerSettings,
  })

  // ── Parallax layer helpers ─────────────────────────────────────────────────

  /** Convenience accessor for the currently-edited parallax layer. */
  const activeLayer: ParallaxLayer | null =
    mode === 'parallax' ? parallaxLayers[parallaxActiveIdx] ?? null : null

  /**
   * Update a single field on the currently-active layer. Used by the layer
   * panel sliders and by image-loading paths that need to write back the
   * generated/extended image plus its dimensions.
   */
  const patchActiveLayer = useCallback(
    (patch: Partial<ParallaxLayer>) => {
      setParallaxLayers((prev) =>
        prev.map((l, i) => (i === parallaxActiveIdx ? { ...l, ...patch } : l))
      )
    },
    [parallaxActiveIdx]
  )

  const setLayerScrollSpeed = useCallback((idx: number, speed: number) => {
    setParallaxLayers((prev) =>
      prev.map((l, i) =>
        i === idx ? { ...l, scrollSpeed: Math.max(0, speed) } : l
      )
    )
  }, [])

  const clearLayer = useCallback((idx: number) => {
    setParallaxLayers((prev) =>
      prev.map((l, i) =>
        i === idx
          ? {
              ...l,
              imageUrl: null,
              rawImageUrl: null,
              width: null,
              height: null,
              fromUpload: false,
            }
          : l
      )
    )
  }, [])

  /**
   * Apply a freshly-loaded image (from upload or generation) to the active
   * layer. Sky layers are stored as-is; non-sky layers are chroma-keyed for
   * display while the raw is preserved for future extension. Uploads are
   * trusted to already have correct alpha and bypass the keying pass.
   */
  const applyImageToActiveLayer = useCallback(
    async (imageUrl: string, options: { fromUpload: boolean }) => {
      const layer = parallaxLayers[parallaxActiveIdx]
      if (!layer) return
      const isKeyed = !LAYER_ROLES[layer.role].isOpaque
      const dims = await getImageDimensions(imageUrl)
      let displayImage = imageUrl
      let rawImage: string | null = imageUrl
      if (isKeyed && !options.fromUpload) {
        // Keyed layers from generation/extension: apply chroma key for
        // display, keep the raw for re-feeding into the extend pipeline.
        displayImage = await chromaKeyToAlpha(imageUrl)
        rawImage = imageUrl
      } else if (isKeyed && options.fromUpload) {
        // User-supplied alpha — trust it. raw == display.
        rawImage = imageUrl
      }
      patchActiveLayer({
        imageUrl: displayImage,
        rawImageUrl: rawImage,
        width: dims.width,
        height: dims.height,
        fromUpload: options.fromUpload,
      })
      // Nudge workflow: after filling a layer, jump to the next empty one
      // in front→back order so users naturally build Near → Mid → Far → Sky.
      const updatedLayers = parallaxLayers.map((l, i) =>
        i === parallaxActiveIdx
          ? {
              ...l,
              imageUrl: displayImage,
              rawImageUrl: rawImage,
              width: dims.width,
              height: dims.height,
              fromUpload: options.fromUpload,
            }
          : l
      )
      const nextIdx = getRecommendedLayerIndex(updatedLayers)
      if (nextIdx !== null && nextIdx !== parallaxActiveIdx) {
        setParallaxActiveIdx(nextIdx)
      }
    },
    [parallaxLayers, parallaxActiveIdx, patchActiveLayer]
  )

  // Mirror the active parallax layer's dimensions into the legacy
  // currentImageDimensions state used by the extend pipeline guard. We have
  // to depend on the dims directly (not just `parallaxActiveIdx`) so the
  // sync re-fires when generation/extension fills in dims for a previously-
  // empty layer — otherwise the guard would still see a null and throw
  // "Image dimensions not available yet."
  const activeLayerWidth =
    mode === 'parallax' ? parallaxLayers[parallaxActiveIdx]?.width ?? null : null
  const activeLayerHeight =
    mode === 'parallax' ? parallaxLayers[parallaxActiveIdx]?.height ?? null : null
  useEffect(() => {
    if (mode !== 'parallax') return
    if (activeLayerWidth && activeLayerHeight) {
      setCurrentImageDimensions({
        width: activeLayerWidth,
        height: activeLayerHeight,
      })
    } else {
      setCurrentImageDimensions(null)
    }
  }, [mode, activeLayerWidth, activeLayerHeight])

  // Switching to a different layer should wipe in-flight review state —
  // otherwise a stale candidate from layer N would render over layer M's
  // canvas. This is intentionally separate from the dim-sync effect above so
  // it only fires on actual layer switches, not on every layer mutation.
  useEffect(() => {
    if (mode !== 'parallax') return
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)
    setImageBeforeExtension(null)
    setLastExtensionParams(null)
    setActiveDirection(null)
  }, [mode, parallaxActiveIdx])

  // ── Image loaders ──────────────────────────────────────────────────────────

  const loadDataUrlAsImage = useCallback(
    (dataUrl: string, filename = 'image.png') => {
      setSelectedImage(dataUrl)
      setExtendedCandidates([])
      setCandidateDims([])
      setSelectedCandidateIdx(0)
      setError(null)
      setOriginalFileName(filename)
      const img = new Image()
      img.onload = () => {
        setCurrentImageDimensions({ width: img.width, height: img.height })
      }
      img.src = dataUrl
    },
    []
  )

  /**
   * Adopts a fresh set of candidates: stores them, resets selection to the
   * top (best-blend) variant, and kicks off async dimension reads for each so
   * the meta row stays accurate as the user cycles.
   */
  const adoptCandidates = useCallback((candidates: Candidate[]) => {
    setExtendedCandidates(candidates)
    setSelectedCandidateIdx(0)
    setCandidateDims(new Array(candidates.length).fill(null))
    candidates.forEach((c, idx) => {
      const img = new Image()
      img.onload = () => {
        setCandidateDims((prev) => {
          const next = prev.slice()
          next[idx] = { width: img.width, height: img.height }
          return next
        })
      }
      img.src = c.imageUrl
    })
  }, [])

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string
        if (mode === 'parallax') {
          // Parallax uploads target the active layer, not the global image.
          // We trust user-supplied alpha (PNG with transparency works as-is).
          try {
            await applyImageToActiveLayer(dataUrl, { fromUpload: true })
            setOriginalFileName(file.name)
            setError(null)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load image')
          }
        } else if (mode === 'tile') {
          // Tile-set mode is generate-only — uploads aren't supported because
          // each tile has a strict role + magenta layout that an arbitrary
          // upload can't match. Surface a clear hint instead of silently
          // ignoring the dropped file.
          setError(
            'Tile-set mode generates from prompts only. Switch to Extender mode to outpaint an uploaded image.'
          )
        } else if (mode === 'sprite') {
          // Sprite mode is also generate-only — animation sheets need
          // strict 4×2 keyframe staging on a magenta key that an arbitrary
          // upload can't match.
          setError(
            'Sprite mode generates from prompts only. Switch to Extender mode to outpaint an uploaded image.'
          )
        } else {
          loadDataUrlAsImage(dataUrl, file.name)
        }
      }
      reader.readAsDataURL(file)
    },
    [mode, applyImageToActiveLayer, loadDataUrlAsImage]
  )

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  // ── Generate from scratch ──────────────────────────────────────────────────

  const deriveSceneBrief = useCallback(
    async (anchorPrompt: string) => {
      if (!anchorPrompt.trim()) return
      setSceneBriefLoading(true)
      try {
        const response = await fetch('/api/scene-brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            anchorPrompt: anchorPrompt.trim(),
            artStyle: artStyle !== 'none' ? artStyle : undefined,
            ...aiRequestConfig(),
          }),
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'Failed to derive scene direction')
        }
        if (typeof data.sceneBrief === 'string' && data.sceneBrief.trim()) {
          setSceneBrief(data.sceneBrief.trim())
        }
      } catch (err) {
        // Non-fatal — user can type the brief manually.
        console.warn('Scene brief derivation failed:', err)
      } finally {
        setSceneBriefLoading(false)
      }
    },
    [apiKey, artStyle, selectedModel, providerSettings]
  )

  const handleGenerateImage = async () => {
    if (!generatePrompt.trim()) {
      setError('Please describe the image you want to generate.')
      return
    }
    if (!ensureCanGenerate()) return
    setGenerating(true)
    setError(null)
    try {
      const layerRole =
        mode === 'parallax' ? activeLayer?.role : undefined
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: generatePrompt,
          width: generateWidth,
          height: generateHeight,
          artStyle: artStyle !== 'none' ? artStyle : undefined,
          ...aiRequestConfig(),
          layerRole,
          sceneBrief:
            mode === 'parallax' &&
            layerRole &&
            layerRole !== WORKFLOW_ORDER[0] &&
            sceneBrief.trim()
              ? sceneBrief.trim()
              : undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 401) {
          setApiKeyRequired(true)
          setShowApiKeyModal(true)
        }
        throw new Error(data.error || 'Failed to generate image')
      }
      if (!data.imageUrl) throw new Error('No image returned from API')
      const anchorPromptUsed = generatePrompt.trim()
      if (mode === 'parallax') {
        // Route into the active layer (with chroma-keying for non-sky roles).
        await applyImageToActiveLayer(data.imageUrl, { fromUpload: false })
        setOriginalFileName(`parallax_${activeLayer?.role ?? 'layer'}.png`)
        if (layerRole === WORKFLOW_ORDER[0] && anchorPromptUsed) {
          void deriveSceneBrief(anchorPromptUsed)
        }
      } else {
        loadDataUrlAsImage(data.imageUrl, 'generated.png')
      }
      setShowGenerateModal(false)
      setGeneratePrompt('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate image')
    } finally {
      setGenerating(false)
    }
  }

  // ── Extend ─────────────────────────────────────────────────────────────────

  const runExtend = useCallback(
    async (
      direction: Direction,
      sourceImage: string,
      promptText: string,
      style: string,
      /**
       * Parallax layer role hint. When provided and non-sky, the API call
       * passes the role so the model keeps the magenta key intact, and we
       * apply chroma-keying to the blended result before storing it as the
       * displayable candidate image. The pre-keying source is preserved on
       * the candidate so the next extend can feed magenta back to the model.
       */
      layerRole?: LayerRole
    ) => {
      if (!currentImageDimensions) {
        throw new Error('Image dimensions not available yet.')
      }

      const isKeyedLayer = !!layerRole && layerRole !== 'sky'

      const callExtendApi = async (
        expandedCanvas: string,
        body: Record<string, unknown>
      ) => {
        const response = await fetch('/api/extend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expandedCanvas,
            direction,
            extensionAmount: EXTENSION_PERCENT,
            customPrompt: promptText.trim() || undefined,
            artStyle: style !== 'none' ? style : undefined,
            ...aiRequestConfig(),
            layerRole,
            sceneBrief:
              mode === 'parallax' && sceneBrief.trim()
                ? sceneBrief.trim()
                : undefined,
            ...body,
          }),
        })
        const data = await response.json()
        if (!response.ok) {
          const err = new Error(data.error || 'Failed to extend image') as Error & { status?: number }
          err.status = response.status
          throw err
        }
        return data.imageUrl as string
      }

      /** Convert a raw blended image into a displayable candidate, applying
       * chroma-key alpha for keyed parallax layers. */
      const finalizeCandidate = async (
        blended: string,
        score: number,
        attempt: number
      ): Promise<Candidate> => {
        if (isKeyedLayer) {
          const keyed = await chromaKeyToAlpha(blended)
          return { imageUrl: keyed, rawImageUrl: blended, score, attempt }
        }
        return { imageUrl: blended, score, attempt }
      }

      const isHorizontal = direction === 'left' || direction === 'right'
      const modelCfg = getModelConfig(providerSettings.image.model || selectedModel)

      if (isHorizontal) {
        const maxAttempts = Math.max(1, modelCfg.maxAttempts)
        // Collect every candidate so the user can cycle through them and pick.
        // We no longer early-break on a "good enough" score — the user said
        // they want to see all 3 and decide themselves.
        const candidates: Candidate[] = []

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const attemptStart = Date.now()
          // Tick a live elapsed-seconds counter inside the AI call so the UI
          // doesn't feel frozen during long requests.
          const tickHandle = setInterval(() => {
            const elapsed = Math.floor((Date.now() - attemptStart) / 1000)
            const label = maxAttempts > 1
              ? `Variant ${attempt + 1}/${maxAttempts} · ${elapsed}s`
              : `Generating · ${elapsed}s`
            setProgressMsg(label)
          }, 1000)

          try {
            const fullResult = await createFullContextExtension(
              sourceImage,
              direction,
              EXTENSION_PERCENT
            )
            const imageUrl = await callExtendApi(fullResult.fullImageWithBlankArea, {
              useFullContext: true,
              extensionInfo: fullResult.extensionInfo,
              attempt,
            })
            if (await isAiExtensionUnfilled(imageUrl, fullResult.extensionInfo)) {
              continue
            }
            const blended = await applyFullContextResult(
              imageUrl,
              fullResult.extensionInfo,
              sourceImage
            )
            const score = await measureSeamResidual(
              blended,
              fullResult.extensionInfo,
              sourceImage
            )
            if (debugMode) {
              // eslint-disable-next-line no-console
              console.log(
                `🔬 Variant ${attempt + 1} seam residual: ${score.toFixed(2)}`
              )
            }
            candidates.push(await finalizeCandidate(blended, score, attempt + 1))
          } finally {
            clearInterval(tickHandle)
          }
        }

        if (candidates.length === 0) {
          throw new Error(
            `AI failed to fill the extension area after ${maxAttempts} attempt${maxAttempts > 1 ? 's' : ''}. Try a different direction or model.`
          )
        }
        // Sort best (lowest seam residual) first so the user lands on the
        // cleanest blend by default but can cycle to alternatives.
        candidates.sort((a, b) => a.score - b.score)
        return candidates
      } else {
        const attemptStart = Date.now()
        const tickHandle = setInterval(() => {
          const elapsed = Math.floor((Date.now() - attemptStart) / 1000)
          setProgressMsg(`Generating · ${elapsed}s`)
        }, 1000)
        try {
          const result = await createChunkedExtension(
            sourceImage,
            direction,
            EXTENSION_PERCENT,
            40
          )
          const imageUrl = await callExtendApi(result.chunkToExtend, {
            chunkInfo: result.chunkInfo,
            useFullContext: false,
          })
          const stitched = await stitchExtendedChunk(sourceImage, imageUrl, result.chunkInfo, debugMode)
          // Vertical path produces a single variant. Wrap it so the caller
          // can treat horizontal + vertical results uniformly.
          return [{ imageUrl: stitched, score: 0, attempt: 1 }]
        } finally {
          clearInterval(tickHandle)
        }
      }
    },
    [currentImageDimensions, debugMode, apiKey, selectedModel, providerSettings, mode, sceneBrief]
  )

  /**
   * Resolve which image (and which layer role, if any) the next extension
   * should operate on. In parallax mode the source is the active layer's
   * raw (un-keyed) image so the AI sees the magenta key consistently; in
   * extender mode it's just the global selectedImage.
   */
  const resolveExtendSource = (): {
    sourceImage: string | null
    layerRole?: LayerRole
  } => {
    if (mode === 'parallax') {
      const layer = activeLayer
      if (!layer || !layer.imageUrl) return { sourceImage: null }
      return {
        sourceImage: layer.rawImageUrl ?? layer.imageUrl,
        layerRole: layer.role,
      }
    }
    return { sourceImage: selectedImage }
  }

  const handleExtend = async (direction: Direction) => {
    if (loading) return
    if (!ensureCanGenerate()) return
    const { sourceImage, layerRole } = resolveExtendSource()
    if (!sourceImage) return
    setError(null)
    setLoading(true)
    setProgressMsg(`Extending ${direction}…`)
    setActiveDirection(direction)
    setImageBeforeExtension(sourceImage)
    setLastExtensionParams({ direction, customPrompt, artStyle, layerRole })

    try {
      const candidates = await runExtend(
        direction,
        sourceImage,
        customPrompt,
        artStyle,
        layerRole
      )
      adoptCandidates(candidates)
    } catch (err) {
      const e = err as Error & { status?: number }
      setError(e.message || 'An error occurred')
      setActiveDirection(null)
      if (e.status === 401) {
        setApiKeyRequired(true)
        setShowApiKeyModal(true)
      }
    } finally {
      setLoading(false)
      setProgressMsg(null)
    }
  }

  const handleRegenerate = async () => {
    if (!lastExtensionParams || !imageBeforeExtension || loading) return
    if (!ensureCanGenerate()) return
    setError(null)
    setLoading(true)
    setProgressMsg(`Regenerating ${lastExtensionParams.direction}…`)
    try {
      const candidates = await runExtend(
        lastExtensionParams.direction,
        imageBeforeExtension,
        lastExtensionParams.customPrompt,
        lastExtensionParams.artStyle,
        lastExtensionParams.layerRole
      )
      adoptCandidates(candidates)
    } catch (err) {
      const e = err as Error & { status?: number }
      setError(e.message || 'An error occurred')
      if (e.status === 401) {
        setApiKeyRequired(true)
        setShowApiKeyModal(true)
      }
    } finally {
      setLoading(false)
      setProgressMsg(null)
    }
  }

  const cycleVariant = (delta: 1 | -1) => {
    if (extendedCandidates.length <= 1) return
    setSelectedCandidateIdx((prev) => {
      const n = extendedCandidates.length
      return (prev + delta + n) % n
    })
  }

  /** The candidate the user is currently viewing (null when no result). */
  const activeCandidate: Candidate | null =
    extendedCandidates.length > 0
      ? extendedCandidates[Math.min(selectedCandidateIdx, extendedCandidates.length - 1)]
      : null

  const handleAccept = () => {
    if (!activeCandidate) return
    const accepted = activeCandidate.imageUrl

    if (mode === 'parallax' && activeLayer) {
      // In parallax mode, accept writes back to the active layer (display +
      // raw + dims) rather than touching the global selectedImage.
      const dims = candidateDims[selectedCandidateIdx]
      patchActiveLayer({
        imageUrl: accepted,
        rawImageUrl: activeCandidate.rawImageUrl ?? accepted,
        width: dims?.width ?? activeLayer.width,
        height: dims?.height ?? activeLayer.height,
      })
    } else {
      setSelectedImage(accepted)
      const img = new Image()
      img.onload = () => {
        setCurrentImageDimensions({ width: img.width, height: img.height })
      }
      img.src = accepted
    }
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)
    setImageBeforeExtension(null)
    setLastExtensionParams(null)
    setActiveDirection(null)
  }

  const handleDiscard = () => {
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)
    setImageBeforeExtension(null)
    setLastExtensionParams(null)
    setActiveDirection(null)
  }

  const handleDownload = () => {
    if (!activeCandidate) return
    const link = document.createElement('a')
    link.href = activeCandidate.imageUrl
    const baseName = originalFileName.replace(/\.[^/.]+$/, '') || 'extended'
    // Tag the filename with the variant index when there are multiple, so
    // batch-downloading different cycles doesn't overwrite the same file.
    const variantTag = extendedCandidates.length > 1
      ? `_v${selectedCandidateIdx + 1}`
      : ''
    link.download = `${baseName}_extended${variantTag}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleNewImage = () => {
    setSelectedImage(null)
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)
    setCurrentImageDimensions(null)
    setImageBeforeExtension(null)
    setLastExtensionParams(null)
    setActiveDirection(null)
    setError(null)
    setCustomPrompt('')
    setParallaxTargetWidth(null)
    // Parallax: blow away every populated layer when the user picks "New".
    if (mode === 'parallax') {
      setParallaxLayers(createDefaultLayers())
      setParallaxActiveIdx(LAYER_ORDER.indexOf(WORKFLOW_ORDER[0]))
      setSceneBrief('')
      setSceneBriefLoading(false)
    }
    // Tile-set: clear all 13 tiles + prompt; sceneBrief stays so the user
    // can keep iterating sets within the same project.
    if (mode === 'tile') {
      setTileSet(createEmptyTileSet())
      setTilePrompt('')
      setTileProgressMsg(null)
      tileStopRef.current = false
    }
    // Props: clear all decoration sprites + prompt; sceneBrief stays so the
    // props can keep matching the rest of the project.
    if (mode === 'props') {
      setPropItems([])
      setPropPrompt('')
      setPropProgressMsg(null)
      propStopRef.current = false
    }
    // Sprite: wipe frames + prompt + anchor; sceneBrief is kept so the
    // user can keep iterating sprites within the same project / scene.
    if (mode === 'sprite') {
      setSpriteSheet(createEmptySpriteSheet(spriteAnim))
      setSpriteAnchor(null)
      setSpritePrompt('')
      setSpriteFps(SPRITE_ANIMATIONS[spriteAnim].defaultFps)
      setSpriteProgressMsg(null)
      spriteStopRef.current = false
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Tile-set mode handlers ───────────────────────────────────────────────

  /** Mutate a single tile slot in the set. */
  const patchTileSlot = (
    role: TileSetRole,
    patch: Partial<TileSetSlot>
  ) => {
    setTileSet((prev) =>
      prev.map((s) => (s.role === role ? { ...s, ...patch } : s))
    )
  }

  /** Apply role-appropriate post-processing: magenta→alpha for non-body
   * tiles, plus tileability passes only along the role's loop axis.
   *
   * Tile-mode uses an AGGRESSIVE chroma-key tuning (low cast threshold,
   * wide softness) because the AI tends to render the cut boundaries as
   * faint pink lines at the 25% mark inside cells. The default tuning is
   * conservative enough to preserve parallax-layer art that contains warm
   * reds; tile materials (stone, dirt, brick, ice, etc.) have effectively
   * zero natural magenta cast, so we can crank the threshold down without
   * eating real material colors. This kills the "thin pink stripe between
   * material and transparency" artefact at its source. */
  const TILE_CHROMA_KEY_OPTS = {
    castThreshold: 40,
    castSoftness: 35,
    despill: 1,
    despillGreenBoost: 0.6,
  }
  const enforceTileRoleMask = async (
    role: TileSetRole,
    imageUrl: string
  ): Promise<string> => {
    if (role === 'body') return imageUrl

    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const w = img.width
        const h = img.height
        const qx = Math.round(w / 4)
        const qy = Math.round(h / 4)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Failed to get tile mask canvas context'))
          return
        }

        ctx.drawImage(img, 0, 0, w, h)
        const imageData = ctx.getImageData(0, 0, w, h)
        applyFeatheredRoleMask(imageData.data, w, h, role, qx, qy)
        ctx.putImageData(imageData, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('Failed to load tile for mask enforcement'))
      img.src = imageUrl
    })
  }
  const postProcessTile = async (
    role: TileSetRole,
    rawImageUrl: string
  ): Promise<string> => {
    if (role === 'body') {
      // Body cell is fully opaque (no magenta should be there at all), but
      // the AI sometimes leaks faint pink lines at the cell boundaries that
      // get sliced into this cell. We run the chroma-key in DESPILL-ONLY
      // mode (cast threshold above 255 = nothing ever becomes transparent)
      // to neutralize any pinkish pixels back to neutral material color
      // before the 2D-tileable pass.
      const despilled = await chromaKeyToAlpha(rawImageUrl, {
        castThreshold: 256,
        castSoftness: 0,
        despill: 1,
        despillGreenBoost: 0.6,
      })
      // Body is repeated many times in the preview, so tiny edge errors and
      // left/right tonal drift become obvious grid lines. Use a stronger pass
      // than parallax/background tiling: wide blends hide the loop boundary,
      // and full equalization removes the "panel" look from a single repeated
      // dirt/stone cell while preserving local pebbles/roots.
      return makeTileable2D(despilled, {
        equalizeStrength: 1,
        blendWidthPx: Math.round(TILESET_TILE_SIZE * 0.22),
        verticalBlendHeightPx: Math.round(TILESET_TILE_SIZE * 0.22),
      })
    }
    if (role === 'top' || role === 'bottom') {
      // Edge tiles loop only along their non-cut axis. We harden the loop
      // axis BEFORE alpha-keying so the algorithm sees full opaque pixels.
      const tiled = await makeHorizontallyTileable(rawImageUrl)
      const keyed = await chromaKeyToAlpha(tiled, TILE_CHROMA_KEY_OPTS)
      return enforceTileRoleMask(role, keyed)
    }
    if (role === 'left' || role === 'right') {
      const tiled = await makeVerticallyTileable(rawImageUrl)
      const keyed = await chromaKeyToAlpha(tiled, TILE_CHROMA_KEY_OPTS)
      return enforceTileRoleMask(role, keyed)
    }
    // Corner tiles — no axis loops, just key the magenta to alpha.
    const keyed = await chromaKeyToAlpha(rawImageUrl, TILE_CHROMA_KEY_OPTS)
    return enforceTileRoleMask(role, keyed)
  }

  /** Generate a single tile slot. Returns the resolved image URL (already
   * post-processed) so callers can chain or assign as needed. Throws on
   * failure so the caller can surface error state. */
  const generateOneTile = async (role: TileSetRole): Promise<string> => {
    const slot = TILESET_BY_ROLE[role]
    const labelLower = slot.label.toLowerCase()
    setTileProgressMsg(`Generating ${labelLower}…`)
    patchTileSlot(role, { generating: true })

    try {
      const tileGuideImage = buildTileSheetGuideDataUrl()
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: tilePrompt,
          width: TILESET_TILE_SIZE,
          height: TILESET_TILE_SIZE,
          artStyle: artStyle !== 'none' ? artStyle : undefined,
          ...aiRequestConfig(),
          tileMode: true,
          tileRole: role,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 401) {
          setApiKeyRequired(true)
          setShowApiKeyModal(true)
        }
        throw new Error(data.error || `Failed to generate ${labelLower} tile`)
      }
      if (!data.imageUrl) throw new Error('No image returned from API')

      setTileProgressMsg(`Processing ${labelLower}…`)
      const processed = await postProcessTile(role, data.imageUrl)

      // Keep corners reconciled with their edge neighbors after a single
      // regen (the generate-all path reconciles the whole set at once). We
      // read neighbor URLs from current state.
      const neighborUrls: Partial<Record<TileSetRole, string>> = {}
      tileSet.forEach((s) => {
        if (s.imageUrl && s.role !== role) neighborUrls[s.role] = s.imageUrl
      })

      const isCorner = !!CORNER_GRAFTS[role]
      if (ENABLE_CORNER_RECONCILE && isCorner) {
        // A corner was regenerated → rebuild it against current neighbors
        // (inner corners are assembled from neighbors; outer corners grafted).
        let finalUrl = processed
        try {
          finalUrl = await rebuildCornerTile(role, processed, neighborUrls)
        } catch {
          /* fall back to the raw corner */
        }
        patchTileSlot(role, {
          imageUrl: finalUrl,
          hasImage: true,
          generating: false,
        })
        return finalUrl
      }

      patchTileSlot(role, {
        imageUrl: processed,
        hasImage: true,
        generating: false,
      })

      // An edge/body was regenerated → rebuild every corner so their shared
      // borders (and assembled inner corners) track the new tile.
      const affectsCorners =
        role === 'top' ||
        role === 'bottom' ||
        role === 'left' ||
        role === 'right' ||
        role === 'body'
      if (affectsCorners && ENABLE_CORNER_RECONCILE) {
        const updatedNeighbors = { ...neighborUrls, [role]: processed }
        await Promise.all(
          (Object.keys(CORNER_GRAFTS) as TileSetRole[]).map(async (cRole) => {
            const cUrl = tileSet.find((s) => s.role === cRole)?.imageUrl
            if (!cUrl) return
            try {
              const rebuilt = await rebuildCornerTile(
                cRole,
                cUrl,
                updatedNeighbors
              )
              patchTileSlot(cRole, { imageUrl: rebuilt })
            } catch {
              /* leave the corner as-is on failure */
            }
          })
        )
      }

      return processed
    } catch (err) {
      patchTileSlot(role, { generating: false })
      throw err
    }
  }

  /** Generate the full 13-tile set in ONE AI call as a 4×4 sprite-sheet,
   * then slice + post-process each cell. This is the consistency win: all
   * tiles come out of the same diffusion pass so palette, texture detail,
   * and lighting are locked across the set. The per-tile path (used by
   * `handleRegenerateTile`) is retained as an escape hatch for individual
   * failures. */
  /** Composite the generated tiles into the platform-preview mockup (the same
   * layout PlatformPreview renders) on a sky backdrop, and return it as a data
   * URL. This is the image the QA art director inspects for seams / cohesion —
   * problems show up where tiles meet, not in isolated cells. */
  const buildTilePreviewCompositeDataUrl = async (
    map: Partial<Record<TileSetRole, string>>
  ): Promise<string | null> => {
    const rows = TILE_TEMPLATE_ROWS
    const cols = TILE_TEMPLATE_COLS
    const CELL = 96
    const canvas = document.createElement('canvas')
    canvas.width = cols * CELL
    canvas.height = rows * CELL
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height)
    g.addColorStop(0, '#8cc3eb')
    g.addColorStop(1, '#28466e')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const need = new Map<TileSetRole, string>()
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const role = templateRoleForCell(x, y)
        if (role && map[role]) need.set(role, map[role] as string)
      }
    }
    const imgByRole = new Map<TileSetRole, HTMLImageElement>()
    await Promise.all(
      Array.from(need.entries()).map(
        ([role, src]) =>
          new Promise<void>((resolve) => {
            const img = new Image()
            img.onload = () => {
              imgByRole.set(role, img)
              resolve()
            }
            img.onerror = () => resolve()
            img.src = src
          })
      )
    )
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const role = templateRoleForCell(x, y)
        if (!role) continue
        const img = imgByRole.get(role)
        if (img) ctx.drawImage(img, x * CELL, y * CELL, CELL, CELL)
      }
    }
    return canvas.toDataURL('image/png')
  }

  /** Raw tile sheet built directly from a role→url map (state-independent, so
   * the QA call can run before React state has committed). */
  const buildSheetFromMapDataUrl = async (
    map: Partial<Record<TileSetRole, string>>
  ): Promise<string | null> => {
    const entries = TILESET_SLOTS.filter((s) => map[s.role])
    if (entries.length === 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = TILESET_SHEET_W
    canvas.height = TILESET_SHEET_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    await Promise.all(
      entries.map(
        (spec) =>
          new Promise<void>((resolve) => {
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(
                img,
                spec.col * TILESET_TILE_SIZE,
                spec.row * TILESET_TILE_SIZE,
                TILESET_TILE_SIZE,
                TILESET_TILE_SIZE
              )
              resolve()
            }
            img.onerror = () => resolve()
            img.src = map[spec.role] as string
          })
      )
    )
    return canvas.toDataURL('image/png')
  }

  /** Review half of the reverse pipeline — hand the assembled preview + sheet
   * to the QA art director. Returns null (≈ approve) on any failure so a flaky
   * critic never blocks the user. */
  const fetchTileReview = async (
    previewImage: string,
    sheetImage: string | null
  ): Promise<{ ok: boolean; issues: string[]; fix: string } | null> => {
    try {
      const res = await fetch('/api/tile-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: tilePrompt,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
          ...aiRequestConfig(),
          previewImage,
          sheetImage: sheetImage || undefined,
        }),
      })
      if (!res.ok) return null
      const data = await res.json()
      if (typeof data?.ok !== 'boolean') return null
      return data
    } catch {
      return null
    }
  }

  const handleGenerateTileSet = async () => {
    if (tileSetGenerating) return
    if (!tilePrompt.trim()) {
      setError('Describe the material you want — e.g. mossy stone floor.')
      return
    }
    if (!ensureCanGenerate()) return
    setError(null)
    tileStopRef.current = false
    setTileSetGenerating(true)
    const startedAt = Date.now()
    // Up to this many extra repaint passes after the first generation, each
    // driven by the QA art director's fix report.
    const MAX_TILE_REVIEW_PASSES = 2

    // Mark every slot as "generating" up front so the UI shows the whole
    // set spinning during the single AI call (vs. one cell at a time).
    setTileSet((prev) => prev.map((s) => ({ ...s, generating: true })))

    // Tick a live elapsed-seconds counter so the user sees progress during
    // the long single call (sheet generation typically takes 30-90s).
    let phase = 'Generating sheet'
    const tickHandle = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setTileProgressMsg(`${phase} · ${elapsed}s`)
    }, 1000)

    // One full generate → align → slice → process → reconcile pass. Returns
    // the reconciled role→url map, or null if stopped. `fixNotes` carries the
    // QA report into the regeneration prompt on retry passes.
    const renderSheetOnce = async (
      fixNotes?: string
    ): Promise<Partial<Record<TileSetRole, string>> | null> => {
      const tileGuideImage = buildTileSheetGuideDataUrl()
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: tilePrompt,
          width: TILE_TEMPLATE_W,
          height: TILE_TEMPLATE_H,
          artStyle: artStyle !== 'none' ? artStyle : undefined,
          ...aiRequestConfig(),
          tileSheet: true,
          tileGuideImage,
          tileFixNotes: fixNotes,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 401) {
          setApiKeyRequired(true)
          setShowApiKeyModal(true)
        }
        throw new Error(data.error || 'Failed to generate tile sheet')
      }
      if (!data.imageUrl) throw new Error('No image returned from API')
      if (tileStopRef.current) return null

      phase = 'Aligning to template'
      const aligned = await alignAiOutputToTemplate(data.imageUrl)
      if (tileStopRef.current) return null

      phase = 'Slicing template'
      const cells = await sliceImageGrid(aligned, {
        cols: TILE_TEMPLATE_COLS,
        rows: TILE_TEMPLATE_ROWS,
        cellSize: TILE_TEMPLATE_CELL,
      })
      if (tileStopRef.current) return null

      phase = 'Processing tiles'
      const processed = await Promise.all(
        TILESET_SLOTS.map(async (spec) => {
          const sample = TILE_TEMPLATE_SAMPLES[spec.role]
          const cellIdx = sample.row * TILE_TEMPLATE_COLS + sample.col
          const raw = cells[cellIdx]
          if (!raw) return { role: spec.role, imageUrl: null }
          try {
            const out = await postProcessTile(spec.role, raw)
            return { role: spec.role, imageUrl: out }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`Post-process failed for ${spec.role}:`, err)
            return { role: spec.role, imageUrl: raw }
          }
        })
      )

      phase = 'Reconciling corners'
      const byRoleUrl: Partial<Record<TileSetRole, string>> = {}
      processed.forEach((p) => {
        if (p.imageUrl) byRoleUrl[p.role] = p.imageUrl
      })
      let reconciled = byRoleUrl
      try {
        reconciled = await reconcileAllCorners(byRoleUrl)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Corner reconcile failed; using raw corners:', err)
      }
      return reconciled
    }

    // `reviewing` keeps each populated cell's spinner overlay on while the art
    // director inspects the result (so the sheet visibly shows "still working"
    // during review / repaint), then clears it once the verdict is final.
    const applyMap = (
      map: Partial<Record<TileSetRole, string>>,
      reviewing: boolean
    ) =>
      setTileSet((prev) =>
        prev.map((slot) => {
          const url = map[slot.role] ?? null
          return {
            role: slot.role,
            imageUrl: url,
            hasImage: !!url,
            generating: reviewing && !!url,
          }
        })
      )

    try {
      let fixNotes: string | undefined
      // Track the BEST candidate across passes and commit that one at the end —
      // never just the last pass. A repaint fully re-rolls every flat tile (and
      // the corners are composited deterministically afterwards), so a critic
      // that rejects a clean first generation can otherwise replace it with a
      // drifted, uglier sheet. Keep-best makes the review loop strictly safe:
      // it can only ever improve on, never regress, the first generation.
      // score: -1 = critic approved (best possible); otherwise the number of
      // issues raised (fewer = better). Strictly-better comparison means TIES
      // keep the EARLIER pass — and the first, un-nudged generation is the one
      // least likely to have drifted.
      let best: {
        map: Partial<Record<TileSetRole, string>>
        score: number
      } | null = null

      for (let pass = 0; pass <= MAX_TILE_REVIEW_PASSES; pass++) {
        phase = pass === 0 ? 'Generating sheet' : `Repainting (pass ${pass + 1})`
        const reconciled = await renderSheetOnce(fixNotes)
        if (tileStopRef.current || !reconciled) return

        // Show the attempt but KEEP each tile's spinner on to signal that the
        // art director is still reviewing the sheet.
        applyMap(reconciled, true)

        if (skipArtDirectorReview) {
          if (debugMode) {
            // eslint-disable-next-line no-console
            console.log('🧱 Skipping art director review for GPT image model')
          }
          best = { map: reconciled, score: -1 }
          break
        }

        phase = 'Art director reviewing'
        setTileProgressMsg('Art director reviewing…')
        const [previewImage, sheetImage] = await Promise.all([
          buildTilePreviewCompositeDataUrl(reconciled),
          buildSheetFromMapDataUrl(reconciled),
        ])
        if (tileStopRef.current) return

        // No preview → can't review; treat as a neutral candidate.
        const review = previewImage
          ? await fetchTileReview(previewImage, sheetImage)
          : null
        if (tileStopRef.current) return

        // null (critic unavailable/parse error) is treated as approved so a
        // flaky critic never blocks the user.
        const approved = !review || review.ok
        const score = approved ? -1 : review.issues?.length || 1
        if (!best || score < best.score) best = { map: reconciled, score }

        if (approved) {
          if (debugMode && review) {
            // eslint-disable-next-line no-console
            console.log('🧱 QA approved the tileset')
          }
          break
        }

        // Rejected — stop if there's nothing actionable or we're out of budget;
        // otherwise carry the fix report into the next repaint.
        fixNotes = review.fix || review.issues.join('; ')
        if (!fixNotes || pass === MAX_TILE_REVIEW_PASSES) break

        if (debugMode) {
          // eslint-disable-next-line no-console
          console.log('🧱 QA rejected, repainting with notes:', fixNotes)
        }
        // Leave the spinners on — they now signal the repaint in progress.
        setTileProgressMsg('Issues found — repainting…')
      }

      // Commit the best candidate we saw (spinners off) — preferring the best,
      // not the last, is what stops the review loop from turning a clean first
      // generation into one with corner artifacts.
      if (best) applyMap(best.map, false)
    } catch (err) {
      // Wipe the "generating" flags on failure so the UI stops spinning.
      setTileSet((prev) => prev.map((s) => ({ ...s, generating: false })))
      setError(
        err instanceof Error ? err.message : 'Failed to generate tile sheet'
      )
    } finally {
      clearInterval(tickHandle)
      setTileSetGenerating(false)
      setTileProgressMsg(null)
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      // eslint-disable-next-line no-console
      if (debugMode) console.log(`🧱 Tile-set generated in ${elapsed}s`)
    }
  }

  const handleStopTileSet = () => {
    tileStopRef.current = true
  }

  /** Regenerate a single tile in the set without touching the others. */
  const handleRegenerateTile = async (role: TileSetRole) => {
    if (tileSetGenerating) return
    if (!tilePrompt.trim()) {
      setError('Describe the material you want before regenerating tiles.')
      return
    }
    if (!ensureCanGenerate()) return
    setError(null)
    setTileSetGenerating(true)
    try {
      await generateOneTile(role)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate tile')
    } finally {
      setTileSetGenerating(false)
      setTileProgressMsg(null)
    }
  }

  const handleClearTileSet = () => {
    setTileSet(createEmptyTileSet())
    setTilePrompt('')
    setTileProgressMsg(null)
    tileStopRef.current = false
    setError(null)
  }

  /** Render the 4x4 sprite-sheet PNG (4096x4096) by drawing each populated
   * tile into its grid cell. Empty cells stay transparent. */
  const buildTileSheetDataUrl = async (): Promise<string | null> => {
    const populated = tileSet.filter((s) => s.imageUrl)
    if (populated.length === 0) return null

    const canvas = document.createElement('canvas')
    canvas.width = TILESET_SHEET_W
    canvas.height = TILESET_SHEET_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false

    await Promise.all(
      populated.map(
        (slot) =>
          new Promise<void>((resolve, reject) => {
            if (!slot.imageUrl) {
              resolve()
              return
            }
            const spec = TILESET_BY_ROLE[slot.role]
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(
                img,
                spec.col * TILESET_TILE_SIZE,
                spec.row * TILESET_TILE_SIZE,
                TILESET_TILE_SIZE,
                TILESET_TILE_SIZE
              )
              resolve()
            }
            img.onerror = () => reject(new Error(`Failed to load ${spec.role}`))
            img.src = slot.imageUrl
          })
      )
    )

    return canvas.toDataURL('image/png')
  }

  /** Render an engine atlas with a 2px duplicated border around each tile.
   * Importers should use the inner 512x512 region for each tile and leave
   * the extruded pixels as atlas padding. */
  const buildPaddedTileSheetDataUrl = async (): Promise<string | null> => {
    const populated = tileSet.filter((s) => s.imageUrl)
    if (populated.length === 0) return null

    const canvas = document.createElement('canvas')
    canvas.width = TILESET_PADDED_SHEET_W
    canvas.height = TILESET_PADDED_SHEET_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false

    await Promise.all(
      populated.map(
        (slot) =>
          new Promise<void>((resolve, reject) => {
            if (!slot.imageUrl) {
              resolve()
              return
            }
            const spec = TILESET_BY_ROLE[slot.role]
            const img = new Image()
            img.onload = () => {
              const x = spec.col * TILESET_PADDED_STRIDE
              const y = spec.row * TILESET_PADDED_STRIDE
              const p = TILESET_ATLAS_EXTRUDE_PX

              ctx.drawImage(img, x + p, y + p, TILESET_TILE_SIZE, TILESET_TILE_SIZE)

              // Edges.
              ctx.drawImage(img, 0, 0, TILESET_TILE_SIZE, 1, x + p, y, TILESET_TILE_SIZE, p)
              ctx.drawImage(img, 0, TILESET_TILE_SIZE - 1, TILESET_TILE_SIZE, 1, x + p, y + p + TILESET_TILE_SIZE, TILESET_TILE_SIZE, p)
              ctx.drawImage(img, 0, 0, 1, TILESET_TILE_SIZE, x, y + p, p, TILESET_TILE_SIZE)
              ctx.drawImage(img, TILESET_TILE_SIZE - 1, 0, 1, TILESET_TILE_SIZE, x + p + TILESET_TILE_SIZE, y + p, p, TILESET_TILE_SIZE)

              // Corners.
              ctx.drawImage(img, 0, 0, 1, 1, x, y, p, p)
              ctx.drawImage(img, TILESET_TILE_SIZE - 1, 0, 1, 1, x + p + TILESET_TILE_SIZE, y, p, p)
              ctx.drawImage(img, 0, TILESET_TILE_SIZE - 1, 1, 1, x, y + p + TILESET_TILE_SIZE, p, p)
              ctx.drawImage(img, TILESET_TILE_SIZE - 1, TILESET_TILE_SIZE - 1, 1, 1, x + p + TILESET_TILE_SIZE, y + p + TILESET_TILE_SIZE, p, p)

              resolve()
            }
            img.onerror = () => reject(new Error(`Failed to load ${spec.role}`))
            img.src = slot.imageUrl
          })
      )
    )

    return canvas.toDataURL('image/png')
  }

  /** Build the engine-friendly manifest describing every tile's grid cell
   * and role. Engine importers (Phaser, Tiled, Godot, custom) can map cell
   * coords → role with this. */
  const buildTileSetManifest = () => ({
    version: 1,
    tileSize: TILESET_TILE_SIZE,
    cols: TILESET_COLS,
    rows: TILESET_ROWS,
    sheetWidth: TILESET_SHEET_W,
    sheetHeight: TILESET_SHEET_H,
    productionAtlas: {
      fileName: 'sheet_padded.png',
      tileSize: TILESET_TILE_SIZE,
      extrudePx: TILESET_ATLAS_EXTRUDE_PX,
      stride: TILESET_PADDED_STRIDE,
      sheetWidth: TILESET_PADDED_SHEET_W,
      sheetHeight: TILESET_PADDED_SHEET_H,
      importNote:
        'Use each tile source rect at paddedX/paddedY with width/height tileSize. Keep the surrounding extruded pixels in the atlas to prevent filtering seams.',
    },
    prompt: tilePrompt,
    sceneBrief: sceneBrief.trim() || null,
    artStyle: artStyle !== 'none' ? artStyle : null,
    tiles: TILESET_SLOTS.map((spec) => {
      const slot = tileSet.find((s) => s.role === spec.role)
      return {
        role: spec.role,
        label: spec.label,
        col: spec.col,
        row: spec.row,
        index: spec.row * TILESET_COLS + spec.col,
        fileName: `${spec.fileName}.png`,
        present: !!slot?.imageUrl,
        sourceX: spec.col * TILESET_TILE_SIZE,
        sourceY: spec.row * TILESET_TILE_SIZE,
        paddedX:
          spec.col * TILESET_PADDED_STRIDE + TILESET_ATLAS_EXTRUDE_PX,
        paddedY:
          spec.row * TILESET_PADDED_STRIDE + TILESET_ATLAS_EXTRUDE_PX,
      }
    }),
  })

  const handleDownloadTileSheet = async () => {
    try {
      const sheet = await buildTileSheetDataUrl()
      if (!sheet) {
        setError('Generate at least one tile before downloading the sheet.')
        return
      }
      const baseName = (tilePrompt.trim().slice(0, 24) || 'tileset').replace(
        /[^a-z0-9]+/gi,
        '_'
      )
      const link = document.createElement('a')
      link.href = sheet
      link.download = `${baseName}_sheet_${TILESET_SHEET_W}x${TILESET_SHEET_H}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      const paddedSheet = await buildPaddedTileSheetDataUrl()
      if (paddedSheet) {
        const linkPadded = document.createElement('a')
        linkPadded.href = paddedSheet
        linkPadded.download = `${baseName}_sheet_padded_${TILESET_PADDED_SHEET_W}x${TILESET_PADDED_SHEET_H}.png`
        document.body.appendChild(linkPadded)
        linkPadded.click()
        document.body.removeChild(linkPadded)
      }

      // Also offer the manifest as a sidecar JSON in a second click.
      const manifest = buildTileSetManifest()
      const json = JSON.stringify(manifest, null, 2)
      const jsonUrl = URL.createObjectURL(
        new Blob([json], { type: 'application/json' })
      )
      const linkJson = document.createElement('a')
      linkJson.href = jsonUrl
      linkJson.download = `${baseName}_manifest.json`
      document.body.appendChild(linkJson)
      linkJson.click()
      document.body.removeChild(linkJson)
      URL.revokeObjectURL(jsonUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export sheet')
    }
  }

  const handleDownloadTileSetZip = async () => {
    try {
      const populated = tileSet.filter((s) => s.imageUrl)
      if (populated.length === 0) {
        setError('Generate at least one tile before exporting the ZIP.')
        return
      }
      const zip = new JSZip()
      // Drop each tile in as its own PNG.
      for (const slot of populated) {
        if (!slot.imageUrl) continue
        const spec = TILESET_BY_ROLE[slot.role]
        const base64 = slot.imageUrl.split(',')[1]
        if (base64) {
          zip.file(`${spec.fileName}.png`, base64, { base64: true })
        }
      }
      // Combined sheet for engine import.
      const sheet = await buildTileSheetDataUrl()
      if (sheet) {
        const base64 = sheet.split(',')[1]
        if (base64) {
          zip.file('sheet.png', base64, { base64: true })
        }
      }
      const paddedSheet = await buildPaddedTileSheetDataUrl()
      if (paddedSheet) {
        const base64 = paddedSheet.split(',')[1]
        if (base64) {
          zip.file('sheet_padded.png', base64, { base64: true })
        }
      }
      // Manifest with grid layout.
      zip.file(
        'manifest.json',
        JSON.stringify(buildTileSetManifest(), null, 2)
      )

      const blob = await zip.generateAsync({ type: 'blob' })
      const baseName = (tilePrompt.trim().slice(0, 24) || 'tileset').replace(
        /[^a-z0-9]+/gi,
        '_'
      )
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${baseName}_tileset.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export ZIP')
    }
  }

  // ── Props / decoration mode handlers ──────────────────────────────────────
  //
  // Open-ended library: each "add more" press paints a fresh batch of
  // PROP_BATCH decorations in one AI call and APPENDS them — existing props are
  // never regenerated. To keep the growing library coherent, every batch (and
  // every single re-roll) is given the current props as a style reference so
  // palette / lighting stay locked while the model invents new decorations.

  // Props are colorful (flowers, crystals, mushrooms), so we use a moderate
  // chroma-key rather than the aggressive tile tuning — enough to delete the
  // flat magenta cleanly without eating saturated prop colors. removeFrameBorder
  // then wipes any neighbor bleed that crept into a cell's outer band.
  const PROP_CHROMA_KEY_OPTS = {
    castThreshold: 70,
    castSoftness: 30,
    despill: 1,
    despillGreenBoost: 0.5,
  }

  /** Magenta → alpha for one sliced prop cell, then trim cell-edge bleed. */
  const postProcessProp = async (rawCellUrl: string): Promise<string> => {
    const keyed = await chromaKeyToAlpha(rawCellUrl, PROP_CHROMA_KEY_OPTS)
    try {
      return await removeFrameBorder(keyed)
    } catch {
      return keyed
    }
  }

  /** Compose a REPRESENTATIVE sample of the existing library onto a magenta
   * grid as a STYLE REFERENCE for the next batch — the model matches its
   * palette/lighting but must paint decorations of DIFFERENT kinds. We sample
   * evenly across the WHOLE library (not just the recent batch) so the model
   * can see everything already made and avoid re-painting earlier categories.
   * Drawn on magenta (the key color) so the model reads them in the same
   * convention it must output. Returns undefined if empty. */
  const buildPropStyleRefDataUrl = async (
    items: PropItem[]
  ): Promise<string | undefined> => {
    const all = items.filter((p) => p.imageUrl)
    if (all.length === 0) return undefined
    // This image is a small STYLE ANCHOR — its only job is to lock palette /
    // lighting / rendering, which text can't convey. De-duplication is handled
    // separately by a cheap TEXT name list (see propAvoidHint), so we keep this
    // tiny and FIXED-SIZE: a 3-col swatch of up to 9 props sampled evenly across
    // the whole library, regardless of how big the library grows.
    const CAP = 9
    let withImg: PropItem[]
    if (all.length <= CAP) {
      withImg = all
    } else {
      withImg = []
      for (let i = 0; i < CAP; i++) {
        withImg.push(all[Math.floor((i * all.length) / CAP)])
      }
    }
    const cell = 200
    const cols = Math.min(3, withImg.length)
    const rows = Math.ceil(withImg.length / cols)
    const canvas = document.createElement('canvas')
    canvas.width = cols * cell
    canvas.height = rows * cell
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.fillStyle = '#FF00FF'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    await Promise.all(
      withImg.map(
        (p, i) =>
          new Promise<void>((resolve) => {
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(img, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell)
              resolve()
            }
            img.onerror = () => resolve()
            img.src = p.imageUrl as string
          })
      )
    )
    return canvas.toDataURL('image/png')
  }

  /** Unique decoration categories already in the library (lowercase). Sent to
   * the art director as the "do not repeat" set. */
  const propCategoriesOf = (items: PropItem[]): string[] => {
    const seen = new Set<string>()
    for (const p of items) {
      const n = (p.name || '').trim().toLowerCase()
      if (n) seen.add(n)
    }
    return Array.from(seen)
  }

  /** CALL #1 of the props pipeline — ask the art-director text model for the
   * next `count` fresh decoration ideas, given everything already made. Returns
   * [] on any failure so callers fall back to free image-model invention. */
  const fetchPropIdeas = async (
    count: number,
    items: PropItem[]
  ): Promise<{ category: string; description: string }[]> => {
    try {
      const res = await fetch('/api/prop-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: propPrompt,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
          artStyle: artStyle !== 'none' ? artStyle : undefined,
          ...aiRequestConfig(),
          count,
          existing: propCategoriesOf(items),
        }),
      })
      if (!res.ok) return []
      const data = await res.json()
      return Array.isArray(data.ideas) ? data.ideas : []
    } catch {
      return []
    }
  }

  /** Pack the whole library into one transparent atlas (PROP_ATLAS_COLS wide). */
  const buildPropAtlasDataUrl = async (): Promise<string | null> => {
    const populated = propItems.filter((p) => p.imageUrl)
    if (populated.length === 0) return null
    const layout = propAtlasLayout(populated.length)
    const canvas = document.createElement('canvas')
    canvas.width = layout.width
    canvas.height = layout.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.clearRect(0, 0, layout.width, layout.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    await Promise.all(
      populated.map(
        (p, i) =>
          new Promise<void>((resolve) => {
            const r = layout.rect(i)
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(img, r.x, r.y, r.width, r.height)
              resolve()
            }
            img.onerror = () => resolve()
            img.src = p.imageUrl as string
          })
      )
    )
    return canvas.toDataURL('image/png')
  }

  /** Engine-friendly manifest describing the packed atlas + per-prop rects. */
  const buildPropManifest = () => {
    const populated = propItems.filter((p) => p.imageUrl)
    const layout = propAtlasLayout(populated.length)
    const names = resolvePropNames(populated)
    return {
      type: 'prop-atlas',
      generator: 'AI Image Extender — Props',
      prompt: propPrompt.trim() || null,
      sceneBrief: sceneBrief.trim() || null,
      sheet: { width: layout.width, height: layout.height },
      grid: { cols: layout.cols, rows: layout.rows, cellSize: PROP_TILE_SIZE },
      count: populated.length,
      props: populated.map((p, i) => {
        const r = layout.rect(i)
        return {
          id: p.id,
          name: names[i].name,
          file: names[i].file,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        }
      }),
    }
  }

  /** Generate one batch of PROP_BATCH decorations and append them. Used for the
   * first batch AND every "add more" — the model freely invents the items. */
  const handleAddPropBatch = async () => {
    if (propSetGenerating) return
    if (!propPrompt.trim()) {
      setError('Describe the biome / palette — e.g. lush forest decorations.')
      return
    }
    if (!ensureCanGenerate()) return
    setError(null)
    propStopRef.current = false
    setPropSetGenerating(true)
    const startedAt = Date.now()

    // Snapshot existing props for the style reference, then drop in BATCH
    // spinner placeholders so the user sees the new cells filling in.
    const existing = propItems.filter((p) => p.imageUrl)
    const batchIds = Array.from({ length: PROP_BATCH }, () => nextPropId())
    const batchIdSet = new Set(batchIds)
    setPropItems((prev) => [
      ...prev,
      ...batchIds.map((id) => ({ id, imageUrl: null, generating: true })),
    ])

    const tickHandle = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setPropProgressMsg(
        `${existing.length ? 'Adding' : 'Generating'} ${PROP_BATCH} props · ${elapsed}s`
      )
    }, 1000)

    const dropBatch = () =>
      setPropItems((prev) => prev.filter((p) => !batchIdSet.has(p.id)))

    try {
      const refImage = await buildPropStyleRefDataUrl(existing)

      // CALL #1 — ART DIRECTOR. A text model decides what NEW props to make,
      // given the biome + every category already in the library. This is what
      // keeps the set from looping the same lanterns/nests/pots — a reasoning
      // model deliberately reaches for fresh kinds. Failure is non-fatal: we
      // fall back to letting the image model free-invent.
      setPropProgressMsg('Art director planning…')
      const ideas = await fetchPropIdeas(PROP_BATCH, existing)
      const briefs = ideas.map((i) => i.description)
      const cats = ideas.map((i) => i.category)

      // CALL #2 — RENDER. The image model paints exactly the art director's
      // list, matched to the style anchor.
      setPropProgressMsg(
        `${existing.length ? 'Adding' : 'Generating'} ${PROP_BATCH} props · 0s`
      )
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: propPrompt,
          width: PROP_BATCH_W,
          height: PROP_BATCH_H,
          artStyle: artStyle !== 'none' ? artStyle : undefined,
          ...aiRequestConfig(),
          propSheet: true,
          propCols: PROP_BATCH_COLS,
          propRows: PROP_BATCH_ROWS,
          propCount: PROP_BATCH,
          propRefImage: refImage,
          propList: briefs.length ? briefs : undefined,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 401) {
          setApiKeyRequired(true)
          setShowApiKeyModal(true)
        }
        throw new Error(data.error || 'Failed to generate props')
      }
      if (!data.imageUrl) throw new Error('No image returned from API')
      if (propStopRef.current) {
        dropBatch()
        return
      }

      setPropProgressMsg('Slicing…')
      const cells = await sliceImageGrid(data.imageUrl, {
        cols: PROP_BATCH_COLS,
        rows: PROP_BATCH_ROWS,
        cellSize: PROP_TILE_SIZE,
      })
      if (propStopRef.current) {
        dropBatch()
        return
      }

      setPropProgressMsg('Processing…')
      const processed = await Promise.all(
        batchIds.map(async (_id, i) => {
          const raw = cells[i]
          if (!raw) return null
          try {
            return await postProcessProp(raw)
          } catch {
            return raw
          }
        })
      )
      if (propStopRef.current) {
        dropBatch()
        return
      }

      // Fill placeholders with their result; drop any cell that came back empty.
      // The art director's category list lines up with the cells in reading
      // order, so we tag each prop with the kind the director chose.
      const urlById = new Map<string, string>()
      const nameById = new Map<string, string>()
      batchIds.forEach((id, i) => {
        const url = processed[i]
        if (url) {
          urlById.set(id, url)
          if (cats[i]) nameById.set(id, cats[i])
        }
      })
      setPropItems((prev) =>
        prev
          .map((p) =>
            batchIdSet.has(p.id)
              ? {
                  ...p,
                  imageUrl: urlById.get(p.id) ?? null,
                  name: nameById.get(p.id),
                  generating: false,
                }
              : p
          )
          .filter((p) => !(batchIdSet.has(p.id) && !p.imageUrl))
      )
    } catch (err) {
      dropBatch()
      setError(err instanceof Error ? err.message : 'Failed to generate props')
    } finally {
      clearInterval(tickHandle)
      setPropSetGenerating(false)
      setPropProgressMsg(null)
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      // eslint-disable-next-line no-console
      if (debugMode) console.log(`🌿 Prop batch generated in ${elapsed}s`)
    }
  }

  const handleStopPropSet = () => {
    propStopRef.current = true
  }

  /** Re-roll a single prop in place — a new decoration matched to the rest of
   * the library's style (the other props are passed as a reference). */
  const handleRegenerateProp = async (id: string) => {
    if (propSetGenerating) return
    if (!propPrompt.trim()) {
      setError('Describe the biome first, then re-roll an individual prop.')
      return
    }
    if (!ensureCanGenerate()) return
    setError(null)
    setPropItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, generating: true } : p))
    )
    setPropProgressMsg('Re-rolling prop…')
    try {
      const others = propItems.filter((p) => p.id !== id && p.imageUrl)
      const refImage = await buildPropStyleRefDataUrl(others)
      // Art director picks ONE fresh kind that isn't already in the library.
      const ideas = await fetchPropIdeas(1, others)
      const idea = ideas[0]
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: propPrompt,
          width: PROP_TILE_SIZE,
          height: PROP_TILE_SIZE,
          artStyle: artStyle !== 'none' ? artStyle : undefined,
          ...aiRequestConfig(),
          propMode: true,
          propRole: idea?.description,
          propRefImage: refImage,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 401) {
          setApiKeyRequired(true)
          setShowApiKeyModal(true)
        }
        throw new Error(data.error || 'Failed to re-roll prop')
      }
      if (!data.imageUrl) throw new Error('No image returned from API')
      setPropProgressMsg('Processing…')
      const processed = await postProcessProp(data.imageUrl)
      setPropItems((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, imageUrl: processed, name: idea?.category, generating: false }
            : p
        )
      )
    } catch (err) {
      setPropItems((prev) =>
        prev.map((p) => (p.id === id ? { ...p, generating: false } : p))
      )
      setError(err instanceof Error ? err.message : 'Failed to re-roll prop')
    } finally {
      setPropProgressMsg(null)
    }
  }

  /** Remove a single prop from the library (curation). */
  const handleDeleteProp = (id: string) => {
    setPropItems((prev) => prev.filter((p) => p.id !== id))
  }

  const handleClearPropSet = () => {
    setPropItems([])
    setPropProgressMsg(null)
    propStopRef.current = false
  }

  const handleDownloadPropSheet = async () => {
    try {
      const sheet = await buildPropAtlasDataUrl()
      if (!sheet) {
        setError('Generate at least one prop before downloading the atlas.')
        return
      }
      const baseName = (propPrompt.trim().slice(0, 24) || 'props').replace(
        /[^a-z0-9]+/gi,
        '_'
      )
      const link = document.createElement('a')
      link.href = sheet
      link.download = `${baseName}_props_atlas.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      const json = JSON.stringify(buildPropManifest(), null, 2)
      const jsonUrl = URL.createObjectURL(
        new Blob([json], { type: 'application/json' })
      )
      const linkJson = document.createElement('a')
      linkJson.href = jsonUrl
      linkJson.download = `${baseName}_props_manifest.json`
      document.body.appendChild(linkJson)
      linkJson.click()
      document.body.removeChild(linkJson)
      URL.revokeObjectURL(jsonUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export atlas')
    }
  }

  const handleDownloadPropZip = async () => {
    try {
      const populated = propItems.filter((p) => p.imageUrl)
      if (populated.length === 0) {
        setError('Generate at least one prop before exporting the ZIP.')
        return
      }
      const zip = new JSZip()
      const names = resolvePropNames(populated)
      populated.forEach((p, i) => {
        const base64 = (p.imageUrl as string).split(',')[1]
        if (base64) {
          zip.file(names[i].file, base64, {
            base64: true,
          })
        }
      })
      const sheet = await buildPropAtlasDataUrl()
      if (sheet) {
        const base64 = sheet.split(',')[1]
        if (base64) zip.file('props_atlas.png', base64, { base64: true })
      }
      zip.file('manifest.json', JSON.stringify(buildPropManifest(), null, 2))

      const blob = await zip.generateAsync({ type: 'blob' })
      const baseName = (propPrompt.trim().slice(0, 24) || 'props').replace(
        /[^a-z0-9]+/gi,
        '_'
      )
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${baseName}_props.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export ZIP')
    }
  }

  // ── Sprite-animation mode handlers ────────────────────────────────────────

  /** Switch the active sprite animation. Replaces the current sheet with a
   * fresh empty one for the new animation, but PRESERVES the character
   * anchor so the user can build idle → walk → run → jump → attack for the
   * same character without re-rolling identity. Also resets FPS to the new
   * anim's default. */
  const handleSelectSpriteAnim = (next: SpriteAnimType) => {
    if (next === spriteAnim) return
    if (spriteGenerating) return
    // Persist the current sheet, then restore a previously generated sheet for
    // the target animation if we have one cached (so the user can flip back and
    // forth without losing results). Falls back to a fresh empty sheet.
    spriteSheetCacheRef.current[spriteCacheKey(spriteBodyPlan, spriteAnim)] =
      spriteSheet
    const cached = spriteSheetCacheRef.current[spriteCacheKey(spriteBodyPlan, next)]
    setSpriteAnim(next)
    setSpriteSheet(cached ?? createEmptySpriteSheet(next))
    setSpriteFps(cached?.fps ?? SPRITE_ANIMATIONS[next].defaultFps)
    setSpriteProgressMsg(null)
  }

  /** Switch body plan. Animations, the pose rig, and the anchor identity are
   * all plan-specific, so this resets to the plan's default animation, drops
   * the previous character anchor and cached sheets, and starts clean. */
  const handleSelectBodyPlan = (next: BodyPlan) => {
    if (next === spriteBodyPlan) return
    if (spriteGenerating) return
    const plan = BODY_PLANS[next]
    const nextAnim = plan.defaultAnim
    spriteSheetCacheRef.current = {}
    setSpriteBodyPlan(next)
    setSpriteAnim(nextAnim)
    setSpriteSheet(createEmptySpriteSheet(nextAnim))
    setSpriteFps(SPRITE_ANIMATIONS[nextAnim].defaultFps)
    setSpriteAnchor(null)
    setSpriteProgressMsg(null)
    setError(null)
  }

  /**
   * Internal: generate the character ANCHOR (Pass 1 of the two-pass sprite
   * pipeline). Produces a single 512×512 neutral standing reference of the
   * character on a flat magenta key. Returns both the chroma-keyed
   * thumbnail and the un-keyed magenta version (which is what gets fed
   * back into the sheet pass).
   */
  const runSpriteAnchorPass = async (
    prompt: string
  ): Promise<{ imageUrl: string; rawImageUrl: string }> => {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        width: SPRITE_FRAME_SIZE,
        height: SPRITE_FRAME_SIZE,
        artStyle: artStyle !== 'none' ? artStyle : undefined,
        ...aiRequestConfig(),
        spriteAnchor: true,
        spriteBodyPlan,
        sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401) {
        setApiKeyRequired(true)
        setShowApiKeyModal(true)
      }
      throw new Error(data.error || 'Failed to generate character anchor')
    }
    if (!data.imageUrl) throw new Error('No anchor image returned from API')
    const rawImageUrl: string = data.imageUrl
    const keyedImageUrl = await chromaKeyToAlpha(rawImageUrl)
    return { imageUrl: keyedImageUrl, rawImageUrl }
  }

  /**
   * Internal: generate the SHEET (Pass 2 of the two-pass sprite pipeline).
   *
   * Before calling the API, this builds a STRUCTURAL GUIDE image: a
   * 2048×1024 PNG with the anchor pre-composited into each of the 8 grid
   * cells at pixel-locked position/scale/baseline. The guide is then
   * passed as the reference image, so the model has a concrete spatial
   * template to anchor every frame against — not just a loose character
   * reference. This is the headline fix for position/scale flicker: text
   * directives alone ("same baseline", "same scale") aren't strong
   * enough; the model needs to *see* the layout.
   *
   * Splits the resulting 4×2 grid into 8 cells, chroma-keys each, and
   * returns the processed frames.
   */
  const runSpriteSheetPass = async (
    prompt: string,
    anchorRawUrl: string | null,
    fixNotes?: string
  ): Promise<{
    rawSheetUrl: string
    keyedCells: string[]
    keyedSheetUrl: string | null
  }> => {
    let guideImage: string | undefined
    if (anchorRawUrl) {
      try {
        guideImage = await buildSpriteSheetGuideDataUrl(anchorRawUrl)
      } catch (err) {
        console.warn('Sprite guide build failed; proceeding without it:', err)
      }
    }
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        width: SPRITE_SHEET_W,
        height: SPRITE_SHEET_H,
        artStyle: artStyle !== 'none' ? artStyle : undefined,
        ...aiRequestConfig(),
        spriteSheet: true,
        spriteAnim,
        spriteBodyPlan,
        spriteFrameCount: SPRITE_FRAME_COUNT,
        spriteGridCols: SPRITE_GRID_COLS,
        spriteGridRows: SPRITE_GRID_ROWS,
        spriteFrameSize: SPRITE_FRAME_SIZE,
        spriteGuideImage: guideImage,
        // The pose-map guide carries STRUCTURE (correct per-frame poses);
        // the raw anchor carries IDENTITY (outfit, palette, proportions).
        // Sending both lets the model skin a known character onto a known
        // pose instead of inventing either.
        spritePoseGuide: Boolean(guideImage),
        spriteIdentityImage: anchorRawUrl ?? undefined,
        spriteFixNotes: fixNotes,
        sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401) {
        setApiKeyRequired(true)
        setShowApiKeyModal(true)
      }
      throw new Error(data.error || 'Failed to generate sprite sheet')
    }
    if (!data.imageUrl) throw new Error('No image returned from API')
    const rawSheetUrl: string = data.imageUrl
    const rawCells = await sliceImageGrid(rawSheetUrl, {
      cols: SPRITE_GRID_COLS,
      rows: SPRITE_GRID_ROWS,
      cellSize: SPRITE_FRAME_SIZE,
    })
    const keyedCells = await Promise.all(
      rawCells.map(async (cellUrl) => {
        const keyed = await chromaKeyToAlpha(cellUrl)
        // Strip any dark cell-divider/border line the model painted around the
        // frame. It isn't magenta, so chroma-keying leaves it as a dark square
        // outline; this erases full-span border bands at the cell edges.
        let cleaned = keyed
        try {
          cleaned = await removeFrameBorder(cleaned)
        } catch {
          cleaned = keyed
        }
        // Non-humanoid generations, especially long quadrupeds, can still
        // duplicate/spill across a hidden cell boundary. Keep the main
        // connected creature silhouette and erase detached secondary copies
        // before alignment/playback/export.
        if (spriteBodyPlan !== 'biped') {
          try {
            // Compact bodies (quadruped/blob) can have two creatures fused by a
            // thin bridge; allow morphological splitting for them. Thin subjects
            // (serpent/flyer) must NOT be split or erosion would fragment them.
            const enableSplit =
              spriteBodyPlan === 'quadruped' || spriteBodyPlan === 'blob'
            cleaned = await isolatePrimarySpriteComponent(cleaned, { enableSplit })
          } catch {
            // Keep the prior cleanup if component isolation fails.
          }
        }
        return cleaned
      })
    )

    // Scale normalization — the model redraws the character at a slightly
    // different size in every cell, so the silhouette "breathes" during
    // playback. Rescale each frame toward the median silhouette size BEFORE
    // baseline/horizontal passes re-seat position, so the creature holds one
    // constant scale frame to frame. Runs for every body plan (humanoid too).
    let alignedCells = keyedCells
    try {
      const scaled = await normalizeSpriteFrameScale(keyedCells, {
        tolerance: 0.05,
        maxScaleAdjust: 0.18,
      })
      alignedCells = scaled.cells
      // eslint-disable-next-line no-console
      console.log('[Sprite] Scale normalization:', {
        target: scaled.targetSize,
        sizes: scaled.sizes,
        scales: scaled.scales,
      })
    } catch (err) {
      console.warn('Sprite scale normalization failed; using raw cells:', err)
    }

    // Baseline alignment — pixel-level post-process that kills the remaining
    // y-axis drift the model can't fully suppress. Grounded animations plant
    // every frame on a fixed in-cell ground line; airborne/flying animations
    // anchor their most-grounded pose to that same line and rigidly carry the
    // remaining frames so genuine lifts (jump/run/flight) are preserved.
    try {
      const hasAirborne = isAirborneAnim(spriteBodyPlan, spriteAnim)
      // Fixed in-cell ground line shared by every animation so a walk and a run
      // of the same creature rest on the SAME floor. Grounded anims plant each
      // frame to it; airborne anims anchor their most-grounded pose to it and
      // rigidly carry the rest (preserving the lift).
      const alignment = await alignSpriteFramesToBaseline(alignedCells, {
        groundAll: !hasAirborne,
        targetBaseline: Math.round(SPRITE_FRAME_SIZE * 0.9),
      })
      alignedCells = alignment.cells
      // eslint-disable-next-line no-console
      console.log('[Sprite] Baseline alignment:', {
        target: alignment.targetBaseline,
        detected: alignment.detected,
        shifted: alignment.shifted,
      })
    } catch (err) {
      console.warn('Sprite baseline alignment failed; using raw cells:', err)
    }

    // Horizontal centering — pins each frame's center of mass to the cell
    // center, so the character is centered in-frame and doesn't slide left/
    // right across cells (kills horizontal "in place" drift on walk/run).
    try {
      const centering = await centerSpriteFramesHorizontally(alignedCells, {
        mode: 'cellCenter',
      })
      alignedCells = centering.cells
      // eslint-disable-next-line no-console
      console.log('[Sprite] Horizontal centering:', {
        target: centering.targetCenterX,
        detected: centering.detected,
        shifted: centering.shifted,
      })
    } catch (err) {
      console.warn('Sprite horizontal centering failed; using prior cells:', err)
    }

    const keyedSheetUrl = await composeSpriteGridSheet(alignedCells)
    return { rawSheetUrl, keyedCells: alignedCells, keyedSheetUrl }
  }

  /** Review half of the sprite pipeline — hand the composed sheet (+ the
   * character anchor for identity matching) to the QA art director. Returns
   * null (≈ approve) on any failure so a flaky critic never blocks the user. */
  const fetchSpriteReview = async (
    sheetImage: string | null,
    anchorImage: string | null
  ): Promise<{ ok: boolean; issues: string[]; fix: string } | null> => {
    if (!sheetImage) return null
    try {
      const res = await fetch('/api/sprite-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: spritePrompt.trim() || undefined,
          anim: spriteAnim,
          bodyPlan: spriteBodyPlan,
          sceneBrief: sceneBrief.trim() ? sceneBrief.trim() : undefined,
          ...aiRequestConfig(),
          sheetImage,
          anchorImage: anchorImage || undefined,
        }),
      })
      if (!res.ok) return null
      const data = await res.json()
      if (typeof data?.ok !== 'boolean') return null
      return data
    } catch {
      return null
    }
  }

  /** Deterministic twin/spillover detector. A correct frame is ONE centered
   * figure → its alpha mass profile is a single hump on both axes. When the
   * model paints two characters side-by-side OR lets a creature spill from the
   * row above/below into this sliced cell, the alpha profile splits into two
   * comparable humps with a clear empty valley. We flag only when the second
   * hump carries a substantial fraction of the first hump's mass, so an
   * extended tail/weapon/wing does not trip it. Returns the number of cells
   * that look duplicated or grid-spilled. Best-effort — returns 0 if anything
   * fails. */
  const detectSpriteDuplicateCells = async (cells: string[]): Promise<number> => {
    const W = 100 // downscaled analysis width — fast, plenty for column stats
    const H = 100
    const hasSplitMass = (profile: number[]) => {
      const peak = Math.max(...profile)
      if (peak <= 0) return false
      const occThresh = peak * 0.06
      // Segment occupied runs; only an empty gap at least 5% of the dimension
      // separates two figures (bridges tiny internal gaps between legs/tails).
      const minGap = Math.max(3, Math.round(profile.length * 0.05))
      const segments: { mass: number }[] = []
      let cur: number | null = null
      let gap = 0
      for (let i = 0; i < profile.length; i++) {
        if (profile[i] > occThresh) {
          if (cur === null) {
            segments.push({ mass: 0 })
            cur = segments.length - 1
          }
          segments[cur].mass += profile[i]
          gap = 0
        } else if (cur !== null) {
          gap++
          if (gap >= minGap) cur = null
        }
      }
      if (segments.length < 2) return false
      segments.sort((a, b) => b.mass - a.mass)
      // Two comparable masses ⇒ a real twin / spillover; a limb/tail is smaller.
      return segments[1].mass >= segments[0].mass * 0.45
    }
    const analyze = (url: string): Promise<boolean> =>
      new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            canvas.width = W
            canvas.height = H
            const ctx = canvas.getContext('2d')
            if (!ctx) return resolve(false)
            ctx.clearRect(0, 0, W, H)
            ctx.drawImage(img, 0, 0, W, H)
            const { data } = ctx.getImageData(0, 0, W, H)
            const colMass = new Array<number>(W).fill(0)
            const rowMass = new Array<number>(H).fill(0)
            for (let y = 0; y < H; y++) {
              for (let x = 0; x < W; x++) {
                const alpha = data[(y * W + x) * 4 + 3]
                colMass[x] += alpha
                rowMass[y] += alpha
              }
            }
            resolve(hasSplitMass(colMass) || hasSplitMass(rowMass))
          } catch {
            resolve(false)
          }
        }
        img.onerror = () => resolve(false)
        img.src = url
      })
    try {
      const flags = await Promise.all(cells.map(analyze))
      return flags.filter(Boolean).length
    } catch {
      return 0
    }
  }

  /**
   * Generate the sprite sheet — orchestrates the two-pass anchor → sheet
   * workflow. If an anchor exists (from a previous run or a previous
   * animation type for the same character), the anchor pass is SKIPPED and
   * we re-use the existing reference; otherwise we run anchor pass first.
   *
   * This is the headline frame-consistency fix: by handing the model a
   * concrete visual reference of the character before asking it to paint 8
   * keyframes, the cross-frame identity drift ("flicker") drops sharply.
   * Backed by independent findings from chongdashu/ai-game-spritesheets,
   * Robotic Ape, Auto-Sprite, and the Google Cloud Nano Banana prompting
   * guide — all of 2026.
   */
  const handleGenerateSpriteSheet = async ({
    forceNewAnchor = false,
  }: { forceNewAnchor?: boolean } = {}) => {
    if (spriteGenerating) return
    // An uploaded character supplies the identity, so a text prompt is
    // optional in that case; otherwise we need a description to lock identity.
    const hasUploadedAnchor = !!spriteAnchor?.uploaded
    if (!spritePrompt.trim() && !hasUploadedAnchor) {
      setError('Describe the character you want — e.g. armored pixel knight.')
      return
    }
    if (!ensureCanGenerate()) return
    setError(null)
    spriteStopRef.current = false
    setSpriteGenerating(true)
    const startedAt = Date.now()

    // Prompt sent to the sheet pass. With an uploaded character the appearance
    // comes from the reference image, so fall back to a neutral description.
    const effectivePrompt =
      spritePrompt.trim() || 'the character shown in the reference image'

    // Reset the sheet up front so the UI reads as "fresh generation in
    // progress" while we wait for the API.
    setSpriteSheet((prev) => ({
      ...prev,
      anim: spriteAnim,
      frames: prev.frames.map((f) => ({ ...f, imageUrl: null })),
      gridSheetUrl: null,
      rawGridSheetUrl: null,
      prompt: effectivePrompt,
    }))

    // Anchor pass — needed if:
    //   • No anchor exists yet, OR
    //   • The user explicitly asked to re-roll the character, OR
    //   • The prompt changed since the existing anchor was made.
    // Uploaded anchors are never regenerated from the prompt — the image IS
    // the source of truth for identity.
    const needsNewAnchor =
      forceNewAnchor ||
      !spriteAnchor ||
      (!spriteAnchor.uploaded &&
        spriteAnchor.prompt.trim() !== spritePrompt.trim())

    if (needsNewAnchor) {
      setSpriteAnchor(null)
      // The character is changing, so previously cached animations belong to
      // the old identity — drop them to avoid mixing characters across tabs.
      spriteSheetCacheRef.current = {}
    }

    // Up to this many extra repaint passes after the first sheet, each driven
    // by the QA art director's fix report.
    const MAX_SPRITE_REVIEW_PASSES = 2
    let phaseLabel = needsNewAnchor
      ? 'Locking character (1/2)'
      : 'Painting frames (2/2)'
    const tickHandle = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setSpriteProgressMsg(`${phaseLabel} · ${elapsed}s`)
    }, 1000)

    try {
      let anchorRef = spriteAnchor
      if (needsNewAnchor) {
        const anchorResult = await runSpriteAnchorPass(effectivePrompt)
        if (spriteStopRef.current) return
        anchorRef = {
          imageUrl: anchorResult.imageUrl,
          rawImageUrl: anchorResult.rawImageUrl,
          prompt: effectivePrompt,
        }
        setSpriteAnchor(anchorRef)
      }

      // Pass 2 with a QA loop: paint the sheet, hand it (and the locked anchor)
      // to the art director, and repaint with its fix report if it flags
      // identity flicker / scale / anatomy / fringe problems. The anchor
      // identity is reused on every repaint so the character stays on-model.
      // The frames stay in their loading state through review/repaint so the
      // sheet visibly shows it's still working.
      phaseLabel = 'Painting frames (2/2)'
      let sheetResult = await runSpriteSheetPass(
        effectivePrompt,
        anchorRef?.rawImageUrl ?? null
      )
      if (spriteStopRef.current) return

      let fixNotes: string | undefined
      for (let pass = 0; pass < MAX_SPRITE_REVIEW_PASSES; pass++) {
        phaseLabel = 'Checking frames'
        setSpriteProgressMsg('Checking frames…')

        // The art-director vision review is intentionally DISABLED for all
        // sprite generations, on every AI model. We keep only the cheap,
        // deterministic twin/spillover check (no extra model call) to catch
        // duplicate creatures and trigger a repaint.
        const [twinCount, review] = await Promise.all([
          detectSpriteDuplicateCells(sheetResult.keyedCells),
          Promise.resolve(null as Awaited<ReturnType<typeof fetchSpriteReview>>),
        ])
        if (spriteStopRef.current) return

        const visionBad = !!review && !review.ok
        if (twinCount === 0 && !visionBad) {
          if (debugMode && review) {
            // eslint-disable-next-line no-console
            console.log('🎭 QA approved the sprite sheet')
          }
          break
        }

        const dupNote =
          twinCount > 0
            ? `CRITICAL DEFECT: ${twinCount} cell(s) contain duplicate/spillover creatures: either two copies in one cell, or a full creature plus a cropped partial creature/body part from a neighbouring row/column. Paint EXACTLY ONE single character per ${SPRITE_FRAME_SIZE}×${SPRITE_FRAME_SIZE} cell, centered and scaled down with a clear magenta gutter; no head, tail, wing, leg, body, fur, shadow, or motion shape may cross a hidden cell boundary. This is the highest-priority fix. `
            : ''
        const visionNote = visionBad
          ? review!.fix || review!.issues.join('; ')
          : ''
        fixNotes = (dupNote + visionNote).trim()
        if (!fixNotes) break // nothing actionable — accept.
        if (debugMode) {
          // eslint-disable-next-line no-console
          console.log(
            `🎭 QA rejected (twins: ${twinCount}), repainting with notes:`,
            fixNotes
          )
        }

        phaseLabel = `Repainting frames (pass ${pass + 2})`
        setSpriteProgressMsg(
          twinCount > 0 ? 'Duplicate/spillover found — repainting…' : 'Issues found — repainting…'
        )
        sheetResult = await runSpriteSheetPass(
          effectivePrompt,
          anchorRef?.rawImageUrl ?? null,
          fixNotes
        )
        if (spriteStopRef.current) return
      }

      setSpriteSheet((prev) => ({
        ...prev,
        anim: spriteAnim,
        frames: sheetResult.keyedCells.map((url, i) => ({
          index: i,
          imageUrl: url,
        })),
        gridSheetUrl: sheetResult.keyedSheetUrl,
        rawGridSheetUrl: sheetResult.rawSheetUrl,
        prompt: effectivePrompt,
        fps: spriteFps,
      }))
    } catch (err) {
      setSpriteSheet((prev) => ({
        ...prev,
        frames: prev.frames.map((f) => ({ ...f, imageUrl: null })),
      }))
      setError(
        err instanceof Error ? err.message : 'Failed to generate sprite sheet'
      )
    } finally {
      clearInterval(tickHandle)
      setSpriteGenerating(false)
      setSpriteProgressMsg(null)
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      // eslint-disable-next-line no-console
      if (debugMode) console.log(`🎭 Sprite sheet generated in ${elapsed}s`)
    }
  }

  /** Discard the current anchor + sheet and re-run the full two-pass
   * pipeline. Use this when you want a completely fresh character (vs.
   * keeping the same character and only re-rolling poses for the current
   * animation, which is what the main "Generate" button does). */
  const handleRerollSpriteCharacter = () => {
    if (spriteGenerating) return
    handleGenerateSpriteSheet({ forceNewAnchor: true })
  }

  /**
   * Turn an arbitrary uploaded character image into a sprite anchor that
   * matches what the generation pass produces: the subject is contained inside
   * a single SPRITE_FRAME_SIZE cell, bottom-aligned with margin, on a magenta
   * background (the AI reads magenta as background more reliably than alpha).
   * Returns both the magenta version (for the AI) and a chroma-keyed,
   * transparent version (for display).
   */
  const buildSpriteAnchorFromUpload = async (
    rawDataUrl: string
  ): Promise<{ imageUrl: string; rawImageUrl: string }> => {
    // Strip any baked-in checkerboard / solid backdrop first (no-op for assets
    // that already have real transparency) so it doesn't get composited as art.
    let dataUrl = rawDataUrl
    try {
      dataUrl = await removeUploadedBackground(rawDataUrl)
    } catch {
      dataUrl = rawDataUrl
    }
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = async () => {
        try {
          const S = SPRITE_FRAME_SIZE
          const canvas = document.createElement('canvas')
          canvas.width = S
          canvas.height = S
          const ctx = canvas.getContext('2d')
          if (!ctx) return reject(new Error('Canvas unavailable'))
          // Magenta backdrop — transparent areas of the upload become magenta,
          // exactly like a generated anchor.
          ctx.fillStyle = '#FF00FF'
          ctx.fillRect(0, 0, S, S)
          // Contain the character with margin, feet near the bottom (~94%).
          const maxW = S * 0.84
          const maxH = S * 0.9
          const scale = Math.min(maxW / img.width, maxH / img.height)
          const dw = img.width * scale
          const dh = img.height * scale
          const dx = (S - dw) / 2
          const dy = S * 0.95 - dh
          ctx.imageSmoothingEnabled = true
          ctx.drawImage(img, dx, dy, dw, dh)
          const rawImageUrl = canvas.toDataURL('image/png')
          const imageUrl = await chromaKeyToAlpha(rawImageUrl)
          resolve({ imageUrl, rawImageUrl })
        } catch (err) {
          reject(err)
        }
      }
      img.onerror = () => reject(new Error('Could not load the uploaded image'))
      img.src = dataUrl
    })
  }

  /** Accept a user-supplied character image and lock it in as the anchor so the
   * sheet pass animates THAT character instead of generating a new one. */
  const handleUploadSpriteCharacter = async (file: File) => {
    if (spriteGenerating) return
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (PNG with transparency works best).')
      return
    }
    setError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Failed to read the file'))
        reader.readAsDataURL(file)
      })
      const { imageUrl, rawImageUrl } = await buildSpriteAnchorFromUpload(dataUrl)
      // A new character → drop cached animations from the previous one and
      // clear the current sheet so the user starts clean.
      spriteSheetCacheRef.current = {}
      setSpriteAnchor({
        imageUrl,
        rawImageUrl,
        prompt: spritePrompt.trim() || 'Uploaded character',
        uploaded: true,
      })
      setSpriteSheet(createEmptySpriteSheet(spriteAnim))
      setSpriteProgressMsg(null)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to process the uploaded character image'
      )
    }
  }

  /** Remove the uploaded character so the user can switch back to a starter
   * preset or their own prompt. Keeps the typed prompt intact; drops the
   * anchor, the orphaned cached animations, and the current sheet. */
  const handleRemoveUploadedCharacter = () => {
    if (spriteGenerating) return
    spriteSheetCacheRef.current = {}
    setSpriteAnchor(null)
    setSpriteSheet(createEmptySpriteSheet(spriteAnim))
    setSpriteProgressMsg(null)
    setError(null)
  }

  const handleStopSpriteSheet = () => {
    spriteStopRef.current = true
  }

  /** Toggle a single frame's excluded state. Excluded frames are dropped from
   * playback and from every export (grid, strip, per-frame ZIP, manifest). */
  const handleToggleSpriteFrame = (index: number) => {
    setSpriteSheet((prev) => ({
      ...prev,
      frames: prev.frames.map((f) =>
        f.index === index && f.imageUrl
          ? { ...f, disabled: !f.disabled }
          : f
      ),
    }))
  }

  const handleClearSpriteSheet = () => {
    spriteSheetCacheRef.current = {}
    setSpriteSheet(createEmptySpriteSheet(spriteAnim))
    setSpriteAnchor(null)
    setSpritePrompt('')
    setSpriteProgressMsg(null)
    setSpriteFps(SPRITE_ANIMATIONS[spriteAnim].defaultFps)
    spriteStopRef.current = false
    setError(null)
  }

  /**
   * Build the POSE-MAP GUIDE that's fed to the sheet-generation pass.
   *
   * The old approach stamped the SAME neutral anchor into all 8 cells and
   * begged the model (in text) to "ignore that pose and do the walk cycle
   * instead." That fails: a diffusion model obeys an image guide far more
   * strongly than text, so the dominant signal said "stand still" in every
   * cell and the model copied neutral or drifted into random leg phases.
   *
   * The new approach renders a deterministic skeletal MANNEQUIN per frame
   * (see utils/poseRig) in the exact, biomechanically-correct pose that
   * frame must hold — a from-scratch ControlNet/OpenPose-style pose map.
   * The motion is now guaranteed correct by code; the model only has to
   * skin the character onto each pose. Identity/appearance is supplied
   * separately via the raw anchor image (see runSpriteSheetPass), so the
   * model gets "what the character looks like" + "what pose to hold."
   *
   * We measure the anchor's bounding box so the mannequin matches the
   * character's height, horizontal center, and foot baseline — keeping the
   * pose map aligned with the identity reference and the downstream
   * baseline-alignment pass.
   */
  const buildSpriteSheetGuideDataUrl = async (
    anchorRawImageUrl: string
  ): Promise<string> => {
    const subject = await measureAnchorSubject(anchorRawImageUrl)
    const canvas = document.createElement('canvas')
    canvas.width = SPRITE_SHEET_W
    canvas.height = SPRITE_SHEET_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to create sprite-guide canvas')
    ctx.imageSmoothingEnabled = true
    drawPoseGuideSheet(ctx, {
      anim: spriteAnim,
      bodyPlan: spriteBodyPlan,
      cols: SPRITE_GRID_COLS,
      rows: SPRITE_GRID_ROWS,
      cellSize: SPRITE_FRAME_SIZE,
      frameCount: SPRITE_FRAME_COUNT,
      subject,
    })
    return canvas.toDataURL('image/png')
  }

  /**
   * Measure where the character sits inside a single anchor cell (height,
   * horizontal center, foot baseline) so the rendered pose mannequin matches
   * the character's body plan. Falls back to sensible defaults if the anchor
   * can't be measured (e.g. solid/empty frame).
   */
  const measureAnchorSubject = async (
    anchorRawImageUrl: string
  ): Promise<SubjectBounds> => {
    const fallback: SubjectBounds = {
      height: Math.round(SPRITE_FRAME_SIZE * 0.78),
      centerX: SPRITE_FRAME_SIZE / 2,
      baseline: Math.round(SPRITE_FRAME_SIZE * 0.92),
    }
    try {
      return await new Promise<SubjectBounds>((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = SPRITE_FRAME_SIZE
          c.height = SPRITE_FRAME_SIZE
          const cx = c.getContext('2d')
          if (!cx) return resolve(fallback)
          cx.drawImage(img, 0, 0, SPRITE_FRAME_SIZE, SPRITE_FRAME_SIZE)
          const { data } = cx.getImageData(
            0,
            0,
            SPRITE_FRAME_SIZE,
            SPRITE_FRAME_SIZE
          )
          const measured = measureSubjectBounds(
            data,
            SPRITE_FRAME_SIZE,
            SPRITE_FRAME_SIZE
          )
          resolve(measured ?? fallback)
        }
        img.onerror = () => resolve(fallback)
        img.src = anchorRawImageUrl
      })
    } catch {
      return fallback
    }
  }

  /** Stitch keyed cells into a 4×2 grid PNG. Used for manifest export. */
  const composeSpriteGridSheet = async (
    cells: string[]
  ): Promise<string | null> => {
    if (cells.length === 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = SPRITE_SHEET_W
    canvas.height = SPRITE_SHEET_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    await Promise.all(
      cells.map(
        (url, i) =>
          new Promise<void>((resolve, reject) => {
            const r = Math.floor(i / SPRITE_GRID_COLS)
            const c = i % SPRITE_GRID_COLS
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(
                img,
                c * SPRITE_FRAME_SIZE,
                r * SPRITE_FRAME_SIZE,
                SPRITE_FRAME_SIZE,
                SPRITE_FRAME_SIZE
              )
              resolve()
            }
            img.onerror = () => reject(new Error(`Failed to load sprite frame ${i}`))
            img.src = url
          })
      )
    )
    return canvas.toDataURL('image/png')
  }

  /** Stitch keyed cells into a single horizontal strip (1 row × N frames).
   * Most 2D engines (Phaser, Unity 2D, Godot, Defold) prefer this layout. */
  const composeSpriteStripSheet = async (
    cells: string[]
  ): Promise<string | null> => {
    if (cells.length === 0) return null
    const canvas = document.createElement('canvas')
    // Size to the number of frames actually being exported so excluded frames
    // don't leave transparent gaps on the right of the strip.
    canvas.width = cells.length * SPRITE_FRAME_SIZE
    canvas.height = SPRITE_STRIP_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    await Promise.all(
      cells.map(
        (url, i) =>
          new Promise<void>((resolve, reject) => {
            const img = new Image()
            img.onload = () => {
              ctx.drawImage(
                img,
                i * SPRITE_FRAME_SIZE,
                0,
                SPRITE_FRAME_SIZE,
                SPRITE_FRAME_SIZE
              )
              resolve()
            }
            img.onerror = () => reject(new Error(`Failed to load sprite frame ${i}`))
            img.src = url
          })
      )
    )
    return canvas.toDataURL('image/png')
  }

  /** Engine-friendly manifest describing both grid and strip layouts plus
   * per-frame timing data so importers can wire up an Animation directly. */
  // `activeFrames` are the kept (non-excluded) frames. They are repacked
  // contiguously in row-major order, so the manifest coordinates describe the
  // EXPORTED sheets (which also only contain the kept frames) rather than the
  // original 8-cell layout. `sourceIndex` preserves the original slot for
  // reference.
  const buildSpriteManifest = (activeFrames: SpriteFrame[]) => {
    const spec = SPRITE_ANIMATIONS[spriteAnim]
    const count = activeFrames.length
    const stripCols = Math.max(1, count)
    return {
      version: 1,
      bodyPlan: spriteBodyPlan,
      bodyPlanLabel: BODY_PLANS[spriteBodyPlan].label,
      anim: spriteAnim,
      label: spec.label,
      frameCount: count,
      frameSize: SPRITE_FRAME_SIZE,
      fps: spriteFps,
      frameDurationMs: Math.round(1000 / spriteFps),
      loop: spec.loop,
      grid: {
        fileName: 'sheet.png',
        cols: SPRITE_GRID_COLS,
        rows: SPRITE_GRID_ROWS,
        sheetWidth: SPRITE_SHEET_W,
        sheetHeight: SPRITE_SHEET_H,
      },
      strip: {
        fileName: 'strip.png',
        cols: stripCols,
        rows: 1,
        sheetWidth: stripCols * SPRITE_FRAME_SIZE,
        sheetHeight: SPRITE_STRIP_H,
      },
      prompt: spriteSheet.prompt || spritePrompt,
      sceneBrief: sceneBrief.trim() || null,
      artStyle: artStyle !== 'none' ? artStyle : null,
      frames: activeFrames.map((f, i) => ({
        index: i,
        sourceIndex: f.index,
        fileName: `frame_${String(i + 1).padStart(2, '0')}.png`,
        gridCol: i % SPRITE_GRID_COLS,
        gridRow: Math.floor(i / SPRITE_GRID_COLS),
        gridX: (i % SPRITE_GRID_COLS) * SPRITE_FRAME_SIZE,
        gridY: Math.floor(i / SPRITE_GRID_COLS) * SPRITE_FRAME_SIZE,
        stripX: i * SPRITE_FRAME_SIZE,
        stripY: 0,
      })),
    }
  }

  const handleDownloadSpriteSheet = async () => {
    try {
      const populated = spriteSheet.frames.filter(
        (f) => !!f.imageUrl && !f.disabled
      )
      if (populated.length === 0) {
        setError(
          spriteSheet.frames.some((f) => !!f.imageUrl)
            ? 'All frames are excluded — click a frame to include it before downloading.'
            : 'Generate the sheet before downloading.'
        )
        return
      }
      const cellUrls = populated.map((f) => f.imageUrl as string)
      // Always recompose from the kept cells (cached gridSheetUrl still
      // contains excluded frames).
      const grid = await composeSpriteGridSheet(cellUrls)
      const strip = await composeSpriteStripSheet(cellUrls)
      const baseName = `${spriteAnim}_${(
        spritePrompt.trim().slice(0, 24) || 'sprite'
      ).replace(/[^a-z0-9]+/gi, '_')}`

      if (grid) {
        const link = document.createElement('a')
        link.href = grid
        link.download = `${baseName}_grid_${SPRITE_SHEET_W}x${SPRITE_SHEET_H}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
      if (strip) {
        const link = document.createElement('a')
        link.href = strip
        link.download = `${baseName}_strip_${SPRITE_STRIP_W}x${SPRITE_STRIP_H}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
      // Manifest as sidecar JSON.
      const json = JSON.stringify(buildSpriteManifest(populated), null, 2)
      const jsonUrl = URL.createObjectURL(
        new Blob([json], { type: 'application/json' })
      )
      const linkJson = document.createElement('a')
      linkJson.href = jsonUrl
      linkJson.download = `${baseName}_manifest.json`
      document.body.appendChild(linkJson)
      linkJson.click()
      document.body.removeChild(linkJson)
      URL.revokeObjectURL(jsonUrl)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to export sprite sheet'
      )
    }
  }

  const handleDownloadSpriteZip = async () => {
    try {
      const populated = spriteSheet.frames.filter(
        (f) => !!f.imageUrl && !f.disabled
      )
      if (populated.length === 0) {
        setError(
          spriteSheet.frames.some((f) => !!f.imageUrl)
            ? 'All frames are excluded — click a frame to include it before exporting.'
            : 'Generate the sheet before exporting the ZIP.'
        )
        return
      }
      const cellUrls = populated.map((f) => f.imageUrl as string)
      const zip = new JSZip()
      // Per-frame PNGs (engines that prefer one file per frame). Reindexed to
      // contiguous positions so filenames match the repacked manifest/strip.
      populated.forEach((f, i) => {
        if (!f.imageUrl) return
        const base64 = f.imageUrl.split(',')[1]
        if (base64) {
          const name = `frame_${String(i + 1).padStart(2, '0')}.png`
          zip.file(name, base64, { base64: true })
        }
      })
      // Combined grid sheet (recomposed from kept cells).
      const grid = await composeSpriteGridSheet(cellUrls)
      if (grid) {
        const b64 = grid.split(',')[1]
        if (b64) zip.file('sheet.png', b64, { base64: true })
      }
      // Horizontal strip for engines that want one row.
      const strip = await composeSpriteStripSheet(cellUrls)
      if (strip) {
        const b64 = strip.split(',')[1]
        if (b64) zip.file('strip.png', b64, { base64: true })
      }
      zip.file(
        'manifest.json',
        JSON.stringify(buildSpriteManifest(populated), null, 2)
      )

      const blob = await zip.generateAsync({ type: 'blob' })
      const baseName = `${spriteAnim}_${(
        spritePrompt.trim().slice(0, 24) || 'sprite'
      ).replace(/[^a-z0-9]+/gi, '_')}`
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${baseName}_sprite.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export ZIP')
    }
  }

  // ── Parallax: extend-to-target loop, full-image download, tile export ─────

  /**
   * Auto-extend rightward, accepting the best variant each time, until the
   * image reaches `parallaxTargetWidth` (or the safety cap). Skips the
   * normal candidate-review UI — the user sets a goal and walks away.
   */
  const handleAutoExtend = async () => {
    if (loading || parallaxAutoExtending) return
    if (!ensureCanGenerate()) return
    if (!parallaxTargetWidth) return

    // Resolve the right source/role/dims based on mode. In parallax mode
    // we operate on the active layer's raw image; in extender mode on the
    // global selectedImage.
    const { sourceImage, layerRole } = resolveExtendSource()
    if (!sourceImage) return
    const startDims =
      mode === 'parallax' && activeLayer && activeLayer.width && activeLayer.height
        ? { width: activeLayer.width, height: activeLayer.height }
        : currentImageDimensions
    if (!startDims) return
    if (startDims.width >= parallaxTargetWidth) return

    setError(null)
    parallaxAutoStopRef.current = false
    setParallaxAutoExtending(true)
    setActiveDirection('right')
    setImageBeforeExtension(sourceImage)
    setLastExtensionParams({ direction: 'right', customPrompt, artStyle, layerRole })
    setExtendedCandidates([])
    setCandidateDims([])
    setSelectedCandidateIdx(0)

    let currentSource = sourceImage
    let currentDims = { ...startDims }
    let stepCount = 0

    try {
      while (
        currentDims.width < parallaxTargetWidth &&
        stepCount < PARALLAX_MAX_AUTO_STEPS &&
        !parallaxAutoStopRef.current
      ) {
        stepCount++
        setLoading(true)
        setProgressMsg(
          `Auto step ${stepCount} · ${currentDims.width} → ${parallaxTargetWidth}px`
        )

        const candidates = await runExtend(
          'right',
          currentSource,
          customPrompt,
          artStyle,
          layerRole
        )
        if (parallaxAutoStopRef.current) break
        const best = candidates[0]

        // The next loop iteration must feed the un-keyed magenta image back
        // into the model for keyed layers; for sky / extender mode, raw and
        // display are the same.
        const nextSource = best.rawImageUrl ?? best.imageUrl
        currentSource = nextSource
        const newDims = await getImageDimensions(best.imageUrl)
        currentDims = newDims

        if (mode === 'parallax') {
          patchActiveLayer({
            imageUrl: best.imageUrl,
            rawImageUrl: nextSource,
            width: newDims.width,
            height: newDims.height,
          })
        } else {
          setSelectedImage(best.imageUrl)
          setCurrentImageDimensions(newDims)
        }
        setLoading(false)
      }
    } catch (err) {
      const e = err as Error & { status?: number }
      setError(e.message || 'Auto-extend failed')
      if (e.status === 401) {
        setApiKeyRequired(true)
        setShowApiKeyModal(true)
      }
    } finally {
      setLoading(false)
      setActiveDirection(null)
      setProgressMsg(null)
      setParallaxAutoExtending(false)
      parallaxAutoStopRef.current = false
    }

    // Make the freshly-extended layer tileable so the renderer's repeat-x
    // doesn't show a hard discontinuity at the loop point. This is the most
    // common pain in parallax workflows — the AI generates a beautiful
    // continuous strip, but its left and right edges were never asked to
    // match each other, so games that tile the texture see a seam every W
    // pixels. Auto-applying here means the default output Just Works.
    // (Manual `Harmonize` is still available for the separate "panel
    // banding from cumulative AI drift" issue.)
    if (mode === 'parallax' && !parallaxAutoStopRef.current) {
      try {
        setLoading(true)
        setProgressMsg('Closing the loop…')
        await makeLayerTileableByIdx(parallaxActiveIdx)
      } catch {
        // Non-fatal — leave the un-tiled result in place.
      } finally {
        setLoading(false)
        setProgressMsg(null)
      }
    }
  }

  const handleStopAutoExtend = () => {
    parallaxAutoStopRef.current = true
    setProgressMsg('Stopping after this step…')
  }

  /**
   * Open the text-to-image generator. In parallax mode, pre-fill the
   * role-specific default dimensions so the user doesn't have to think
   * about it: Sky is taller (covers the whole sky-to-horizon band), keyed
   * layers (Far / Mid / Near) are shorter (they only need to cover the
   * band their elements sit in). Same-role re-generations match the
   * existing layer's exact dimensions so a regenerate never changes
   * the canvas size. Prompt is seeded with a role-specific scaffold.
   */
  const openGenerateModal = () => {
    if (mode === 'parallax' && activeLayer) {
      const spec = LAYER_ROLES[activeLayer.role]
      // If the SAME layer already has dimensions (e.g. user is regenerating
      // after extending), keep them so the regenerate is a drop-in replacement.
      if (activeLayer.width && activeLayer.height) {
        setGenerateWidth(activeLayer.width)
        setGenerateHeight(activeLayer.height)
      } else {
        setGenerateWidth(spec.defaultWidth)
        setGenerateHeight(spec.defaultHeight)
      }
      if (!generatePrompt.trim()) {
        setGeneratePrompt(spec.defaultPrompt)
      }
    }
    setShowGenerateModal(true)
  }

  /**
   * Download the active layer's PNG (or, in extender mode, the current
   * canvas). In parallax mode this respects the layer's keyed alpha.
   */
  const handleDownloadFull = () => {
    if (mode === 'parallax') {
      const layer = activeLayer
      if (!layer || !layer.imageUrl) return
      const link = document.createElement('a')
      link.href = layer.imageUrl
      const w = layer.width ?? 0
      const h = layer.height ?? 0
      link.download = `parallax_${layer.role}_${w}x${h}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      return
    }
    const target = activeCandidate?.imageUrl ?? selectedImage
    const dims = activeCandidate
      ? candidateDims[selectedCandidateIdx] ?? null
      : currentImageDimensions
    if (!target || !dims) return
    const link = document.createElement('a')
    link.href = target
    const baseName = originalFileName.replace(/\.[^/.]+$/, '') || 'parallax'
    link.download = `${baseName}_${dims.width}x${dims.height}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  /**
   * Export the entire parallax project as a ZIP: one PNG per populated
   * layer plus a `parallax.json` manifest describing depth order, scroll
   * speeds, and dimensions. The manifest is engine-friendly so Unity /
   * Godot / Phaser users can wire it straight into a parallax controller.
   */
  const handleExportZip = async () => {
    const populated = parallaxLayers.filter((l) => l.imageUrl)
    if (populated.length === 0) {
      setError('No layers to export. Generate or upload at least one layer first.')
      return
    }
    setProgressMsg('Packaging ZIP…')
    try {
      const zip = new JSZip()
      const manifest: {
        version: number
        createdAt: string
        sceneBrief?: string
        layers: {
          role: LayerRole
          file: string
          width: number | null
          height: number | null
          scrollSpeed: number
          opaque: boolean
        }[]
      } = {
        version: 1,
        createdAt: new Date().toISOString(),
        ...(sceneBrief.trim() ? { sceneBrief: sceneBrief.trim() } : {}),
        layers: [],
      }
      for (const layer of parallaxLayers) {
        if (!layer.imageUrl) continue
        const filename = `${layer.role}.png`
        const dataUrl = layer.imageUrl
        const base64 = dataUrl.split(',')[1] ?? ''
        zip.file(filename, base64, { base64: true })
        manifest.layers.push({
          role: layer.role,
          file: filename,
          width: layer.width,
          height: layer.height,
          scrollSpeed: layer.scrollSpeed,
          opaque: LAYER_ROLES[layer.role].isOpaque,
        })
      }
      zip.file('parallax.json', JSON.stringify(manifest, null, 2))
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `parallax_project_${Date.now()}.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      // Revoke the blob URL on the next tick so the click has fired.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build ZIP')
    } finally {
      setProgressMsg(null)
    }
  }

  /**
   * Run the horizontal-seam harmonizer on a single parallax layer (or on the
   * extender canvas) and write the result back. For sky / extender images
   * we operate on the displayable image directly. For keyed layers we have
   * to work on the un-keyed magenta source — otherwise alpha=0 regions
   * dominate the column means, the magenta itself drifts, or both. After
   * harmonizing the raw we re-apply chroma-keying for the displayable copy.
   */
  const harmonizeLayerByIdx = useCallback(
    async (idx: number, strength = 0.85) => {
      const layer = parallaxLayers[idx]
      if (!layer || !layer.imageUrl) return
      const isKeyed = !LAYER_ROLES[layer.role].isOpaque
      if (isKeyed && layer.rawImageUrl) {
        const harmonizedRaw = await harmonizeHorizontalSeams(
          layer.rawImageUrl,
          {
            strength,
            ignoreKeyColor: { r: 255, g: 0, b: 255, threshold: 80 },
          }
        )
        const harmonizedDisplay = await chromaKeyToAlpha(harmonizedRaw)
        setParallaxLayers((prev) =>
          prev.map((l, i) =>
            i === idx
              ? { ...l, imageUrl: harmonizedDisplay, rawImageUrl: harmonizedRaw }
              : l
          )
        )
      } else {
        const harmonized = await harmonizeHorizontalSeams(layer.imageUrl, {
          strength,
        })
        setParallaxLayers((prev) =>
          prev.map((l, i) =>
            i === idx
              ? { ...l, imageUrl: harmonized, rawImageUrl: harmonized }
              : l
          )
        )
      }
    },
    [parallaxLayers]
  )

  /**
   * User-triggered harmonize for the active parallax layer. Surfaces a
   * progress pill while running because the column-mean pass can take a
   * couple of seconds on long backgrounds.
   */
  const handleHarmonizeActiveLayer = async () => {
    if (mode !== 'parallax') return
    if (loading || parallaxAutoExtending) return
    const layer = parallaxLayers[parallaxActiveIdx]
    if (!layer || !layer.imageUrl) return
    setError(null)
    setLoading(true)
    setProgressMsg('Harmonizing seams…')
    try {
      await harmonizeLayerByIdx(parallaxActiveIdx)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to harmonize')
    } finally {
      setLoading(false)
      setProgressMsg(null)
    }
  }

  /**
   * Turn the active layer's image into a horizontally tileable texture so
   * `repeat-x` doesn't show a hard discontinuity at the loop point. For
   * keyed layers we operate on the un-keyed magenta source and re-key for
   * display (otherwise the magenta key would get tinted at the seam strip).
   */
  const makeLayerTileableByIdx = useCallback(
    async (idx: number) => {
      const layer = parallaxLayers[idx]
      if (!layer || !layer.imageUrl) return
      const isKeyed = !LAYER_ROLES[layer.role].isOpaque
      if (isKeyed && layer.rawImageUrl) {
        const tileableRaw = await makeHorizontallyTileable(
          layer.rawImageUrl,
          {
            ignoreKeyColor: { r: 255, g: 0, b: 255, threshold: 80 },
          }
        )
        const tileableDisplay = await chromaKeyToAlpha(tileableRaw)
        setParallaxLayers((prev) =>
          prev.map((l, i) =>
            i === idx
              ? { ...l, imageUrl: tileableDisplay, rawImageUrl: tileableRaw }
              : l
          )
        )
      } else {
        const tileable = await makeHorizontallyTileable(layer.imageUrl)
        setParallaxLayers((prev) =>
          prev.map((l, i) =>
            i === idx
              ? { ...l, imageUrl: tileable, rawImageUrl: tileable }
              : l
          )
        )
      }
    },
    [parallaxLayers]
  )

  const handleMakeActiveLayerTileable = async () => {
    if (mode !== 'parallax') return
    if (loading || parallaxAutoExtending) return
    const layer = parallaxLayers[parallaxActiveIdx]
    if (!layer || !layer.imageUrl) return
    setError(null)
    setLoading(true)
    setProgressMsg('Making tileable…')
    try {
      await makeLayerTileableByIdx(parallaxActiveIdx)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to make tileable')
    } finally {
      setLoading(false)
      setProgressMsg(null)
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      // In parallax mode the active "image" is the active layer; in extender
      // mode it's the global selectedImage.
      const sourceAvailable =
        mode === 'parallax' ? !!activeLayer?.imageUrl : !!selectedImage
      if (!sourceAvailable || loading || parallaxAutoExtending) return
      if (activeCandidate) {
        if (e.key === 'Enter') handleAccept()
        else if (e.key === 'Escape') handleDiscard()
        else if (e.key === 'r' || e.key === 'R') handleRegenerate()
        else if (e.key === 'ArrowLeft' && extendedCandidates.length > 1) {
          e.preventDefault()
          cycleVariant(-1)
        } else if (e.key === 'ArrowRight' && extendedCandidates.length > 1) {
          e.preventDefault()
          cycleVariant(1)
        }
        return
      }
      // In parallax mode, only horizontal extends are meaningful — up/down
      // would warp the locked game height. Silently ignore them so users
      // don't accidentally break their parallax aspect ratio.
      const mapping: Record<string, Direction> = mode === 'parallax'
        ? { ArrowLeft: 'left', ArrowRight: 'right' }
        : {
            ArrowUp: 'up',
            ArrowDown: 'down',
            ArrowLeft: 'left',
            ArrowRight: 'right',
          }
      const dir = mapping[e.key]
      if (dir) {
        e.preventDefault()
        handleExtend(dir)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedImage,
    loading,
    activeCandidate,
    extendedCandidates.length,
    customPrompt,
    artStyle,
    mode,
    parallaxAutoExtending,
    activeLayer,
  ])

  // ── Render ─────────────────────────────────────────────────────────────────

  const displayImage = activeCandidate?.imageUrl ?? selectedImage
  const displayDimensions = activeCandidate
    ? candidateDims[selectedCandidateIdx] ?? null
    : currentImageDimensions
  const isResult = !!activeCandidate
  const variantCount = extendedCandidates.length

  const isParallax = mode === 'parallax'
  const isTile = mode === 'tile'
  const isSprite = mode === 'sprite'
  const isProps = mode === 'props'

  const variantSelectorEl =
    isResult && variantCount > 1 ? (
      <VariantSelector
        index={selectedCandidateIdx}
        total={variantCount}
        isBest={selectedCandidateIdx === 0}
        score={debugMode ? activeCandidate?.score : undefined}
        onPrev={() => cycleVariant(-1)}
        onNext={() => cycleVariant(1)}
      />
    ) : undefined

  const resultActionsEl = isResult ? (
    <ResultActions
      onAccept={handleAccept}
      onRegenerate={handleRegenerate}
      onDiscard={handleDiscard}
      onDownload={handleDownload}
      loading={loading}
    />
  ) : undefined

  // Parallax mode: the studio's "edit target" is the active layer's image.
  // We compute the display image / dimensions for the active layer (or the
  // current candidate when reviewing) so the rest of the render can stay
  // mode-agnostic where possible.
  const parallaxActiveImage = isParallax
    ? activeCandidate?.imageUrl ?? activeLayer?.imageUrl ?? null
    : null
  const parallaxActiveDims = isParallax
    ? activeCandidate
      ? candidateDims[selectedCandidateIdx] ??
        (activeLayer && activeLayer.width && activeLayer.height
          ? { width: activeLayer.width, height: activeLayer.height }
          : null)
      : activeLayer && activeLayer.width && activeLayer.height
        ? { width: activeLayer.width, height: activeLayer.height }
        : null
    : null

  // Whether ANY layer in parallax mode has been populated. Drives the TopBar
  // "New image" affordance — there's no point offering to discard if the
  // project is already empty.
  const hasAnyParallaxImage = parallaxLayers.some((l) => !!l.imageUrl)
  const hasAnchorLayer = parallaxLayers.some(
    (l) => l.role === WORKFLOW_ORDER[0] && !!l.imageUrl
  )
  const showSceneDirection =
    isParallax &&
    (hasAnchorLayer || !!sceneBrief.trim() || sceneBriefLoading)

  return (
    <main className="relative flex min-h-screen flex-col">
      <TopBar
        hasImage={
          isParallax
            ? hasAnyParallaxImage
            : isTile
              ? tileSet.some((s) => s.hasImage)
              : isProps
                ? propItems.some((p) => !!p.imageUrl)
                : isSprite
                  ? spriteSheet.frames.some((f) => !!f.imageUrl)
                  : !!selectedImage
        }
        mode={mode}
        setMode={setMode}
        onNewImage={handleNewImage}
        onShowSettings={() => setShowSettings(true)}
      />

      {isProps ? (
        <PropStudio
          items={propItems}
          batchSize={PROP_BATCH}
          prompt={propPrompt}
          setPrompt={setPropPrompt}
          artStyle={artStyle}
          setArtStyle={setArtStyle}
          generating={propSetGenerating}
          progressMessage={propProgressMsg}
          sceneBrief={sceneBrief}
          setSceneBrief={setSceneBrief}
          sceneBriefLoading={sceneBriefLoading}
          onAddMore={handleAddPropBatch}
          onStop={handleStopPropSet}
          onRegenerate={handleRegenerateProp}
          onDelete={handleDeleteProp}
          onClearAll={handleClearPropSet}
          onDownloadSheet={handleDownloadPropSheet}
          onDownloadZip={handleDownloadPropZip}
        />
      ) : isSprite ? (
        <SpriteStudio
          sheet={spriteSheet}
          anchor={spriteAnchor}
          bodyPlan={spriteBodyPlan}
          setBodyPlan={handleSelectBodyPlan}
          selectedAnim={spriteAnim}
          setSelectedAnim={handleSelectSpriteAnim}
          generatedAnims={spriteGeneratedAnims}
          prompt={spritePrompt}
          setPrompt={setSpritePrompt}
          fps={spriteFps}
          setFps={setSpriteFps}
          artStyle={artStyle}
          setArtStyle={setArtStyle}
          generating={spriteGenerating}
          progressMessage={spriteProgressMsg}
          onGenerate={() => handleGenerateSpriteSheet()}
          onRerollCharacter={handleRerollSpriteCharacter}
          onUploadCharacter={handleUploadSpriteCharacter}
          onRemoveUploadedCharacter={handleRemoveUploadedCharacter}
          onStop={handleStopSpriteSheet}
          onClear={handleClearSpriteSheet}
          onDownloadSheet={handleDownloadSpriteSheet}
          onDownloadZip={handleDownloadSpriteZip}
          onToggleFrame={handleToggleSpriteFrame}
        />
      ) : isTile ? (
        <TileStudio
          tileSet={tileSet}
          prompt={tilePrompt}
          setPrompt={setTilePrompt}
          artStyle={artStyle}
          setArtStyle={setArtStyle}
          generating={tileSetGenerating}
          progressMessage={tileProgressMsg}
          sceneBrief={sceneBrief}
          setSceneBrief={setSceneBrief}
          sceneBriefLoading={sceneBriefLoading}
          onGenerateAll={handleGenerateTileSet}
          onStop={handleStopTileSet}
          onRegenerate={handleRegenerateTile}
          onClearAll={handleClearTileSet}
          onDownloadSheet={handleDownloadTileSheet}
          onDownloadZip={handleDownloadTileSetZip}
        />
      ) : isParallax ? (
        <ParallaxStudio
          layers={parallaxLayers}
          activeIdx={parallaxActiveIdx}
          setActiveIdx={setParallaxActiveIdx}
          onClearLayer={clearLayer}
          onScrollSpeedChange={setLayerScrollSpeed}
          activeImage={parallaxActiveImage}
          activeDimensions={parallaxActiveDims}
          onExtend={(d) => handleExtend(d)}
          activeDirection={activeDirection}
          loading={loading}
          progressMessage={progressMsg}
          isResult={isResult}
          resultMessage={
            isResult
              ? variantCount > 1
                ? `Cycle variants with ← →, then accept`
                : 'New extension ready — accept, regenerate, or discard'
              : undefined
          }
          variantSelector={variantSelectorEl}
          resultActions={resultActionsEl}
          targetWidth={parallaxTargetWidth}
          setTargetWidth={setParallaxTargetWidth}
          onAutoExtend={handleAutoExtend}
          onStopAutoExtend={handleStopAutoExtend}
          autoExtending={parallaxAutoExtending}
          onMakeTileable={handleMakeActiveLayerTileable}
          onHarmonize={handleHarmonizeActiveLayer}
          onDownloadActiveLayerPng={handleDownloadFull}
          onExportZip={handleExportZip}
          onPickFile={() => fileInputRef.current?.click()}
          onGenerate={openGenerateModal}
          onDropFile={handleFile}
        />
      ) : !displayImage ? (
        <EmptyState
          mode={mode}
          onPickFile={() => fileInputRef.current?.click()}
          onGenerate={openGenerateModal}
          onDropFile={handleFile}
        />
      ) : (
        <Workspace
          image={displayImage}
          dimensions={displayDimensions}
          onExtend={handleExtend}
          activeDirection={activeDirection}
          loading={loading}
          progressMessage={progressMsg}
          isResult={isResult}
          resultMessage={
            isResult
              ? variantCount > 1
                ? `Cycle variants with ← →, then accept`
                : 'New extension ready — accept, regenerate, or discard'
              : undefined
          }
          variantSelector={variantSelectorEl}
          resultActions={resultActionsEl}
        />
      )}

      {/* Command bar: extender mode shows it once an image exists; parallax
          mode shows it whenever the active layer has an image so users can
          tweak the prompt while iterating. Tile, Props, and Sprite modes have
          their own action bars built into the studio. */}
      {!isTile &&
        !isSprite &&
        !isProps &&
        ((isParallax && !!activeLayer?.imageUrl) ||
          (!isParallax && !!selectedImage)) &&
        !isResult &&
        !parallaxAutoExtending && (
          <CommandBar
            prompt={customPrompt}
            setPrompt={setCustomPrompt}
            artStyle={artStyle}
            setArtStyle={setArtStyle}
            loading={loading}
            hint={
              isParallax
                ? artStyle !== 'none'
                  ? `Style: ${findStyleLabel(artStyle)} — describe what to extend in the ${LAYER_ROLES[activeLayer!.role].short.toLowerCase()} layer`
                  : `Optional: describe what should appear further along the ${LAYER_ROLES[activeLayer!.role].short.toLowerCase()} layer…`
                : artStyle !== 'none'
                  ? `Style: ${findStyleLabel(artStyle)} — describe what to add (optional)`
                  : undefined
            }
            sceneBrief={showSceneDirection ? sceneBrief : undefined}
            setSceneBrief={showSceneDirection ? setSceneBrief : undefined}
            sceneBriefLoading={sceneBriefLoading}
          />
        )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />

      <SettingsDrawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        debugMode={debugMode}
        setDebugMode={setDebugMode}
        onGenerate={openGenerateModal}
        apiKey={apiKey}
        onEditApiKey={handleEditApiKey}
        onClearApiKey={handleClearApiKey}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        providerSettings={providerSettings}
        setProviderSettings={setProviderSettings}
      />

      <ApiKeyModal
        open={showApiKeyModal}
        initialValue={apiKey}
        required={apiKeyRequired}
        onSave={handleSaveApiKey}
        onSkip={apiKeyRequired ? handleSkipApiKey : undefined}
        onClose={() => setShowApiKeyModal(false)}
      />

      <GenerateModal
        open={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        prompt={generatePrompt}
        setPrompt={setGeneratePrompt}
        width={generateWidth}
        setWidth={setGenerateWidth}
        height={generateHeight}
        setHeight={setGenerateHeight}
        artStyle={artStyle}
        setArtStyle={setArtStyle}
        generating={generating}
        onGenerate={handleGenerateImage}
        workflowNote={
          mode === 'parallax' && activeLayer && !activeLayer.imageUrl
            ? (() => {
                const prereq = getWorkflowPrerequisite(
                  parallaxLayers,
                  activeLayer.role
                )
                if (!prereq) return null
                return `Tip: ${LAYER_ROLES[prereq.role].label} isn't built yet. Layers work best when generated front-to-back (Near → Mid → Far → Sky) so palette and art direction stay consistent. You can still generate now if you're bringing your own matching assets.`
              })()
            : null
        }
        showSceneBrief={
          mode === 'parallax' &&
          !!activeLayer &&
          activeLayer.role !== WORKFLOW_ORDER[0]
        }
        sceneBrief={sceneBrief}
        setSceneBrief={setSceneBrief}
        sceneBriefLoading={sceneBriefLoading}
        layerLabel={
          mode === 'parallax' && activeLayer
            ? LAYER_ROLES[activeLayer.role].short
            : undefined
        }
      />

      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
    </main>
  )
}
