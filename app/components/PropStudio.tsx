'use client'

import { Icons } from '@/app/components/icons'
import { ART_STYLE_GROUPS } from '@/app/lib/artStyles'
import { PROP_PRESETS, PropItem } from '@/app/lib/props'

export function PropItemCell({
  item,
  index,
  onRegenerate,
  onDelete,
  busy,
}: {
  item: PropItem
  index: number
  onRegenerate: () => void
  onDelete: () => void
  busy: boolean
}) {
  return (
    <div
      className="group relative checker overflow-hidden rounded-[var(--radius-md)] anim-fade"
      style={{ border: '1px solid var(--border)', aspectRatio: '1 / 1' }}
    >
      {item.imageUrl ? (
        <img
          src={item.imageUrl}
          alt={`Prop ${index + 1}`}
          draggable={false}
          className="block h-full w-full"
          style={{ objectFit: 'contain' }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-[10px] font-mono"
          style={{
            color: 'var(--text-muted)',
            background:
              'repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,0.025) 6px 12px)',
          }}
        />
      )}

      {item.generating && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)' }}
        >
          <Icons.Spinner size={18} className="text-[color:var(--accent)]" />
        </div>
      )}

      <div
        className="pointer-events-none absolute left-1 top-1 rounded px-1 py-px font-mono text-[9px]"
        style={{
          background: 'rgba(0,0,0,0.45)',
          color: 'var(--text-secondary)',
          backdropFilter: 'blur(4px)',
        }}
      >
        {index + 1}
      </div>

      {item.imageUrl && !item.generating && (
        <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={onRegenerate}
            disabled={busy}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full"
            style={{
              background: 'rgba(0,0,0,0.6)',
              color: 'var(--accent)',
              backdropFilter: 'blur(4px)',
            }}
            title="Re-roll this prop — a new decoration matched to the rest of the set"
          >
            <Icons.Sparkle size={11} />
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full"
            style={{
              background: 'rgba(0,0,0,0.6)',
              color: 'var(--danger, #ff6b6b)',
              backdropFilter: 'blur(4px)',
            }}
            title="Delete this prop from the library"
          >
            <Icons.Trash size={11} />
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PropStudio — an OPEN-ENDED decoration library. Each "add more" press paints a
// fresh batch of decorations (the model invents them) and appends them to a
// growing gallery; existing props are never regenerated. Per-prop re-roll +
// delete let the user curate. Export packs the whole library into one atlas.
// ─────────────────────────────────────────────────────────────────────────────

export function PropStudio({
  items,
  batchSize,
  prompt,
  setPrompt,
  artStyle,
  setArtStyle,
  generating,
  progressMessage,
  sceneBrief,
  setSceneBrief,
  sceneBriefLoading,
  onAddMore,
  onStop,
  onRegenerate,
  onDelete,
  onClearAll,
  onDownloadSheet,
  onDownloadZip,
}: {
  items: PropItem[]
  batchSize: number
  prompt: string
  setPrompt: (v: string) => void
  artStyle: string
  setArtStyle: (v: string) => void
  generating: boolean
  progressMessage?: string | null
  sceneBrief: string
  setSceneBrief: (v: string) => void
  sceneBriefLoading: boolean
  onAddMore: () => void
  onStop: () => void
  onRegenerate: (id: string) => void
  onDelete: (id: string) => void
  onClearAll: () => void
  onDownloadSheet: () => void
  onDownloadZip: () => void
}) {
  const filledCount = items.filter((p) => p.imageUrl).length
  const hasAny = filledCount > 0

  return (
    <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-3 sm:px-6">
      <div className="flex items-center justify-center gap-2 text-center text-[12px]">
        <Icons.Sprout size={14} className="text-[color:var(--accent)]" />
        <span style={{ color: 'var(--text-secondary)' }}>
          Props mode — a growing library of transparent decorations to scatter
          on top of your tile map (the way Hollow Knight layers detail over its
          geometry). Each press paints {batchSize} new props the model invents
          for your biome; keep adding for an endless set.
        </span>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {generating ? (
          <button onClick={onStop} className="btn btn-danger" title="Stop the current generation">
            <Icons.Stop size={14} />
            Stop
          </button>
        ) : (
          <button
            onClick={onAddMore}
            disabled={!prompt.trim()}
            className="btn btn-primary"
            title={
              hasAny
                ? `Paint ${batchSize} more decorations and add them to the library`
                : `Paint your first ${batchSize} decorations`
            }
          >
            <Icons.Plus size={14} />
            {hasAny ? `Add ${batchSize} more` : `Generate ${batchSize} props`}
          </button>
        )}
        <button
          onClick={onDownloadSheet}
          disabled={!hasAny || generating}
          className="btn btn-secondary"
          title="Export the packed transparent atlas PNG with a JSON manifest"
        >
          <Icons.Download size={14} />
          Atlas + manifest
        </button>
        <button
          onClick={onDownloadZip}
          disabled={!hasAny || generating}
          className="btn btn-ghost"
          title="Export individual transparent PNGs + atlas + manifest as a ZIP"
        >
          <Icons.Layers size={14} />
          ZIP
        </button>
        <button
          onClick={onClearAll}
          disabled={!hasAny || generating}
          className="btn btn-ghost"
          title="Clear the whole library and start over"
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
          {filledCount} prop{filledCount === 1 ? '' : 's'}
          {progressMessage ? ` · ${progressMessage}` : ''}
        </div>
      </div>

      {/* Library gallery */}
      <div className="flex flex-col gap-2">
        <div
          className="text-[11px] font-medium uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Decoration library
        </div>
        {items.length === 0 ? (
          <div
            className="mx-auto flex w-full max-w-3xl items-center justify-center rounded-[var(--radius-lg)] px-6 py-12 text-center text-[12px]"
            style={{
              border: '1px dashed var(--border)',
              color: 'var(--text-muted)',
              background:
                'repeating-linear-gradient(45deg, transparent 0 8px, rgba(255,255,255,0.015) 8px 16px)',
            }}
          >
            Pick a biome below and press “Generate {batchSize} props” to start
            your decoration library. Keep pressing “Add more” to grow it.
          </div>
        ) : (
          <div
            className="mx-auto grid w-full max-w-4xl"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(110px, 1fr))`,
              gap: '6px',
            }}
          >
            {items.map((item, i) => (
              <PropItemCell
                key={item.id}
                item={item}
                index={i}
                onRegenerate={() => onRegenerate(item.id)}
                onDelete={() => onDelete(item.id)}
                busy={generating}
              />
            ))}
          </div>
        )}
        <div className="mx-auto max-w-4xl text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Every prop is exported on transparency. Hover a prop to re-roll or
          delete it. New batches are style-matched to what you already have, so
          the library stays cohesive as it grows.
        </div>
      </div>

      {/* Bottom command rail: scene direction + prompt + style */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <div
          className="rounded-[var(--radius-lg)] p-3"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--border-strong)',
            boxShadow: '0 8px 24px -8px rgba(0,0,0,0.5)',
          }}
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label
              className="text-[11px] font-medium uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              Scene direction
            </label>
            {sceneBriefLoading && (
              <span
                className="inline-flex items-center gap-1 text-[10px]"
                style={{ color: 'var(--accent)' }}
              >
                <Icons.Spinner size={10} />
                Updating…
              </span>
            )}
          </div>
          <textarea
            value={sceneBrief}
            onChange={(e) => setSceneBrief(e.target.value)}
            disabled={generating || sceneBriefLoading}
            placeholder="Optional shared art direction. Reused from your parallax / tile work so the props match the same palette and lighting."
            rows={2}
            className="field w-full resize-none text-[13px] leading-relaxed"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            className="text-[11px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            Quick start
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PROP_PRESETS.map((preset) => {
              const active = prompt.trim() === preset.prompt
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPrompt(preset.prompt)}
                  disabled={generating}
                  className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
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
              if (e.key === 'Enter' && !e.shiftKey && prompt.trim() && !generating) {
                e.preventDefault()
                onAddMore()
              }
            }}
            placeholder="Describe the biome / palette — or pick a quick start above"
            className="flex-1 bg-transparent px-3 py-2.5 text-[14px] focus:outline-none"
            style={{ color: 'var(--text)' }}
          />
          <div className="hidden items-center sm:flex" style={{ borderLeft: '1px solid var(--border)' }}>
            <select
              value={artStyle}
              onChange={(e) => setArtStyle(e.target.value)}
              disabled={generating}
              className="select-styled cursor-pointer border-0 bg-transparent py-2 pl-3 pr-7 text-[13px] focus:outline-none"
              style={{ color: 'var(--text-secondary)' }}
              title="Art style for the props"
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
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SpriteStudio — generate a full character animation as ONE AI call so palette,
// outfit, proportions, and lighting stay locked across all 8 keyframes. Layout
// is a fixed 4×2 grid that we slice into individual frames after chroma-keying
// magenta → alpha. A live animation player shows the result playing back at
// the animation's native FPS so the designer can verify the cycle before export.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Animation player — composites the current sprite-sheet frames into an
 * actual playing animation at the user-controlled FPS. Skips empty frames
 * (lets the studio render partial sheets gracefully during generation).
 */
