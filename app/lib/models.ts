'use client'

export type ModelOption = {
  value: string
  label: string
  hint?: string
  /**
   * Max best-of-N attempts for horizontal extensions on this model.
   * Slow models (GPT-5.4-image-2 takes ~4 min/call) get 1 to avoid
   * multi-minute blind waits; fast models get 3 for seam-quality picking.
   */
  maxAttempts: number
  /** Rough single-call expected duration, shown to the user as guidance. */
  approxSecondsPerCall: number
}


export const MODELS: ModelOption[] = [
  {
    value: 'google/gemini-3-pro-image-preview',
    label: 'Gemini 3 Pro Image',
    hint: 'Nano Banana Pro · highest fidelity',
    maxAttempts: 1,
    approxSecondsPerCall: 75,
  },
  {
    value: 'google/gemini-3.1-flash-image-preview',
    label: 'Gemini 3 Flash Image',
    hint: 'Nano Banana 2 · fast · default',
    maxAttempts: 3,
    approxSecondsPerCall: 18,
  },
  {
    value: 'google/gemini-2.5-flash-image',
    label: 'Gemini 2.5 Flash Image',
    hint: 'Nano Banana · stable',
    maxAttempts: 3,
    approxSecondsPerCall: 15,
  },
]


export const DEFAULT_MODEL = 'google/gemini-3.1-flash-image-preview'

export function getModelConfig(value: string): ModelOption {
  return (
    MODELS.find((m) => m.value === value) ||
    MODELS.find((m) => m.value === DEFAULT_MODEL) ||
    MODELS[0]
  )
}


export function maskKey(key: string): string {
  if (!key) return ''
  const tail = key.slice(-4)
  return `${'•'.repeat(Math.max(4, Math.min(20, key.length - 4)))}${tail}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Art styles — flat list with optional grouping for the dropdown
// ─────────────────────────────────────────────────────────────────────────────

