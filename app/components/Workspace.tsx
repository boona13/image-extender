'use client'

import { Icons } from '@/app/components/icons'
import { StatusPill } from '@/app/components/TopBar'
import { Direction } from '@/app/lib/app'

export function EdgeHandle({
  direction,
  onClick,
  active,
  disabled,
}: {
  direction: Direction
  onClick: (d: Direction) => void
  active: boolean
  disabled: boolean
}) {
  const Icon = {
    up: Icons.ArrowUp,
    down: Icons.ArrowDown,
    left: Icons.ArrowLeft,
    right: Icons.ArrowRight,
  }[direction]

  const position: React.CSSProperties = {
    up: { top: -22, left: '50%', transform: 'translateX(-50%)' },
    down: { bottom: -22, left: '50%', transform: 'translateX(-50%)' },
    left: { left: -22, top: '50%', transform: 'translateY(-50%)' },
    right: { right: -22, top: '50%', transform: 'translateY(-50%)' },
  }[direction]

  return (
    <button
      onClick={() => onClick(direction)}
      disabled={disabled}
      title={`Extend ${direction}`}
      aria-label={`Extend ${direction}`}
      className={`group absolute z-10 flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 ${
        active ? 'anim-pulse' : ''
      }`}
      style={{
        ...position,
        background: active ? 'var(--accent)' : 'var(--bg-elev)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
        color: active ? '#1a1404' : 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !active ? 0.4 : 1,
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
      <Icon size={18} />
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace — image with edge handles, dimensions label, and result actions
// ─────────────────────────────────────────────────────────────────────────────


export function Workspace({
  image,
  dimensions,
  onExtend,
  activeDirection,
  loading,
  progressMessage,
  isResult,
  resultMessage,
  variantSelector,
  resultActions,
}: {
  image: string
  dimensions: { width: number; height: number } | null
  onExtend: (d: Direction) => void
  activeDirection: Direction | null
  loading: boolean
  progressMessage?: string | null
  isResult: boolean
  resultMessage?: string
  /**
   * Optional cycle-between-variants control rendered next to the dimension
   * pill. Only shown when the current extension produced more than one
   * candidate.
   */
  variantSelector?: React.ReactNode
  resultActions?: React.ReactNode
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-6 pb-6 pt-2">
      {/* Image frame */}
      <div className="relative max-h-[calc(100vh-260px)] max-w-[min(1200px,calc(100vw-96px))] anim-fade">
        {/* Edge glow overlays for the active direction */}
        {activeDirection && (
          <div
            className={`pointer-events-none absolute inset-0 rounded-[var(--radius-lg)] edge-glow-${activeDirection}`}
          />
        )}

        <div
          className="relative overflow-hidden rounded-[var(--radius-lg)] checker"
          style={{
            border: '1px solid var(--border)',
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 48px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.4)',
          }}
        >
          <img
            src={image}
            alt=""
            className="block max-h-[calc(100vh-260px)] max-w-[min(1200px,calc(100vw-96px))] object-contain anim-fade"
            draggable={false}
          />
        </div>

        {/* Edge handles — only when not displaying a result */}
        {!isResult && (
          <>
            <EdgeHandle
              direction="up"
              onClick={onExtend}
              active={activeDirection === 'up'}
              disabled={loading}
            />
            <EdgeHandle
              direction="down"
              onClick={onExtend}
              active={activeDirection === 'down'}
              disabled={loading}
            />
            <EdgeHandle
              direction="left"
              onClick={onExtend}
              active={activeDirection === 'left'}
              disabled={loading}
            />
            <EdgeHandle
              direction="right"
              onClick={onExtend}
              active={activeDirection === 'right'}
              disabled={loading}
            />
          </>
        )}
      </div>

      {/* Below-image meta row */}
      <div className="mt-5 flex items-center gap-3 anim-slide-up">
        {dimensions && (
          <div
            className="rounded-full border px-2.5 py-1 font-mono text-[11px]"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg-elev)',
              color: 'var(--text-secondary)',
            }}
          >
            {dimensions.width} × {dimensions.height}
          </div>
        )}
        {isResult && variantSelector}
        {isResult && resultMessage && (
          <StatusPill status="ok" message={resultMessage} />
        )}
        {!isResult && !loading && (
          <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Click an edge to extend
          </span>
        )}
        {loading && (
          <StatusPill
            status="working"
            message={progressMessage || (activeDirection ? `Extending ${activeDirection}…` : 'Working…')}
          />
        )}
      </div>

      {isResult && resultActions && (
        <div className="mt-4 anim-slide-up">{resultActions}</div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MultiLayerPreview — composites every populated parallax layer at its own
// scroll speed so the user can feel real depth before exporting. Each layer
// is a stacked div with a `repeat-x` background animated independently.
// ─────────────────────────────────────────────────────────────────────────────

