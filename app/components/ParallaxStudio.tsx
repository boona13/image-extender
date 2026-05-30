'use client'

import { useEffect, useRef, useState } from 'react'
import { Icons } from '@/app/components/icons'
import { StatusPill } from '@/app/components/TopBar'
import { Direction } from '@/app/lib/app'
import { LAYER_ROLES, PARALLAX_TARGET_PRESETS, ParallaxLayer, getLayerIndexByRole, getRecommendedLayerIndex, getWorkflowPrerequisite, getWorkflowStep } from '@/app/lib/parallax'

export function MultiLayerPreview({
  layers,
  previewHeight = 140,
}: {
  layers: ParallaxLayer[]
  /** Visible height of the preview strip in CSS pixels. */
  previewHeight?: number
}) {
  const [playing, setPlaying] = useState(true)
  /** Base px/sec of the fastest layer (1.0× speed reference). All other
   * layers scroll at `basePxPerSec * layer.scrollSpeed`. */
  const [basePxPerSec, setBasePxPerSec] = useState(120)
  const [fullscreen, setFullscreen] = useState(false)
  /** How much of the available fullscreen height the rendered scene fills.
   * Lower values pull the camera back so more horizontal scroll fits in
   * one screen — default 0.55 mimics a typical 16:9 game viewport rather
   * than an aspect-fit zoom-in. */
  const [fullscreenZoom, setFullscreenZoom] = useState(0.55)
  const viewportRef = useRef<HTMLDivElement>(null)
  const fullscreenStageRef = useRef<HTMLDivElement>(null)
  const [viewportHeight, setViewportHeight] = useState(previewHeight)
  /** Pixel height of the outer fullscreen content area (above letterbox) so
   * the zoom slider can map [0..1] → real px without pinning to viewport. */
  const [fullscreenStageHeight, setFullscreenStageHeight] = useState(0)
  const offsetsRef = useRef<Record<string, number>>({})
  const lastTimeRef = useRef<number | null>(null)
  /** Refs into each layer's animated div, indexed by layer id. */
  const layerRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const populated = layers.filter((l) => l.imageUrl)

  // Track the viewport's rendered height so layer scaling stays correct in
  // both the inline strip and the fullscreen overlay.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => setViewportHeight(Math.max(1, el.clientHeight))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fullscreen, previewHeight])

  // Track the available fullscreen "stage" height so the zoom slider
  // controls the rendered scene height in absolute pixels.
  useEffect(() => {
    if (!fullscreen) return
    const el = fullscreenStageRef.current
    if (!el) return
    const update = () => setFullscreenStageHeight(Math.max(1, el.clientHeight))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fullscreen])

  useEffect(() => {
    if (!fullscreen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [fullscreen])

  // Reset offsets when the layer set or the preview height changes — otherwise
  // a stale offset on a freshly-changed image can clip the start.
  useEffect(() => {
    offsetsRef.current = {}
  }, [layers.map((l) => l.id + ':' + l.imageUrl).join('|'), viewportHeight])

  useEffect(() => {
    if (!playing) {
      lastTimeRef.current = null
      return
    }
    let raf = 0
    const tick = (t: number) => {
      if (lastTimeRef.current == null) lastTimeRef.current = t
      const dt = (t - lastTimeRef.current) / 1000
      lastTimeRef.current = t

      for (const layer of layers) {
        if (!layer.imageUrl || !layer.width || !layer.height) continue
        const layerScale =
          layer.height > 0 ? viewportHeight / layer.height : 1
        const layerDisplayWidth = Math.max(1, layer.width * layerScale)
        const speed = basePxPerSec * layer.scrollSpeed
        const cur = offsetsRef.current[layer.id] ?? 0
        const next = (cur + speed * dt) % layerDisplayWidth
        offsetsRef.current[layer.id] = next
        const el = layerRefs.current[layer.id]
        if (el) el.style.backgroundPositionX = `${-next}px`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      lastTimeRef.current = null
    }
  }, [playing, basePxPerSec, layers, viewportHeight])

  const controls = (
    <div
      className="flex shrink-0 flex-col items-center justify-center gap-1 px-2"
      style={{ minWidth: 78 }}
    >
      <span
        className="text-[10px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-muted)' }}
      >
        Composite
      </span>
      <button
        onClick={() => setPlaying((p) => !p)}
        className="icon-btn h-7 w-7"
        aria-label={playing ? 'Pause preview' : 'Play preview'}
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Icons.Pause size={12} /> : <Icons.Play size={12} />}
      </button>
      <span
        className="font-mono text-[10px] tabular-nums"
        style={{ color: 'var(--text-secondary)' }}
      >
        {Math.round(basePxPerSec)} px/s
      </span>
      <input
        type="range"
        min={20}
        max={300}
        value={basePxPerSec}
        onChange={(e) => setBasePxPerSec(Number(e.target.value))}
        aria-label="Camera scroll speed"
        className="parallax-slider"
      />
      {fullscreen && (
        <>
          <div
            className="my-1 w-full"
            style={{ borderTop: '1px solid var(--border)' }}
            aria-hidden
          />
          <span
            className="text-[10px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            Camera
          </span>
          <span
            className="font-mono text-[10px] tabular-nums"
            style={{ color: 'var(--text-secondary)' }}
          >
            {Math.round(fullscreenZoom * 100)}%
          </span>
          <input
            type="range"
            min={25}
            max={100}
            value={Math.round(fullscreenZoom * 100)}
            onChange={(e) => setFullscreenZoom(Number(e.target.value) / 100)}
            aria-label="Fullscreen camera zoom"
            title="Pull the camera back to fit more horizontal scene on screen"
            className="parallax-slider"
          />
        </>
      )}
    </div>
  )

  const fullscreenViewportHeight =
    fullscreenStageHeight > 0
      ? Math.max(120, Math.round(fullscreenStageHeight * fullscreenZoom))
      : undefined

  const viewport = (
    <div
      ref={viewportRef}
      className="relative w-full overflow-hidden rounded-[var(--radius-sm)]"
      style={{
        height: fullscreen
          ? fullscreenViewportHeight
            ? `${fullscreenViewportHeight}px`
            : '55%'
          : `${previewHeight}px`,
        border: '1px solid var(--border)',
        background: 'linear-gradient(180deg, #0a0c14 0%, #15182a 100%)',
      }}
    >
      {populated.length === 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center text-[12px]"
          style={{ color: 'var(--text-muted)' }}
        >
          Generate or upload at least one layer to preview the parallax
        </div>
      )}
      {layers.map((layer) => {
        if (!layer.imageUrl || !layer.width || !layer.height) return null
        const layerScale = viewportHeight / layer.height
        const layerDisplayWidth = Math.max(1, layer.width * layerScale)
        return (
          <div
            key={layer.id}
            ref={(el) => {
              layerRefs.current[layer.id] = el
            }}
            className="absolute inset-0"
            style={{
              backgroundImage: `url("${layer.imageUrl}")`,
              backgroundRepeat: 'repeat-x',
              backgroundSize: `${layerDisplayWidth}px ${viewportHeight}px`,
              backgroundPositionX: 0,
              backgroundPositionY: 'bottom',
            }}
            aria-hidden
          />
        )
      })}
      <button
        type="button"
        onClick={() => setFullscreen((f) => !f)}
        className="icon-btn absolute bottom-2 right-2 h-8 w-8 shadow-lg"
        style={{
          background: 'rgba(10, 12, 20, 0.75)',
          border: '1px solid var(--border-strong)',
          backdropFilter: 'blur(8px)',
        }}
        aria-label={fullscreen ? 'Exit fullscreen preview' : 'Fullscreen preview'}
        title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen preview'}
      >
        {fullscreen ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
      </button>
    </div>
  )

  const previewShell = (
    <div
      className={`flex w-full items-stretch gap-2 ${fullscreen ? 'h-full min-h-0' : ''}`}
    >
      {controls}
      <div
        ref={fullscreen ? fullscreenStageRef : undefined}
        className={`relative flex min-h-0 flex-1 ${fullscreen ? 'h-full items-center justify-center' : ''}`}
      >
        {viewport}
      </div>
    </div>
  )

  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 z-[100] flex flex-col anim-fade"
        style={{ background: 'rgba(0, 0, 0, 0.92)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Parallax scene preview"
      >
        <div
          className="flex shrink-0 items-center justify-between px-4 py-3 sm:px-6"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight">
              Scene preview
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Live parallax composite · Esc to exit
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            className="btn btn-ghost"
          >
            <Icons.X size={14} />
            Close
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
          <div
            className="flex min-h-0 flex-1 rounded-[var(--radius-lg)] p-2"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--border-strong)',
            }}
          >
            {previewShell}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="anim-fade flex w-full items-stretch gap-2 rounded-[var(--radius)] p-1.5"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
      }}
    >
      {previewShell}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LayerPanel — left sidebar with the 4 parallax layer cards. Click a card to
