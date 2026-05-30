'use client'

import { useEffect, useRef, useState } from 'react'
import { Icons } from '@/app/components/icons'
import { ART_STYLE_GROUPS } from '@/app/lib/artStyles'
import { SPRITE_ANIMATIONS, SPRITE_ANIM_ORDER, SPRITE_CHARACTER_PRESETS, SPRITE_FRAME_COUNT, SPRITE_FRAME_SIZE, SPRITE_SHEET_H, SPRITE_SHEET_W, SpriteAnimType, SpriteFrame, SpriteSheet } from '@/app/lib/sprite'

export function SpriteAnimationPlayer({
  frames,
  fps,
  loop,
  playing,
  setPlaying,
  anchorImageUrl,
  anchorUploaded,
}: {
  frames: SpriteFrame[]
  fps: number
  loop: boolean
  playing: boolean
  setPlaying: (v: boolean) => void
  anchorImageUrl?: string | null
  anchorUploaded?: boolean
}) {
  const [currentIdx, setCurrentIdx] = useState(0)
  // Excluded frames (user-disabled) never play back.
  const populated = frames.filter((f) => !!f.imageUrl && !f.disabled)
  const hasFrames = populated.length > 0
  const frameCount = populated.length

  // Advance the playhead at `fps` frames per second. We use setInterval +
  // the functional setState form on purpose: an earlier rAF-based version
  // captured `currentIdx` in its closure, which goes stale the moment the
  // state updates, freezing the player after a single frame advance.
  // Functional updates always see the latest state, so the cycle keeps
  // running and the loop reads continuous.
  useEffect(() => {
    if (!playing || !hasFrames) return
    const intervalMs = Math.max(1, Math.round(1000 / Math.max(1, fps)))
    let stopped = false
    const id = window.setInterval(() => {
      if (stopped) return
      setCurrentIdx((prev) => {
        const next = prev + 1
        if (next >= frameCount) {
          if (loop) return 0
          // One-shot anim hit the end — clear the interval and pause
          // (deferred via microtask so we don't mutate other state from
          // inside a setState updater).
          stopped = true
          window.clearInterval(id)
          queueMicrotask(() => setPlaying(false))
          return frameCount - 1
        }
        return next
      })
    }, intervalMs)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [playing, fps, loop, frameCount, hasFrames, setPlaying])

  // Reset position whenever the populated count changes (new generation arrives).
  useEffect(() => {
    setCurrentIdx(0)
  }, [frameCount])

  // If the user hits Play on a one-shot anim that's already parked at the
  // last frame, rewind to frame 1 first so playback restarts from the top.
  // Without this the effect would tick once, hit the end-guard, and pause
  // again immediately — felt like "play doesn't work" for one-shots.
  const handleTogglePlay = () => {
    if (!playing && !loop && hasFrames && currentIdx >= frameCount - 1) {
      setCurrentIdx(0)
    }
    setPlaying(!playing)
  }

  const activeFrame = populated[currentIdx] ?? populated[0] ?? null

  return (
    <div className="flex w-full flex-col gap-2">
      <div
        className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-muted)' }}
      >
        <span>Live playback</span>
        <span
          className="font-mono normal-case tracking-normal"
          style={{ color: 'var(--text-muted)' }}
        >
          {hasFrames
            ? `Frame ${currentIdx + 1}/${populated.length} · ${fps} FPS`
            : 'No frames yet'}
        </span>
      </div>

      <div
        className="checker relative flex items-center justify-center overflow-hidden rounded-[var(--radius-lg)]"
        style={{
          aspectRatio: '1 / 1',
          width: '100%',
          border: '1px solid var(--border)',
          background:
            'linear-gradient(180deg, rgba(140, 195, 235, 0.15), rgba(40, 70, 110, 0.25))',
          boxShadow:
            '0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 48px -12px rgba(0,0,0,0.5)',
        }}
      >
        {activeFrame?.imageUrl ? (
          <img
            src={activeFrame.imageUrl}
            alt={`Frame ${activeFrame.index + 1}`}
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              imageRendering: 'pixelated',
            }}
          />
        ) : anchorImageUrl ? (
          // No sheet yet, but a character is locked — preview it here so the
          // big stage isn't empty and the user sees who they're animating.
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6">
            <img
              src={anchorImageUrl}
              alt="Locked character"
              draggable={false}
              style={{
                maxWidth: '62%',
                maxHeight: '62%',
                objectFit: 'contain',
                imageRendering: 'pixelated',
                filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.45))',
              }}
            />
            <div className="flex flex-col items-center gap-1 text-center">
              <span
                className="rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                style={{
                  background: 'var(--accent-bg)',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)',
                }}
              >
                {anchorUploaded ? 'Uploaded character' : 'Character ready'}
              </span>
              <span
                className="text-[12px]"
                style={{ color: 'var(--text-muted)' }}
              >
                Pick an animation and hit generate to bring it to life
              </span>
            </div>
          </div>
        ) : (
          <div
            className="text-[13px]"
            style={{ color: 'var(--text-muted)' }}
          >
            Generate a sheet to see the animation play
          </div>
        )}
      </div>

      {/* Transport */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleTogglePlay}
          disabled={!hasFrames}
          className="icon-btn"
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
          style={{ opacity: hasFrames ? 1 : 0.4 }}
        >
          {playing ? <Icons.Pause size={14} /> : <Icons.Play size={14} />}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, populated.length - 1)}
          value={Math.min(currentIdx, Math.max(0, populated.length - 1))}
          onChange={(e) => {
            setPlaying(false)
            setCurrentIdx(Number(e.target.value))
          }}
          disabled={!hasFrames}
          className="parallax-slider flex-1"
          aria-label="Scrub frame"
        />
      </div>
    </div>
  )
}


