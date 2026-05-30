'use client'

import { Icons } from '@/app/components/icons'

export function VariantSelector({
  index,
  total,
  isBest,
  score,
  onPrev,
  onNext,
}: {
  index: number
  total: number
  /** True when the current variant is the algorithm-picked best blend. */
  isBest: boolean
  /** Optional raw seam score, only shown in debug mode. */
  score?: number
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-1 pr-2 anim-fade"
      style={{
        borderColor: 'var(--border-strong)',
        background: 'var(--bg-elev)',
      }}
      role="group"
      aria-label="Cycle between extension variants"
    >
      <button
        onClick={onPrev}
        className="icon-btn h-6 w-6"
        aria-label="Previous variant (←)"
        title="Previous variant (←)"
      >
        <Icons.ArrowLeft size={13} />
      </button>
      <span
        className="font-mono text-[11px] tabular-nums"
        style={{ color: 'var(--text-secondary)' }}
      >
        Variant {index + 1}/{total}
      </span>
      {isBest && (
        <span
          className="rounded-full px-1.5 py-px text-[10px] font-medium tracking-wide"
          style={{
            background: 'var(--accent-bg)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-border)',
          }}
          title="Algorithm's pick: lowest seam residual"
        >
          BEST
        </span>
      )}
      {typeof score === 'number' && (
        <span
          className="font-mono text-[10px]"
          style={{ color: 'var(--text-muted)' }}
          title="Mean color difference at the seam — lower is better"
        >
          {score.toFixed(1)}
        </span>
      )}
      <button
        onClick={onNext}
        className="icon-btn h-6 w-6"
        aria-label="Next variant (→)"
        title="Next variant (→)"
      >
        <Icons.ArrowRight size={13} />
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Result actions — appears below the image when an extension is ready
// ─────────────────────────────────────────────────────────────────────────────


export function ResultActions({
  onAccept,
  onRegenerate,
  onDiscard,
  onDownload,
  loading,
}: {
  onAccept: () => void
  onRegenerate: () => void
  onDiscard: () => void
  onDownload: () => void
  loading: boolean
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border p-1"
      style={{
        background: 'var(--bg-elev)',
        borderColor: 'var(--border-strong)',
        boxShadow: '0 12px 32px -16px rgba(0,0,0,0.6)',
      }}
    >
      <button
        onClick={onDiscard}
        disabled={loading}
        className="btn btn-ghost"
        title="Discard this extension"
      >
        <Icons.X size={14} />
        Discard
      </button>
      <button
        onClick={onRegenerate}
        disabled={loading}
        className="btn btn-ghost"
        title="Generate a new variation"
      >
        {loading ? <Icons.Spinner size={14} /> : <Icons.Refresh size={14} />}
        Regenerate
      </button>
      <button
        onClick={onDownload}
        disabled={loading}
        className="btn btn-ghost"
        title="Download as PNG"
      >
        <Icons.Download size={14} />
        Download
      </button>
      <div
        className="mx-1 h-5 w-px"
        style={{ background: 'var(--border)' }}
        aria-hidden
      />
      <button
        onClick={onAccept}
        disabled={loading}
        className="btn btn-primary"
        title="Use this as the new base image"
      >
        <Icons.Check size={14} />
        Accept
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings drawer — debug mode, generate-from-scratch entry point
// ─────────────────────────────────────────────────────────────────────────────