// edit it in the main canvas. Each card shows a thumbnail (or empty state)
// plus a per-layer scroll-speed slider that feeds the live preview.
// ─────────────────────────────────────────────────────────────────────────────


export function LayerPanel({
  layers,
  activeIdx,
  onSelect,
  onClearLayer,
  onScrollSpeedChange,
}: {
  layers: ParallaxLayer[]
  activeIdx: number
  onSelect: (idx: number) => void
  onClearLayer: (idx: number) => void
  onScrollSpeedChange: (idx: number, speed: number) => void
}) {
  const recommendedIdx = getRecommendedLayerIndex(layers)
  const completedCount = layers.filter((l) => l.imageUrl).length

  return (
    <aside
      className="flex shrink-0 flex-col gap-2 p-3"
      style={{
        width: 220,
        background: 'var(--bg-elev)',
        borderRight: '1px solid var(--border)',
      }}
      aria-label="Parallax layers"
    >
      <div className="mb-1 flex items-center justify-between">
        <span
          className="text-[10px] font-medium uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Layers
        </span>
        <span
          className="text-[10px]"
          style={{ color: 'var(--text-muted)' }}
        >
          back → front
        </span>
      </div>

      {completedCount < layers.length && recommendedIdx !== null && (
        <div
          className="mb-1 rounded-[var(--radius-sm)] px-2.5 py-2 text-[10px] leading-snug"
          style={{
            background: 'var(--accent-bg)',
            border: '1px solid var(--accent-border)',
            color: 'var(--text-secondary)',
          }}
        >
          <span className="font-medium" style={{ color: 'var(--accent)' }}>
            Step {getWorkflowStep(layers[recommendedIdx].role)} —{' '}
            {LAYER_ROLES[layers[recommendedIdx].role].short}
          </span>
          <br />
          Build layers front-to-back so each step matches the scene in front of it.
        </div>
      )}

      {layers.map((layer, idx) => {
        const spec = LAYER_ROLES[layer.role]
        const isActive = idx === activeIdx
        const isEmpty = !layer.imageUrl
        const isRecommended = idx === recommendedIdx
        const prerequisite = isEmpty
          ? getWorkflowPrerequisite(layers, layer.role)
          : null
        const isWaiting = !!prerequisite
        const step = getWorkflowStep(layer.role)
        return (
          <div
            key={layer.id}
            className="relative rounded-[var(--radius-sm)] p-2 transition-all"
            style={{
              background: isActive ? 'var(--accent-bg)' : 'var(--surface)',
              border: `1px solid ${
                isRecommended
                  ? 'var(--accent-border)'
                  : isActive
                    ? 'var(--accent-border)'
                    : 'var(--border)'
              }`,
              opacity: isWaiting && !isActive ? 0.72 : 1,
            }}
          >
            <button
              onClick={() => onSelect(idx)}
              className="flex w-full items-center gap-2 text-left"
              aria-pressed={isActive}
              title={spec.hint}
            >
              <div className="relative shrink-0">
                <div
                  className="checker flex h-9 w-14 items-center justify-center overflow-hidden rounded"
                  style={{
                    border: `1px solid ${isActive ? 'var(--accent-border)' : 'var(--border)'}`,
                    background: spec.isOpaque ? 'transparent' : undefined,
                  }}
                >
                  {layer.imageUrl ? (
                    <img
                      src={layer.imageUrl}
                      alt=""
                      className="block h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span
                      className="text-[10px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      empty
                    </span>
                  )}
                </div>
                <span
                  className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold"
                  style={{
                    background: layer.imageUrl
                      ? 'var(--accent)'
                      : isRecommended
                        ? 'var(--accent)'
                        : 'var(--surface)',
                    color: layer.imageUrl || isRecommended ? '#1a1404' : 'var(--text-muted)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {layer.imageUrl ? '✓' : step}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div
                    className="truncate text-[12px] font-medium"
                    style={{ color: 'var(--text)' }}
                  >
                    {spec.label}
                  </div>
                  {isRecommended && (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium uppercase tracking-wide"
                      style={{
                        background: 'var(--accent-bg)',
                        color: 'var(--accent)',
                        border: '1px solid var(--accent-border)',
                      }}
                    >
                      Next
                    </span>
                  )}
                </div>
                <div
                  className="truncate text-[10px]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {isEmpty
                    ? isWaiting
                      ? `Needs ${LAYER_ROLES[prerequisite!.role].short} first`
                      : spec.hint
                    : `${layer.width}×${layer.height}${spec.isOpaque ? '' : ' · α'}`}
                </div>
              </div>
            </button>
            <div className="mt-2 flex items-center gap-2">
              <span
                className="text-[10px]"
                style={{ color: 'var(--text-muted)' }}
              >
                Speed
              </span>
              <input
                type="range"
                min={0}
                max={150}
                value={Math.round(layer.scrollSpeed * 100)}
                onChange={(e) =>
                  onScrollSpeedChange(idx, Number(e.target.value) / 100)
                }
                className="parallax-slider flex-1"
                aria-label={`${spec.label} scroll speed`}
                title={`${layer.scrollSpeed.toFixed(2)}× camera speed`}
                style={{ width: 'auto' }}
              />
              <span
                className="font-mono text-[10px] tabular-nums"
                style={{ color: 'var(--text-secondary)', minWidth: 28 }}
              >
                {layer.scrollSpeed.toFixed(2)}×
              </span>
            </div>
            {!isEmpty && (
              <button
                onClick={() => onClearLayer(idx)}
                className="absolute right-1 top-1 icon-btn h-6 w-6"
                title={`Clear ${spec.short}`}
                aria-label={`Clear ${spec.short} layer`}
              >
                <Icons.Trash size={11} />
              </button>
            )}
          </div>
        )
      })}
      <p
        className="mt-1 text-[10px] leading-snug"
        style={{ color: 'var(--text-muted)' }}
      >
        Build front → back: Near, then Mid, Far, Sky. Sky is opaque; the
        others are alpha-keyed over it.
      </p>
    </aside>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LayerEmptyState — appears in the active-layer canvas when that layer hasn't
// been populated yet. Mirrors the Extender empty state but role-aware: copy +
// suggested prompt come from LAYER_ROLES.
// ─────────────────────────────────────────────────────────────────────────────


export function LayerEmptyState({
  layer,
  layers,
  onPickFile,
  onGenerate,
  onDropFile,
  onGoToPrerequisite,
}: {
  layer: ParallaxLayer
  layers: ParallaxLayer[]
  onPickFile: () => void
  onGenerate: () => void
  onDropFile: (file: File) => void
  onGoToPrerequisite: (idx: number) => void
}) {
  const [drag, setDrag] = useState(false)
  const spec = LAYER_ROLES[layer.role]
  const prerequisite = getWorkflowPrerequisite(layers, layer.role)
  const prerequisiteIdx = prerequisite
    ? getLayerIndexByRole(layers, prerequisite.role)
    : -1
  const prerequisiteSpec = prerequisite
    ? LAYER_ROLES[prerequisite.role]
    : null
  const step = getWorkflowStep(layer.role)

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-8">
      <div className="w-full max-w-xl anim-fade">
        {prerequisite && prerequisiteSpec && prerequisiteIdx >= 0 && (
          <div
            className="mb-4 rounded-[var(--radius-md)] px-4 py-3 text-[12px] leading-relaxed"
            style={{
              background: 'var(--accent-bg)',
              border: '1px solid var(--accent-border)',
              color: 'var(--text-secondary)',
            }}
          >
            <p className="mb-2 font-medium" style={{ color: 'var(--text)' }}>
              Step {step}: build {spec.short.toLowerCase()} after{' '}
              {prerequisiteSpec.short.toLowerCase()}
            </p>
            <p className="mb-3">
              Parallax layers stack back-to-front in the game, but we build them
              front-to-back. Finish{' '}
              <strong style={{ color: 'var(--accent)' }}>
                {prerequisiteSpec.label}
              </strong>{' '}
              first so this layer matches the same palette, lighting, and art
              direction.
            </p>
            <button
              type="button"
              onClick={() => onGoToPrerequisite(prerequisiteIdx)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                background: 'var(--accent)',
                color: '#1a1404',
              }}
            >
              Go to {prerequisiteSpec.short} (step{' '}
              {getWorkflowStep(prerequisite.role)})
            </button>
          </div>
        )}

        <div className="mb-4 flex items-center justify-center gap-2 text-[12px]">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
            style={{
              background: 'var(--accent-bg)',
              color: 'var(--accent)',
              border: '1px solid var(--accent-border)',
            }}
          >
            {spec.label}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>{spec.hint}</span>
        </div>
        <div
          onClick={onPickFile}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            const file = e.dataTransfer.files?.[0]
            if (file && file.type.startsWith('image/')) onDropFile(file)
          }}
          className="group relative cursor-pointer rounded-[var(--radius-lg)] px-6 py-12 text-center transition-all"
          style={{
            border: `1.5px dashed ${
              drag ? 'var(--accent)' : 'var(--border-strong)'
            }`,
            background: drag ? 'var(--accent-bg)' : 'var(--bg-elev)',
          }}
        >
          <div
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full transition-transform group-hover:scale-110"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--accent)',
            }}
          >
            <Icons.Upload size={20} />
          </div>
          <p
            className="mb-1 text-[14px] font-medium"
            style={{ color: 'var(--text)' }}
          >
            Drop a {spec.short.toLowerCase()} layer
          </p>
          <p
            className="text-[12px]"
            style={{ color: 'var(--text-muted)' }}
          >
            {spec.isOpaque
              ? 'PNG, JPG, or WEBP — opaque image at this game height'
              : 'PNG with transparency works best — the magenta key will be applied if needed'}
          </p>
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 text-[12px]">
          <span style={{ color: 'var(--text-muted)' }}>or</span>
          <button
            onClick={onGenerate}
            className="inline-flex items-center gap-1.5 font-medium transition-colors"
            style={{ color: 'var(--accent)' }}
          >
            <Icons.Sparkle size={13} />
            generate this layer with AI
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ParallaxStudio — the layered parallax workspace. Combines:
//   - LayerPanel sidebar (pick the active layer)
//   - MultiLayerPreview at the top (live composite scroll)
//   - active-layer canvas in the middle (extend / review variants)
//   - target-width bar at the bottom (auto-extend + project ZIP export)
// ─────────────────────────────────────────────────────────────────────────────