export function SpriteFrameCell({
  frame,
  size,
  highlight,
  loading,
  onToggle,
}: {
  frame: SpriteFrame
  size: number
  highlight: boolean
  loading?: boolean
  onToggle?: (index: number) => void
}) {
  const hasImage = !!frame.imageUrl
  const disabled = !!frame.disabled
  const interactive = hasImage && !!onToggle && !loading
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onToggle!(frame.index) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggle!(frame.index)
              }
            }
          : undefined
      }
      className="group relative checker overflow-hidden rounded-[var(--radius-md)] anim-fade"
      style={{
        border: `1px solid ${
          disabled
            ? 'var(--danger, #e5484d)'
            : highlight
              ? 'var(--accent)'
              : 'var(--border)'
        }`,
        aspectRatio: '1 / 1',
        cursor: interactive ? 'pointer' : 'default',
      }}
      title={
        interactive
          ? disabled
            ? `Frame ${frame.index + 1} — excluded · click to include`
            : `Frame ${frame.index + 1} — click to exclude from animation & exports`
          : `Frame ${frame.index + 1}`
      }
    >
      {hasImage ? (
        <img
          src={frame.imageUrl as string}
          alt={`Frame ${frame.index + 1}`}
          draggable={false}
          className="block h-full w-full"
          style={{
            objectFit: 'contain',
            imageRendering: 'pixelated',
            opacity: disabled ? 0.28 : 1,
            filter: disabled ? 'grayscale(1)' : 'none',
            transition: 'opacity 0.12s ease, filter 0.12s ease',
          }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-[10px] font-mono"
          style={{
            color: 'var(--text-muted)',
            background:
              'repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,0.025) 6px 12px)',
          }}
        >
          {frame.index + 1}
        </div>
      )}

      {/* Generating overlay: spinner on each pending cell while the AI paints
          the sheet. Shows on the placeholder until the real frame arrives. */}
      {loading && !hasImage && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)' }}
        >
          <Icons.Spinner size={16} className="text-[color:var(--accent)]" />
        </div>
      )}

      {/* Excluded overlay: diagonal hatch + EXCLUDED badge */}
      {disabled && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{
            background:
              'repeating-linear-gradient(45deg, rgba(229,72,77,0.10) 0 7px, rgba(0,0,0,0) 7px 14px)',
          }}
        >
          <span
            className="rounded px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-wider"
            style={{
              background: 'rgba(229,72,77,0.9)',
              color: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
            }}
          >
            Excluded
          </span>
        </div>
      )}

      {/* Frame number badge */}
      <div
        className="pointer-events-none absolute left-1 top-1 rounded px-1 py-px font-mono text-[9px]"
        style={{
          background: 'rgba(0,0,0,0.55)',
          color: 'var(--text-secondary)',
          backdropFilter: 'blur(4px)',
        }}
      >
        {frame.index + 1}
      </div>

      {/* Toggle affordance (eye) — appears on hover; always visible when excluded */}
      {interactive && (
        <div
          className={`pointer-events-none absolute right-1 top-1 rounded p-0.5 transition-opacity ${
            disabled ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          style={{
            background: 'rgba(0,0,0,0.55)',
            color: disabled ? 'var(--danger, #e5484d)' : 'var(--text-secondary)',
            backdropFilter: 'blur(4px)',
          }}
        >
          {disabled ? <Icons.EyeOff size={12} /> : <Icons.Eye size={12} />}
        </div>
      )}
    </div>
  )
}


export function SpriteStudio({
  sheet,
  anchor,
  selectedAnim,
  setSelectedAnim,
  generatedAnims,
  prompt,
  setPrompt,
  fps,
  setFps,
  artStyle,
  setArtStyle,
  generating,
  progressMessage,
  onGenerate,
  onRerollCharacter,
  onUploadCharacter,
  onRemoveUploadedCharacter,
  onStop,
  onClear,
  onDownloadSheet,
  onDownloadZip,
  onToggleFrame,
}: {
  sheet: SpriteSheet
  anchor: {
    imageUrl: string
    rawImageUrl: string
    prompt: string
    uploaded?: boolean
  } | null
  selectedAnim: SpriteAnimType
  setSelectedAnim: (v: SpriteAnimType) => void
  generatedAnims: Set<SpriteAnimType>
  prompt: string
  setPrompt: (v: string) => void
  fps: number
  setFps: (v: number) => void
  artStyle: string
  setArtStyle: (v: string) => void
  generating: boolean
  progressMessage?: string | null
  onGenerate: () => void
  onRerollCharacter: () => void
  onUploadCharacter: (file: File) => void
  onRemoveUploadedCharacter: () => void
  onStop: () => void
  onClear: () => void
  onDownloadSheet: () => void
  onDownloadZip: () => void
  onToggleFrame: (index: number) => void
}) {
  const [playing, setPlaying] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const spec = SPRITE_ANIMATIONS[selectedAnim]
  const filledCount = sheet.frames.filter((f) => !!f.imageUrl).length
  const activeCount = sheet.frames.filter((f) => !!f.imageUrl && !f.disabled).length
  const excludedCount = filledCount - activeCount
  const hasAny = filledCount > 0
  // With an uploaded character the prompt is optional (identity comes from the
  // image), so generation is allowed even with an empty prompt.
  const canGenerate = !!prompt.trim() || !!anchor?.uploaded

  // Auto-resume playback whenever a fresh generation arrives.
  useEffect(() => {
    if (hasAny) setPlaying(true)
  }, [hasAny, sheet.anim, sheet.gridSheetUrl])

  return (
    <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-3 sm:px-6">
      <div className="flex items-center justify-center gap-2 text-[12px]">
        <Icons.Play size={12} className="text-[color:var(--accent)]" />
        <span style={{ color: 'var(--text-secondary)' }}>
          Sprite mode — two-pass workflow. Pass 1 generates a character
          anchor; Pass 2 paints all 8 keyframes with the anchor as visual
          reference. Re-use the same character across multiple animations.
        </span>
      </div>

      {/* Animation type picker — chip strip */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {SPRITE_ANIM_ORDER.map((animType) => {
          const animSpec = SPRITE_ANIMATIONS[animType]
          const active = selectedAnim === animType
          const hasSaved = generatedAnims.has(animType) && !active
          return (
            <button
              key={animType}
              type="button"
              onClick={() => setSelectedAnim(animType)}
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
              style={{
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent-bg)' : 'var(--bg-elev)',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                cursor: generating ? 'not-allowed' : 'pointer',
                opacity: generating ? 0.5 : 1,
              }}
              title={
                hasSaved
                  ? `${animSpec.hint} · saved animation — click to view`
                  : animSpec.hint
              }
            >
              {animSpec.label}
              {hasSaved && (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: 'var(--accent)' }}
                  aria-label="has saved animation"
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {generating ? (
          <button
            onClick={onStop}
            className="btn btn-danger"
            title="Stop the current generation"
          >
            <Icons.Stop size={14} />
            Stop
          </button>
        ) : (
          <button
            onClick={onGenerate}
            disabled={!canGenerate}
            className="btn btn-primary"
            title={
              anchor
                ? `Generate the ${spec.label.toLowerCase()} sheet for the existing character (skips the anchor pass — faster)`
                : `Two-pass generation: lock character (Pass 1) + paint ${spec.label.toLowerCase()} sheet (Pass 2)`
            }
          >
            <Icons.Sparkle size={14} />
            {anchor
              ? hasAny
                ? `Re-roll ${spec.label.toLowerCase()}`
                : `Generate ${spec.label.toLowerCase()}`
              : `Lock character + ${spec.label.toLowerCase()}`}
          </button>
        )}
        {anchor && !generating && (
          <button
            onClick={onRerollCharacter}
            disabled={!prompt.trim()}
            className="btn btn-secondary"
            title="Discard the current character and re-roll a fresh anchor + sheet"
          >
            <Icons.Refresh size={14} />
            Re-roll character
          </button>
        )}
        <button
          onClick={onDownloadSheet}
          disabled={!hasAny || generating}
          className="btn btn-secondary"
          title="Export grid sheet + horizontal strip + JSON manifest"
        >
          <Icons.Download size={14} />
          Sheets + manifest
        </button>
        <button
          onClick={onDownloadZip}
          disabled={!hasAny || generating}
          className="btn btn-ghost"
          title="Export individual frame PNGs + grid sheet + strip + manifest as a ZIP"
        >
          <Icons.Layers size={14} />
          ZIP
        </button>
        <button
          onClick={onClear}
          disabled={(!hasAny && !anchor) || generating}
          className="btn btn-ghost"
          title="Clear frames, character anchor, and prompt"
        >
          <Icons.Trash size={14} />
          Clear
        </button>
        <div
          className="rounded-full border px-2.5 py-1 font-mono text-[11px]"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-elev)',
            color: hasAny ? 'var(--text-secondary)' : 'var(--text-muted)',
          }}
        >
          {filledCount}/{SPRITE_FRAME_COUNT} frames
          {progressMessage ? ` · ${progressMessage}` : ''}
        </div>
      </div>

      {/* Two-column body: compact live-player rail on the left, frame grid +
          controls on the right (which carries most of the content). */}
      <div className="grid w-full flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <SpriteAnimationPlayer
            frames={sheet.frames}
            fps={fps}
            loop={spec.loop}
            playing={playing}
            setPlaying={setPlaying}
            anchorImageUrl={anchor?.imageUrl ?? null}
            anchorUploaded={anchor?.uploaded}
          />
          {/* FPS slider */}
          <div
            className="flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2"
            style={{
              border: '1px solid var(--border)',
              background: 'var(--bg-elev)',
            }}
          >
            <label
              className="text-[11px] font-medium uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              FPS
            </label>
            <input
              type="range"
              min={1}
              max={30}
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="parallax-slider flex-1"
              aria-label="Playback FPS"
            />
            <span
              className="w-9 text-right font-mono text-[12px]"
              style={{ color: 'var(--text-secondary)' }}
            >
              {fps}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div
            className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            <span>Frame sheet (4×2)</span>
            <span
              className="font-mono normal-case tracking-normal"
              style={{ color: 'var(--text-muted)' }}
            >
              {SPRITE_SHEET_W}×{SPRITE_SHEET_H} export
            </span>
          </div>
          <div
            className="grid w-full"
            style={{
              gridTemplateColumns: `repeat(${SPRITE_FRAME_COUNT}, 1fr)`,
              gap: '6px',
            }}
          >
            {sheet.frames.map((frame, i) => (
              <SpriteFrameCell
                key={i}
                frame={frame}
                size={SPRITE_FRAME_SIZE}
                highlight={false}
                loading={generating && !frame.imageUrl}
                onToggle={onToggleFrame}
              />
            ))}
          </div>
          <div
            className="text-[11px]"
            style={{ color: 'var(--text-muted)' }}
          >
            Click a frame to exclude it from the animation and all exports;
            click again to bring it back.
            {excludedCount > 0 && (
              <span style={{ color: 'var(--danger, #e5484d)' }}>
                {' '}
                {excludedCount} excluded · {activeCount} active.
              </span>
            )}{' '}
            Row-major reading order: top-left is frame 1, top-right is
            frame 4, bottom-left is frame 5.
          </div>

          {/* Command rail — lives under the sheet column so the layout reads
              balanced against the tall player on the left: character (upload /
              presets) + prompt. The shared scene brief from Parallax/Tile mode
              is still forwarded to the API for palette continuity, but isn't
              surfaced here to keep the sprite flow focused. */}
          <div className="mt-1 flex w-full flex-col gap-2">
        {/* Character section: upload your own OR pick a starter */}
        <div className="flex flex-col gap-2.5">
          <label
            className="text-[11px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            Character
          </label>

          {/* Upload drop-zone — drag & drop or click. Primary path for users
              who already have a character asset. */}
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onUploadCharacter(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => !generating && uploadInputRef.current?.click()}
            disabled={generating}
            onDragOver={(e) => {
              if (generating) return
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              if (generating) return
              const file = e.dataTransfer.files?.[0]
              if (file) onUploadCharacter(file)
            }}
            className="group flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3.5 py-3 text-left transition-colors"
            style={{
              border: `1.5px dashed ${
                dragOver ? 'var(--accent)' : 'var(--border-strong)'
              }`,
              background: dragOver ? 'var(--accent-bg)' : 'var(--bg-elev)',
              cursor: generating ? 'not-allowed' : 'pointer',
              opacity: generating ? 0.5 : 1,
            }}
            title="Upload your own character image and animate it instead of generating one"
          >
            <span
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors"
              style={{
                background: dragOver ? 'var(--accent)' : 'var(--bg)',
                color: dragOver ? '#fff' : 'var(--accent)',
                border: '1px solid var(--border)',
              }}
            >
              <Icons.Upload size={15} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span
                className="text-[13px] font-medium"
                style={{ color: 'var(--text)' }}
              >
                {anchor?.uploaded
                  ? 'Replace uploaded character'
                  : 'Upload your own character'}
              </span>
              <span
                className="text-[11px]"
                style={{ color: 'var(--text-muted)' }}
              >
                Drag &amp; drop or click to browse · transparent PNG works best
              </span>
            </span>
          </button>

          {/* Remove uploaded character — lets the user drop the upload and go
              back to a starter preset or their own prompt. */}
          {anchor?.uploaded && (
            <button
              type="button"
              onClick={onRemoveUploadedCharacter}
              disabled={generating}
              className="inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
              style={{
                border: '1px solid var(--border)',
                background: 'var(--bg-elev)',
                color: 'var(--danger, #e5484d)',
                cursor: generating ? 'not-allowed' : 'pointer',
                opacity: generating ? 0.5 : 1,
              }}
              title="Remove the uploaded character and use a prompt instead"
            >
              <Icons.Trash size={12} />
              Remove uploaded character
            </button>
          )}

          {/* Divider */}
          <div className="flex items-center gap-2">
            <span
              className="h-px flex-1"
              style={{ background: 'var(--border)' }}
            />
            <span
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              or pick a starter
            </span>
            <span
              className="h-px flex-1"
              style={{ background: 'var(--border)' }}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {SPRITE_CHARACTER_PRESETS.map((preset) => {
              const active = prompt.trim() === preset.prompt
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPrompt(preset.prompt)}
                  disabled={generating}
                  className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    border: `1px solid ${
                      active ? 'var(--accent)' : 'var(--border)'
                    }`,
                    background: active ? 'var(--accent-bg)' : 'var(--bg-elev)',
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    cursor: generating ? 'not-allowed' : 'pointer',
                    opacity: generating ? 0.5 : 1,
                  }}
                  title={preset.prompt}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
        </div>

        <div
          className="flex w-full items-stretch gap-2 rounded-[var(--radius-lg)] p-1.5"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--border-strong)',
            boxShadow: '0 12px 32px -12px rgba(0,0,0,0.6)',
          }}
        >
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={generating}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                canGenerate &&
                !generating
              ) {
                e.preventDefault()
                onGenerate()
              }
            }}
            placeholder={
              anchor?.uploaded
                ? 'Optional: describe the character to refine results'
                : 'Describe the character — or pick a starter above'
            }
            className="flex-1 bg-transparent px-3 py-2.5 text-[14px] focus:outline-none"
            style={{ color: 'var(--text)' }}
          />
          <div
            className="hidden items-center sm:flex"
            style={{ borderLeft: '1px solid var(--border)' }}
          >
            <select
              value={artStyle}
              onChange={(e) => setArtStyle(e.target.value)}
              disabled={generating}
              className="select-styled cursor-pointer border-0 bg-transparent py-2 pl-3 pr-7 text-[13px] focus:outline-none"
              style={{ color: 'var(--text-secondary)' }}
              title="Art style for the sprite sheet"
            >
              {ART_STYLE_GROUPS.map((group) =>
                group.options.length === 1 && group.label === 'Match original' ? (
                  <option key={group.options[0].value} value={group.options[0].value}>
                    {group.options[0].label}
                  </option>
                ) : (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                )
              )}
            </select>
          </div>
        </div>
      </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state — drop zone for upload + generate link
// ─────────────────────────────────────────────────────────────────────────────