export function ParallaxStudio({
  layers,
  activeIdx,
  setActiveIdx,
  onClearLayer,
  onScrollSpeedChange,
  // Active-layer image + ops (delegated to Home)
  activeImage,
  activeDimensions,
  onExtend,
  activeDirection,
  loading,
  progressMessage,
  isResult,
  resultMessage,
  variantSelector,
  resultActions,
  // Target / auto-extend
  targetWidth,
  setTargetWidth,
  onAutoExtend,
  onStopAutoExtend,
  autoExtending,
  onMakeTileable,
  onHarmonize,
  // Export
  onDownloadActiveLayerPng,
  onExportZip,
  // Empty-state actions for the active layer
  onPickFile,
  onGenerate,
  onDropFile,
}: {
  layers: ParallaxLayer[]
  activeIdx: number
  setActiveIdx: (i: number) => void
  onClearLayer: (i: number) => void
  onScrollSpeedChange: (i: number, s: number) => void
  activeImage: string | null
  activeDimensions: { width: number; height: number } | null
  onExtend: (d: 'left' | 'right') => void
  activeDirection: Direction | null
  loading: boolean
  progressMessage?: string | null
  isResult: boolean
  resultMessage?: string
  variantSelector?: React.ReactNode
  resultActions?: React.ReactNode
  targetWidth: number | null
  setTargetWidth: (n: number | null) => void
  onAutoExtend: () => void
  onStopAutoExtend: () => void
  autoExtending: boolean
  onMakeTileable: () => void
  onHarmonize: () => void
  onDownloadActiveLayerPng: () => void
  onExportZip: () => void
  onPickFile: () => void
  onGenerate: () => void
  onDropFile: (f: File) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeLayer = layers[activeIdx]
  const isEmpty = !activeImage
  const populatedCount = layers.filter((l) => l.imageUrl).length

  // Auto-scroll the active-layer canvas to the most recent edit so the user
  // sees the new content. Right-extend → end of strip, left-extend → start.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (isResult && (activeDirection === 'right' || activeDirection === null)) {
      el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' })
    } else if (isResult && activeDirection === 'left') {
      el.scrollTo({ left: 0, behavior: 'smooth' })
    }
  }, [activeImage, isResult, activeDirection])

  const MAX_DISPLAY_HEIGHT = 320
  const displayHeight = activeDimensions
    ? Math.min(activeDimensions.height, MAX_DISPLAY_HEIGHT)
    : MAX_DISPLAY_HEIGHT
  const displayScale =
    activeDimensions && activeDimensions.height > 0
      ? displayHeight / activeDimensions.height
      : 1
  const displayWidth = activeDimensions
    ? activeDimensions.width * displayScale
    : 0

  const widthProgress =
    activeDimensions && targetWidth && targetWidth > 0
      ? Math.min(1, activeDimensions.width / targetWidth)
      : 0
  const remainingPx =
    activeDimensions && targetWidth
      ? Math.max(0, targetWidth - activeDimensions.width)
      : 0
  const targetReached =
    !!activeDimensions && !!targetWidth && activeDimensions.width >= targetWidth

  return (
    <div className="flex flex-1">
      <LayerPanel
        layers={layers}
        activeIdx={activeIdx}
        onSelect={setActiveIdx}
        onClearLayer={onClearLayer}
        onScrollSpeedChange={onScrollSpeedChange}
      />

      <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-3 sm:px-6">
        <MultiLayerPreview layers={layers} previewHeight={140} />

        {isEmpty ? (
          <LayerEmptyState
            layer={activeLayer}
            layers={layers}
            onPickFile={onPickFile}
            onGenerate={onGenerate}
            onDropFile={onDropFile}
            onGoToPrerequisite={setActiveIdx}
          />
        ) : (
          <>
            <div className="relative flex-1 anim-fade">
              {activeDirection && (
                <div
                  className={`pointer-events-none absolute inset-0 z-10 rounded-[var(--radius-lg)] edge-glow-${activeDirection}`}
                />
              )}
              <div
                ref={scrollRef}
                className="checker overflow-x-auto rounded-[var(--radius-lg)]"
                style={{
                  border: '1px solid var(--border)',
                  boxShadow:
                    '0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 48px -12px rgba(0,0,0,0.5)',
                  height: `${displayHeight + 2}px`,
                }}
              >
                {activeImage && (
                  <img
                    src={activeImage}
                    alt=""
                    draggable={false}
                    className="block"
                    style={{
                      height: `${displayHeight}px`,
                      width: `${displayWidth}px`,
                      maxWidth: 'none',
                      objectFit: 'contain',
                    }}
                  />
                )}
              </div>
              {!isResult && !autoExtending && (
                <>
                  <ParallaxEdgeHandle
                    direction="left"
                    onClick={() => onExtend('left')}
                    active={activeDirection === 'left'}
                    disabled={loading}
                  />
                  <ParallaxEdgeHandle
                    direction="right"
                    onClick={() => onExtend('right')}
                    active={activeDirection === 'right'}
                    disabled={loading}
                  />
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <div
                className="rounded-full border px-2.5 py-1 font-mono text-[11px]"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--bg-elev)',
                  color: 'var(--text-secondary)',
                }}
              >
                {LAYER_ROLES[activeLayer.role].short}
                {activeDimensions
                  ? ` · ${activeDimensions.width} × ${activeDimensions.height}`
                  : ''}
              </div>
              {isResult && variantSelector}
              {isResult && resultMessage && (
                <StatusPill status="ok" message={resultMessage} />
              )}
              {!isResult && !loading && !autoExtending && (
                <span
                  className="text-[12px]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Click an edge to extend the {LAYER_ROLES[activeLayer.role].short.toLowerCase()} layer, or set a target and auto-extend
                </span>
              )}
              {(loading || autoExtending) && (
                <StatusPill
                  status="working"
                  message={
                    progressMessage ||
                    (activeDirection
                      ? `Extending ${activeDirection}…`
                      : 'Working…')
                  }
                />
              )}
            </div>

            {isResult && resultActions && (
              <div className="flex justify-center anim-slide-up">
                {resultActions}
              </div>
            )}

            {!isResult && (
              <ParallaxTargetBar
                dimensions={activeDimensions}
                targetWidth={targetWidth}
                setTargetWidth={setTargetWidth}
                progress={widthProgress}
                remainingPx={remainingPx}
                targetReached={targetReached}
                autoExtending={autoExtending}
                loading={loading}
                onAutoExtend={onAutoExtend}
                onStopAutoExtend={onStopAutoExtend}
                onMakeTileable={onMakeTileable}
                makeTileableDisabled={!activeImage}
                onHarmonize={onHarmonize}
                harmonizeDisabled={!activeImage}
                onDownloadFull={onDownloadActiveLayerPng}
                onDownloadSecondary={onExportZip}
                secondaryLabel="ZIP"
                secondaryIcon={<Icons.Layers size={14} />}
                secondaryTitle={`Export project: ${populatedCount}/${layers.length} populated layers + manifest`}
                secondaryDisabled={populatedCount === 0}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Edge handle for the parallax workspace. Pinned to the visible viewport
 * (rather than the natural image edges) so the action is always reachable
 * regardless of scroll position.
 */

export function ParallaxEdgeHandle({
  direction,
  onClick,
  active,
  disabled,
}: {
  direction: 'left' | 'right'
  onClick: () => void
  active: boolean
  disabled: boolean
}) {
  const Icon = direction === 'left' ? Icons.ArrowLeft : Icons.ArrowRight
  const position: React.CSSProperties =
    direction === 'left'
      ? { left: 8, top: '50%', transform: 'translateY(-50%)' }
      : { right: 8, top: '50%', transform: 'translateY(-50%)' }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={`Extend ${direction}`}
      aria-label={`Extend ${direction}`}
      className={`absolute z-20 flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 ${
        active ? 'anim-pulse' : ''
      }`}
      style={{
        ...position,
        background: active ? 'var(--accent)' : 'var(--bg-elev)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
        color: active ? '#1a1404' : 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !active ? 0.4 : 1,
        boxShadow: '0 8px 24px -8px rgba(0,0,0,0.6)',
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.borderColor = 'var(--accent)'
        e.currentTarget.style.color = active ? '#1a1404' : 'var(--accent)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = active
          ? 'var(--accent)'
          : 'var(--border-strong)'
        e.currentTarget.style.color = active ? '#1a1404' : 'var(--text-secondary)'
      }}
    >
      <Icon size={20} />
    </button>
  )
}

/**
 * Target-width bar at the bottom of the parallax workspace. Combines the
 * "how wide do I want this?" target field, an auto-extend trigger, and the
 * export actions in one tidy row.
 */

export function ParallaxTargetBar({
  dimensions,
  targetWidth,
  setTargetWidth,
  progress,
  remainingPx,
  targetReached,
  autoExtending,
  loading,
  onAutoExtend,
  onStopAutoExtend,
  onMakeTileable,
  makeTileableDisabled,
  onHarmonize,
  harmonizeDisabled,
  onDownloadFull,
  onDownloadSecondary,
  secondaryLabel,
  secondaryIcon,
  secondaryTitle,
  secondaryDisabled,
}: {
  dimensions: { width: number; height: number } | null
  targetWidth: number | null
  setTargetWidth: (n: number | null) => void
  progress: number
  remainingPx: number
  targetReached: boolean
  autoExtending: boolean
  loading: boolean
  onAutoExtend: () => void
  onStopAutoExtend: () => void
  /** Optional one-shot "make this texture tileable" trigger. Game-engine
   * critical for parallax — without it, repeat-x scrolling shows a seam
   * at every loop point. Hidden when not provided. */
  onMakeTileable?: () => void
  makeTileableDisabled?: boolean
  /** Optional manual seam-harmonize trigger. Hidden when not provided so
   * the bar can be reused outside of parallax. */
  onHarmonize?: () => void
  harmonizeDisabled?: boolean
  onDownloadFull: () => void
  /** Flexible secondary action — used for tile-split in extender contexts and
   * for ZIP export in the layered parallax studio. */
  onDownloadSecondary?: () => void
  secondaryLabel?: string
  secondaryIcon?: React.ReactNode
  secondaryTitle?: string
  secondaryDisabled?: boolean
}) {
  const [showPresets, setShowPresets] = useState(false)
  return (
    <div
      className="anim-slide-up flex w-full flex-wrap items-center gap-3 rounded-[var(--radius-lg)] p-2.5"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 12px 32px -16px rgba(0,0,0,0.6)',
      }}
    >
      {/* Target input */}
      <div className="relative flex items-center gap-2">
        <Icons.Target size={14} className="ml-1" />
        <span
          className="text-[11px] font-medium uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Target
        </span>
        <input
          type="number"
          min={dimensions?.width ?? 0}
          max={20000}
          step={64}
          value={targetWidth ?? ''}
          onChange={(e) => {
            const v = e.target.value
            setTargetWidth(v === '' ? null : Math.max(0, Number(v)))
          }}
          placeholder="e.g. 7680"
          disabled={loading || autoExtending}
          className="w-24 rounded-[var(--radius-sm)] px-2 py-1 font-mono text-[12px]"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
          }}
        />
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          px
        </span>
        <button
          onClick={() => setShowPresets((s) => !s)}
          className="icon-btn h-7 w-7"
          aria-label="Width presets"
          title="Width presets"
        >
          <Icons.Layers size={13} />
        </button>
        {showPresets && (
          <div
            className="absolute left-0 top-full z-30 mt-1 flex flex-col gap-0.5 rounded-[var(--radius-sm)] p-1 anim-fade"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--border-strong)',
              boxShadow: '0 16px 40px -12px rgba(0,0,0,0.6)',
              minWidth: 220,
            }}
          >
            {PARALLAX_TARGET_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => {
                  setTargetWidth(p.value)
                  setShowPresets(false)
                }}
                className="flex items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[12px] transition-colors"
                style={{ color: 'var(--text)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--surface)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <span className="font-mono">{p.label}</span>
                <span
                  className="text-[11px]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {p.hint}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="flex flex-1 items-center gap-2 px-2" style={{ minWidth: 120 }}>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full"
          style={{ background: 'var(--surface)' }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.round(progress * 100)}%`,
              background: targetReached
                ? 'var(--success)'
                : 'var(--accent)',
            }}
          />
        </div>
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color: 'var(--text-secondary)', minWidth: 64 }}
        >
          {targetReached
            ? 'Reached'
            : remainingPx > 0
              ? `${remainingPx}px left`
              : '—'}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        {autoExtending ? (
          <button
            onClick={onStopAutoExtend}
            className="btn"
            title="Stop auto-extend"
            style={{
              color: 'var(--danger)',
              background: 'rgba(255, 107, 107, 0.08)',
              border: '1px solid rgba(255, 107, 107, 0.35)',
            }}
          >
            <Icons.Stop size={14} />
            Stop
          </button>
        ) : (
          <button
            onClick={onAutoExtend}
            disabled={
              loading ||
              !targetWidth ||
              !dimensions ||
              dimensions.width >= targetWidth
            }
            className="btn btn-primary"
            title="Auto-extend right until target width is reached"
          >
            <Icons.Sparkle size={14} />
            Auto-extend
          </button>
        )}
        <div
          className="mx-0.5 h-5 w-px"
          style={{ background: 'var(--border)' }}
          aria-hidden
        />
        {onMakeTileable && (
          <button
            onClick={onMakeTileable}
            disabled={loading || autoExtending || !!makeTileableDisabled}
            className="btn btn-ghost"
            title="Make tileable — heals the loop-point seam so repeat-x scrolling has no visible joint"
          >
            <Icons.Loop size={14} />
            Tileable
          </button>
        )}
        {onHarmonize && (
          <button
            onClick={onHarmonize}
            disabled={loading || autoExtending || !!harmonizeDisabled}
            className="btn btn-ghost"
            title="Harmonize — flatten cumulative color/brightness drift across many extensions"
          >
            <Icons.Smooth size={14} />
            Harmonize
          </button>
        )}
        <button
          onClick={onDownloadFull}
          disabled={loading || autoExtending}
          className="btn btn-ghost"
          title="Download as a single PNG"
        >
          <Icons.Download size={14} />
          PNG
        </button>
        {onDownloadSecondary && (
          <button
            onClick={onDownloadSecondary}
            disabled={
              loading ||
              autoExtending ||
              !dimensions ||
              !!secondaryDisabled
            }
            className="btn btn-ghost"
            title={secondaryTitle || secondaryLabel || 'Secondary export'}
          >
            {secondaryIcon ?? <Icons.Layers size={14} />}
            {secondaryLabel ?? 'Export'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TileStudio — 13-tile platformer auto-tile set (body + 4 edges + 4 outer
// corners + 4 inner corners). Each non-body tile is generated against a
// magenta background and chroma-keyed to alpha so the user can drop tiles
// over any scene. The 4x4 grid mirrors the engine sprite-sheet layout —
// what you see is what gets exported. The platform preview underneath
// arranges the tiles into a sample L-shape so the user can verify the set
// fits together cleanly.
// ─────────────────────────────────────────────────────────────────────────────

