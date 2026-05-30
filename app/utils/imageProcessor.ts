export async function expandCanvas(
  originalImageDataUrl: string,
  direction: 'up' | 'down' | 'left' | 'right',
  extensionPercent: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      const originalWidth = img.width
      const originalHeight = img.height
      
      // Calculate new dimensions
      let newWidth = originalWidth
      let newHeight = originalHeight
      let offsetX = 0
      let offsetY = 0
      
      const extensionAmount = extensionPercent / 100
      
      switch (direction) {
        case 'right':
          newWidth = Math.round(originalWidth * (1 + extensionAmount))
          offsetX = 0
          offsetY = 0
          break
        case 'left':
          newWidth = Math.round(originalWidth * (1 + extensionAmount))
          offsetX = newWidth - originalWidth
          offsetY = 0
          break
        case 'down':
          newHeight = Math.round(originalHeight * (1 + extensionAmount))
          offsetX = 0
          offsetY = 0
          break
        case 'up':
          newHeight = Math.round(originalHeight * (1 + extensionAmount))
          offsetX = 0
          offsetY = newHeight - originalHeight
          break
      }
      
      // Create canvas
      const canvas = document.createElement('canvas')
      canvas.width = newWidth
      canvas.height = newHeight
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      
      // Fill with white background (AI will fill this)
      ctx.fillStyle = EXTENSION_BLANK_COLOR
      ctx.fillRect(0, 0, newWidth, newHeight)
      
      // Draw original image at offset position
      ctx.drawImage(img, offsetX, offsetY, originalWidth, originalHeight)
      
      // Convert to data URL
      resolve(canvas.toDataURL('image/png'))
    }
    
    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }
    
    img.src = originalImageDataUrl
  })
}

// New approach - send full image for context, but mark the area to extend
export async function createFullContextExtension(
  originalImageDataUrl: string,
  direction: 'up' | 'down' | 'left' | 'right',
  extensionPercent: number,
  referenceOriginalDimensions?: { width: number; height: number },
  maxDimension: number = 1536
): Promise<{ fullImageWithBlankArea: string; extensionInfo: ExtensionInfo }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      const currentWidth = img.width
      const currentHeight = img.height
      
      const refWidth = referenceOriginalDimensions?.width || currentWidth
      const refHeight = referenceOriginalDimensions?.height || currentHeight
      
      const extensionAmount = extensionPercent / 100
      const extensionHeight = Math.round(refHeight * extensionAmount)
      const extensionWidth = Math.round(refWidth * extensionAmount)
      
      let newWidth = currentWidth
      let newHeight = currentHeight
      let originalOffsetX = 0
      let originalOffsetY = 0
      let extensionRegion: { x: number; y: number; width: number; height: number }
      
      switch (direction) {
        case 'up':
          newHeight = currentHeight + extensionHeight
          originalOffsetY = extensionHeight
          extensionRegion = { x: 0, y: 0, width: currentWidth, height: extensionHeight }
          break
        case 'down':
          newHeight = currentHeight + extensionHeight
          originalOffsetY = 0
          extensionRegion = { x: 0, y: currentHeight, width: currentWidth, height: extensionHeight }
          break
        case 'left':
          newWidth = currentWidth + extensionWidth
          originalOffsetX = extensionWidth
          extensionRegion = { x: 0, y: 0, width: extensionWidth, height: currentHeight }
          break
        case 'right':
          newWidth = currentWidth + extensionWidth
          originalOffsetX = 0
          extensionRegion = { x: currentWidth, y: 0, width: extensionWidth, height: currentHeight }
          break
      }
      
      const canvas = document.createElement('canvas')
      canvas.width = newWidth
      canvas.height = newHeight
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      
      ctx.fillStyle = EXTENSION_BLANK_COLOR
      ctx.fillRect(0, 0, newWidth, newHeight)
      ctx.drawImage(img, originalOffsetX, originalOffsetY, currentWidth, currentHeight)
      
      const extensionInfo: ExtensionInfo = {
        direction,
        originalWidth: currentWidth,
        originalHeight: currentHeight,
        newWidth,
        newHeight,
        extensionRegion,
        originalPosition: { x: originalOffsetX, y: originalOffsetY }
      }
      
      const fullImageDataUrl = canvas.toDataURL('image/png')
      smartDownscale(fullImageDataUrl, direction, maxDimension).then(({ dataUrl, scale }) => {
        resolve({
          fullImageWithBlankArea: dataUrl,
          extensionInfo: { ...extensionInfo, scale }
        })
      }).catch(() => {
        resolve({
          fullImageWithBlankArea: fullImageDataUrl,
          extensionInfo: { ...extensionInfo, scale: 1 }
        })
      })
    }
    
    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }
    
    img.src = originalImageDataUrl
  })
}

const EXTENSION_BLANK_COLOR = '#B0B0B0' // Gray blank area — distinguishable from white snow/sky in photos

export type ImageAlign = {
  x?: 'left' | 'center' | 'right'
  y?: 'top' | 'center' | 'bottom'
}

function getAlignOffset(target: number, scaled: number, align: 'left' | 'center' | 'right' | 'top' | 'bottom'): number {
  if (align === 'left' || align === 'top') return 0
  if (align === 'right' || align === 'bottom') return target - scaled
  return (target - scaled) / 2
}

/** Chunk alignment: anchor the edge that connects to the original image. */
export function getChunkAlign(direction: 'up' | 'down' | 'left' | 'right'): ImageAlign {
  switch (direction) {
    case 'right': return { x: 'left', y: 'center' }   // context on left of chunk
    case 'left': return { x: 'right', y: 'center' }   // context on right of chunk
    case 'down': return { x: 'center', y: 'top' }
    case 'up': return { x: 'center', y: 'bottom' }
  }
}

/** Full-canvas alignment: anchor the side where the original image sits. */
export function getCanvasAlign(direction: 'up' | 'down' | 'left' | 'right'): ImageAlign {
  switch (direction) {
    case 'right': return { x: 'left', y: 'center' }
    case 'left': return { x: 'right', y: 'center' }
    case 'down': return { x: 'center', y: 'top' }
    case 'up': return { x: 'center', y: 'bottom' }
  }
}

/** Resize image to exact dimensions with explicit alignment (cover + crop). */
export function normalizeImageToSize(
  imageDataUrl: string,
  targetWidth: number,
  targetHeight: number,
  align: ImageAlign = { x: 'center', y: 'center' }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      if (img.width === targetWidth && img.height === targetHeight) {
        resolve(imageDataUrl)
        return
      }

      const canvas = document.createElement('canvas')
      canvas.width = targetWidth
      canvas.height = targetHeight
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        resolve(imageDataUrl)
        return
      }

      const scale = Math.max(targetWidth / img.width, targetHeight / img.height)
      const scaledWidth = img.width * scale
      const scaledHeight = img.height * scale

      const offsetX = getAlignOffset(targetWidth, scaledWidth, align.x ?? 'center')
      const offsetY = getAlignOffset(targetHeight, scaledHeight, align.y ?? 'center')

      ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight)
      resolve(canvas.toDataURL('image/png'))
    }

    img.onerror = () => reject(new Error('Failed to load image for normalization'))
    img.src = imageDataUrl
  })
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

/** Check if the horizontal extension strip is still unfilled after stitching. */
export async function isChunkExtensionUnfilled(
  imageDataUrl: string,
  chunkInfo: ChunkInfo
): Promise<boolean> {
  const img = await loadImageElement(imageDataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  ctx.drawImage(img, 0, 0)
  const { direction, extensionSize, originalWidth } = chunkInfo

  let x = 0
  if (direction === 'right') x = originalWidth
  else if (direction === 'left') x = 0
  else return false

  const data = ctx.getImageData(x, 0, extensionSize, img.height).data
  let blankPixels = 0
  const totalPixels = extensionSize * img.height
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (r > 200 && g > 200 && b > 200) blankPixels++
    else if (Math.abs(r - 176) < 30 && Math.abs(g - 176) < 30 && Math.abs(b - 176) < 30) blankPixels++
  }
  return blankPixels / totalPixels > 0.5
}

/** Check if the extension region is still mostly unfilled (gray/white). */
export async function isExtensionRegionUnfilled(
  imageDataUrl: string,
  extensionInfo: ExtensionInfo
): Promise<boolean> {
  const img = await loadImageElement(imageDataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = extensionInfo.newWidth
  canvas.height = extensionInfo.newHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  ctx.drawImage(img, 0, 0, extensionInfo.newWidth, extensionInfo.newHeight)
  const { x, y, width, height } = extensionInfo.extensionRegion
  const data = ctx.getImageData(x, y, width, height).data

  let blankPixels = 0
  const totalPixels = width * height
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (r > 200 && g > 200 && b > 200) blankPixels++
    else if (Math.abs(r - 176) < 30 && Math.abs(g - 176) < 30 && Math.abs(b - 176) < 30) blankPixels++
  }
  return blankPixels / totalPixels > 0.5
}

/**
 * Pre-correction: shift AI's bulk color in the extension area to match the
 * original's color at the seam. This handles the low-frequency color component
 * directly (the slowest-converging part of Gauss-Seidel) so Poisson only has
 * to clean up the high-frequency residual (gradients, fine detail), where it's
 * efficient. Massively reduces visible color seams across uniform regions
 * like sky, water, snow.
 *
 * Uniform shift preserves the AI's gradients (Laplacian of (S+c) = Laplacian
 * of S) so Poisson's gradient field is unchanged — only the starting color is
 * shifted to be near the right answer.
 */
function preCorrectAiColor(
  dstU8: Uint8ClampedArray,
  srcU8: Uint8ClampedArray,
  extensionInfo: ExtensionInfo,
  w: number,
  h: number
): { dR: number; dG: number; dB: number } {
  const { direction, originalWidth, originalHeight, originalPosition, extensionRegion } = extensionInfo
  const SAMPLE_DEPTH = 30
  const isHorizontal = direction === 'left' || direction === 'right'
  const isRight = direction === 'right'
  const isDown = direction === 'down'

  let oR = 0, oG = 0, oB = 0, oN = 0
  let aR = 0, aG = 0, aB = 0, aN = 0

  if (isHorizontal) {
    const seamX = isRight ? originalWidth + originalPosition.x : originalPosition.x
    for (let y = 0; y < h; y++) {
      for (let d = 1; d <= SAMPLE_DEPTH; d++) {
        const origX = isRight ? seamX - d : seamX + d - 1
        const aiX = isRight ? seamX + d - 1 : seamX - d
        if (origX >= 0 && origX < w) {
          const idx = (y * w + origX) * 4
          oR += dstU8[idx]; oG += dstU8[idx + 1]; oB += dstU8[idx + 2]; oN++
        }
        if (aiX >= 0 && aiX < w) {
          const idx = (y * w + aiX) * 4
          aR += srcU8[idx]; aG += srcU8[idx + 1]; aB += srcU8[idx + 2]; aN++
        }
      }
    }
  } else {
    const seamY = isDown ? originalHeight + originalPosition.y : originalPosition.y
    for (let x = 0; x < w; x++) {
      for (let d = 1; d <= SAMPLE_DEPTH; d++) {
        const origY = isDown ? seamY - d : seamY + d - 1
        const aiY = isDown ? seamY + d - 1 : seamY - d
        if (origY >= 0 && origY < h) {
          const idx = (origY * w + x) * 4
          oR += dstU8[idx]; oG += dstU8[idx + 1]; oB += dstU8[idx + 2]; oN++
        }
        if (aiY >= 0 && aiY < h) {
          const idx = (aiY * w + x) * 4
          aR += srcU8[idx]; aG += srcU8[idx + 1]; aB += srcU8[idx + 2]; aN++
        }
      }
    }
  }

  if (oN === 0 || aN === 0) return { dR: 0, dG: 0, dB: 0 }

  const dR = oR / oN - aR / aN
  const dG = oG / oN - aG / aN
  const dB = oB / oN - aB / aN

  // Apply uniform delta to AI pixels in the extension area in dstU8 (which
  // becomes Poisson's initial guess). srcU8 is left unchanged because uniform
  // shift doesn't affect the Laplacian.
  const { x: rx, y: ry, width: rw, height: rh } = extensionRegion
  for (let y = ry; y < ry + rh; y++) {
    const row = y * w
    for (let x = rx; x < rx + rw; x++) {
      const idx = (row + x) * 4
      const r = dstU8[idx] + dR
      const g = dstU8[idx + 1] + dG
      const b = dstU8[idx + 2] + dB
      dstU8[idx]     = r < 0 ? 0 : r > 255 ? 255 : r
      dstU8[idx + 1] = g < 0 ? 0 : g > 255 ? 255 : g
      dstU8[idx + 2] = b < 0 ? 0 : b > 255 ? 255 : b
    }
  }

  return { dR, dG, dB }
}

/**
 * Measure the residual seam quality after blending. Samples pixels just inside
 * vs just outside the seam and returns the mean absolute color difference per
 * channel. Lower = less visible seam (under ~6 is typically invisible at normal
 * viewing distance; over ~15 is clearly visible).
 *
 * Used by `applyFullContextResult` for the multi-attempt "best of N" selection
 * so we automatically pick the AI generation that blended best — addressing the
 * common pattern of needing to manually regenerate to get an acceptable result.
 */
export async function measureSeamResidual(
  blendedImageDataUrl: string,
  extensionInfo: ExtensionInfo,
  originalImageDataUrl: string
): Promise<number> {
  const [blendedImg, originalImg] = await Promise.all([
    loadImageElement(blendedImageDataUrl),
    loadImageElement(originalImageDataUrl),
  ])
  const { direction, originalWidth, originalHeight, newWidth, newHeight, originalPosition } = extensionInfo

  // Render original-at-correct-position reference and blended into the same canvas size.
  const refCanvas = document.createElement('canvas')
  refCanvas.width = newWidth
  refCanvas.height = newHeight
  const refCtx = refCanvas.getContext('2d')!
  refCtx.drawImage(
    originalImg,
    0, 0, originalWidth, originalHeight,
    originalPosition.x, originalPosition.y, originalWidth, originalHeight
  )
  const refData = refCtx.getImageData(0, 0, newWidth, newHeight).data

  const blendedCanvas = document.createElement('canvas')
  blendedCanvas.width = newWidth
  blendedCanvas.height = newHeight
  const blendedCtx = blendedCanvas.getContext('2d')!
  blendedCtx.drawImage(blendedImg, 0, 0, newWidth, newHeight)
  const blendedData = blendedCtx.getImageData(0, 0, newWidth, newHeight).data

  // Sample 4 pixels just inside the original side, 4 pixels just inside the
  // blended side of the seam. Measure mean abs delta between them.
  const SAMPLE_OFFSET = 4
  const isHorizontal = direction === 'left' || direction === 'right'
  const isRight = direction === 'right'
  const isDown = direction === 'down'

  let total = 0
  let count = 0

  if (isHorizontal) {
    const seamX = isRight ? originalWidth + originalPosition.x : originalPosition.x
    const origX = isRight ? seamX - SAMPLE_OFFSET : seamX + SAMPLE_OFFSET - 1
    const aiX = isRight ? seamX + SAMPLE_OFFSET - 1 : seamX - SAMPLE_OFFSET
    if (origX < 0 || origX >= newWidth || aiX < 0 || aiX >= newWidth) return 0
    for (let y = 0; y < newHeight; y++) {
      const origIdx = (y * newWidth + origX) * 4
      const aiIdx = (y * newWidth + aiX) * 4
      total += Math.abs(refData[origIdx] - blendedData[aiIdx])
      total += Math.abs(refData[origIdx + 1] - blendedData[aiIdx + 1])
      total += Math.abs(refData[origIdx + 2] - blendedData[aiIdx + 2])
      count += 3
    }
  } else {
    const seamY = isDown ? originalHeight + originalPosition.y : originalPosition.y
    const origY = isDown ? seamY - SAMPLE_OFFSET : seamY + SAMPLE_OFFSET - 1
    const aiY = isDown ? seamY + SAMPLE_OFFSET - 1 : seamY - SAMPLE_OFFSET
    if (origY < 0 || origY >= newHeight || aiY < 0 || aiY >= newHeight) return 0
    for (let x = 0; x < newWidth; x++) {
      const origIdx = (origY * newWidth + x) * 4
      const aiIdx = (aiY * newWidth + x) * 4
      total += Math.abs(refData[origIdx] - blendedData[aiIdx])
      total += Math.abs(refData[origIdx + 1] - blendedData[aiIdx + 1])
      total += Math.abs(refData[origIdx + 2] - blendedData[aiIdx + 2])
      count += 3
    }
  }

  return count > 0 ? total / count : 0
}

/**
 * Poisson image editing (Pérez et al. 2003) via Gauss-Seidel iterations.
 *
 * Solves ΔV = ΔS inside Ω with V = D on ∂Ω, which preserves the AI's
 * gradients (texture/detail) while forcing the seam pixels to match the
 * original's colors. Used in tandem with `preCorrectAiColor` which handles the
 * bulk color shift separately.
 *
 * Implementation notes:
 *   • Gauss-Seidel (red-black ordering) converges ~2× faster than plain Jacobi.
 *   • Mask is grown into the original by GROW_PX along the seam direction so
 *     the Dirichlet boundary sits inside the original, absorbing sub-pixel
 *     mismatches at the AI-original interface (the "grow then blur" trick
 *     from AUTOMATIC1111's outpainting_mk_2.py and ComfyUI's MaskGrow node).
 *   • Iterates the FULL mask including canvas-edge rows/cols (with replicate
 *     padding for out-of-bounds neighbors → Neumann boundary at canvas edges).
 *     Skipping these was making Poisson's boundary effectively "AI color" on
 *     3 of 4 sides for full-height/width extensions, causing color seams to
 *     persist deep into the strip.
 *   • All work is in Float32 typed arrays over the mask's bounding box.
 */
function poissonBlendOutpaint(
  originalImg: HTMLImageElement,
  aiImg: HTMLImageElement,
  extensionInfo: ExtensionInfo,
  iterations: number = 250
): HTMLCanvasElement {
  const { direction, newWidth, newHeight, originalWidth, originalHeight, originalPosition, extensionRegion } = extensionInfo

  // Build destination D = canvas with the original at its position, AI everywhere else.
  // (Outside the mask Ω, V stays = D, so the original is preserved exactly.)
  const dstCanvas = document.createElement('canvas')
  dstCanvas.width = newWidth
  dstCanvas.height = newHeight
  const dstCtx = dstCanvas.getContext('2d')!
  dstCtx.drawImage(aiImg, 0, 0, newWidth, newHeight)
  dstCtx.drawImage(
    originalImg,
    0, 0, originalWidth, originalHeight,
    originalPosition.x, originalPosition.y, originalWidth, originalHeight
  )
  const dstU8 = dstCtx.getImageData(0, 0, newWidth, newHeight).data

  // Source S = pure AI output (provides gradients inside Ω).
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = newWidth
  srcCanvas.height = newHeight
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.drawImage(aiImg, 0, 0, newWidth, newHeight)
  const srcU8 = srcCtx.getImageData(0, 0, newWidth, newHeight).data

  // Stage 1: pre-correct the bulk color shift so Poisson only has to fix the
  // high-frequency residual (which it converges to quickly).
  preCorrectAiColor(dstU8, srcU8, extensionInfo, newWidth, newHeight)

  const N = newWidth * newHeight
  const dstR = new Float32Array(N)
  const dstG = new Float32Array(N)
  const dstB = new Float32Array(N)
  const srcR = new Float32Array(N)
  const srcG = new Float32Array(N)
  const srcB = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const j = i * 4
    dstR[i] = dstU8[j];     dstG[i] = dstU8[j + 1];     dstB[i] = dstU8[j + 2]
    srcR[i] = srcU8[j];     srcG[i] = srcU8[j + 1];     srcB[i] = srcU8[j + 2]
  }

  // Grow the mask into the original by GROW_PX, but only in the seam direction.
  // This is the "grow then blur" trick: by moving Poisson's Dirichlet boundary
  // a few pixels INSIDE the original, any sub-pixel mismatch right at the
  // original-AI interface gets absorbed by the solver instead of showing as a seam.
  // The original detail in this ring is preserved because the AI faithfully
  // reproduced the original there (its gradients are nearly identical).
  const GROW_PX = Math.max(6, Math.min(14, Math.floor(Math.min(originalWidth, originalHeight) * 0.012)))
  let mx = extensionRegion.x
  let my = extensionRegion.y
  let mw = extensionRegion.width
  let mh = extensionRegion.height
  if (direction === 'right')      { mx -= GROW_PX; mw += GROW_PX }
  else if (direction === 'left')  { mw += GROW_PX }
  else if (direction === 'down')  { my -= GROW_PX; mh += GROW_PX }
  else if (direction === 'up')    { mh += GROW_PX }
  mx = Math.max(0, mx); my = Math.max(0, my)
  mw = Math.min(newWidth - mx, mw); mh = Math.min(newHeight - my, mh)

  const mask = new Uint8Array(N)
  for (let y = my; y < my + mh; y++) {
    const row = y * newWidth
    for (let x = mx; x < mx + mw; x++) mask[row + x] = 1
  }

  // Iterate over the FULL mask bounding box, including canvas-edge rows/cols.
  // Out-of-bounds neighbors are replicate-padded (clamped to image bounds),
  // giving canvas edges a Neumann (zero-gradient) boundary condition. This is
  // critical for full-height/width extensions where the mask touches the
  // canvas edge: skipping those rows leaves them frozen at the AI's initial
  // color, which then acts as a Dirichlet boundary pulling the interior toward
  // AI's color and defeating the seam at the original boundary.
  const x0 = mx
  const x1 = mx + mw
  const y0 = my
  const y1 = my + mh

  // Precompute Laplacian of S with replicate padding.
  const lapR = new Float32Array(N)
  const lapG = new Float32Array(N)
  const lapB = new Float32Array(N)
  for (let y = y0; y < y1; y++) {
    const row = y * newWidth
    const rowUp = (y > 0 ? y - 1 : 0) * newWidth
    const rowDn = (y < newHeight - 1 ? y + 1 : newHeight - 1) * newWidth
    for (let x = x0; x < x1; x++) {
      const i = row + x
      const xL = x > 0 ? x - 1 : 0
      const xR = x < newWidth - 1 ? x + 1 : newWidth - 1
      lapR[i] = 4 * srcR[i] - srcR[rowUp + x] - srcR[rowDn + x] - srcR[row + xL] - srcR[row + xR]
      lapG[i] = 4 * srcG[i] - srcG[rowUp + x] - srcG[rowDn + x] - srcG[row + xL] - srcG[row + xR]
      lapB[i] = 4 * srcB[i] - srcB[rowUp + x] - srcB[rowDn + x] - srcB[row + xL] - srcB[row + xR]
    }
  }

  // Initial guess V = D. Inside the extension proper, D = AI (color-corrected
  // by preCorrectAiColor above); inside the grown ring, D = original.
  const vR = new Float32Array(N)
  const vG = new Float32Array(N)
  const vB = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    vR[i] = dstR[i]; vG[i] = dstG[i]; vB[i] = dstB[i]
  }

  // Gauss-Seidel red-black ordering. On "red" pass we visit pixels where
  // (x + y) is even; on "black" pass, where it's odd. Each pass reads updated
  // values from the previous pass, doubling effective convergence speed vs Jacobi.
  for (let iter = 0; iter < iterations; iter++) {
    for (let parity = 0; parity < 2; parity++) {
      for (let y = y0; y < y1; y++) {
        const row = y * newWidth
        const rowUp = (y > 0 ? y - 1 : 0) * newWidth
        const rowDn = (y < newHeight - 1 ? y + 1 : newHeight - 1) * newWidth
        const startX = x0 + ((x0 + y + parity) & 1)
        for (let x = startX; x < x1; x += 2) {
          const i = row + x
          if (!mask[i]) continue
          const xL = x > 0 ? x - 1 : 0
          const xR = x < newWidth - 1 ? x + 1 : newWidth - 1
          const iU = rowUp + x, iD = rowDn + x, iL = row + xL, iR = row + xR
          const upR = mask[iU] ? vR[iU] : dstR[iU]
          const dnR = mask[iD] ? vR[iD] : dstR[iD]
          const lfR = mask[iL] ? vR[iL] : dstR[iL]
          const rtR = mask[iR] ? vR[iR] : dstR[iR]
          const upG = mask[iU] ? vG[iU] : dstG[iU]
          const dnG = mask[iD] ? vG[iD] : dstG[iD]
          const lfG = mask[iL] ? vG[iL] : dstG[iL]
          const rtG = mask[iR] ? vG[iR] : dstG[iR]
          const upB = mask[iU] ? vB[iU] : dstB[iU]
          const dnB = mask[iD] ? vB[iD] : dstB[iD]
          const lfB = mask[iL] ? vB[iL] : dstB[iL]
          const rtB = mask[iR] ? vB[iR] : dstB[iR]
          vR[i] = (upR + dnR + lfR + rtR + lapR[i]) * 0.25
          vG[i] = (upG + dnG + lfG + rtG + lapG[i]) * 0.25
          vB[i] = (upB + dnB + lfB + rtB + lapB[i]) * 0.25
        }
      }
    }
  }

  const out = new ImageData(newWidth, newHeight)
  const od = out.data
  for (let i = 0; i < N; i++) {
    const j = i * 4
    if (mask[i]) {
      od[j]     = vR[i] < 0 ? 0 : vR[i] > 255 ? 255 : vR[i]
      od[j + 1] = vG[i] < 0 ? 0 : vG[i] > 255 ? 255 : vG[i]
      od[j + 2] = vB[i] < 0 ? 0 : vB[i] > 255 ? 255 : vB[i]
    } else {
      od[j]     = dstR[i]
      od[j + 1] = dstG[i]
      od[j + 2] = dstB[i]
    }
    od[j + 3] = 255
  }

  const result = document.createElement('canvas')
  result.width = newWidth
  result.height = newHeight
  result.getContext('2d')!.putImageData(out, 0, 0)
  return result
}

/**
 * Apply full-context AI result with Poisson blending.
 * Gradient-domain blending preserves AI textures while mathematically forcing
 * the seam to match the original — the same technique professional outpainting
 * tools (Adobe, ComfyUI, the Nano Banana ComfyUI node) use.
 */
export async function applyFullContextResult(
  aiImageDataUrl: string,
  extensionInfo: ExtensionInfo,
  originalImageDataUrl: string
): Promise<string> {
  const normalizedAi = await normalizeImageToSize(
    aiImageDataUrl,
    extensionInfo.newWidth,
    extensionInfo.newHeight,
    getCanvasAlign(extensionInfo.direction)
  )

  const [aiImg, originalImg] = await Promise.all([
    loadImageElement(normalizedAi),
    loadImageElement(originalImageDataUrl),
  ])

  // Poisson blending: source = AI, destination = canvas with original placed,
  // mask = extension region. Inside the mask, V is solved so its Laplacian
  // matches the AI's gradients while V at the seam = original's pixels exactly.
  // This eliminates color seams and brightness mismatches without smearing detail.
  const blended = poissonBlendOutpaint(originalImg, aiImg, extensionInfo)
  return blended.toDataURL('image/png')
}

/** Validate AI output before compositing — checks the raw AI image extension region. */
export async function isAiExtensionUnfilled(
  aiImageDataUrl: string,
  extensionInfo: ExtensionInfo
): Promise<boolean> {
  const normalized = await normalizeImageToSize(
    aiImageDataUrl,
    extensionInfo.newWidth,
    extensionInfo.newHeight,
    getCanvasAlign(extensionInfo.direction)
  )
  return isExtensionRegionUnfilled(normalized, extensionInfo)
}

// Interface for full context extension info
export interface ExtensionInfo {
  direction: 'up' | 'down' | 'left' | 'right'
  originalWidth: number
  originalHeight: number
  newWidth: number
  newHeight: number
  extensionRegion: { x: number; y: number; width: number; height: number }
  originalPosition: { x: number; y: number }
  scale?: number
}

// Helper function to downscale image while preserving aspect ratio
async function smartDownscale(
  imageDataUrl: string, 
  direction: 'up' | 'down' | 'left' | 'right',
  maxDimension: number = 2048
): Promise<{ dataUrl: string; scale: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      const width = img.width
      const height = img.height
      
      // Find the larger dimension
      const maxSize = Math.max(width, height)
      
      // If within limits, return as-is
      if (maxSize <= maxDimension) {
        resolve({ dataUrl: imageDataUrl, scale: 1 })
        return
      }
      
      // Scale PROPORTIONALLY to maintain aspect ratio
      // This is critical so AI sees the correct shape of what it needs to generate
      const scale = maxDimension / maxSize
      const newWidth = Math.round(width * scale)
      const newHeight = Math.round(height * scale)
      
      console.log(`📏 Proportional downscaling for ${direction.toUpperCase()}: ${width}x${height} → ${newWidth}x${newHeight} (scale: ${scale.toFixed(2)})`)
      
      const canvas = document.createElement('canvas')
      canvas.width = newWidth
      canvas.height = newHeight
      const ctx = canvas.getContext('2d')
      
      if (ctx) {
        // Use JPEG with good quality to reduce payload size while maintaining quality
        ctx.drawImage(img, 0, 0, newWidth, newHeight)
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.95), scale })
      } else {
        resolve({ dataUrl: imageDataUrl, scale: 1 })
      }
    }
    
    img.src = imageDataUrl
  })
}

// Old chunked extension approach - only takes a portion of the image to extend
export async function createChunkedExtension(
  originalImageDataUrl: string,
  direction: 'up' | 'down' | 'left' | 'right',
  extensionPercent: number,
  overlapPercent: number = 40, // Context area: how much existing image to send to AI (lower = less regeneration of good parts)
  referenceOriginalDimensions?: { width: number; height: number }, // Reference dimensions for consistent percentage calculations
  maxDimension: number = 1536 // Maximum dimension to send to AI (balanced for quality and API limits)
): Promise<{ chunkToExtend: string; chunkInfo: ChunkInfo }> {
  return new Promise(async (resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = async () => {
      const currentWidth = img.width
      const currentHeight = img.height
      
      // Use reference dimensions if provided, otherwise use current image dimensions
      const refWidth = referenceOriginalDimensions?.width || currentWidth
      const refHeight = referenceOriginalDimensions?.height || currentHeight
      
      // Calculate chunk dimensions based on direction
      let chunkInfo: ChunkInfo
      let sourceX = 0, sourceY = 0, sourceWidth = 0, sourceHeight = 0
      let newWidth = 0, newHeight = 0
      let offsetX = 0, offsetY = 0
      
      const extensionAmount = extensionPercent / 100
      const overlapAmount = overlapPercent / 100
      
      switch (direction) {
        case 'up':
          // Take top portion of CURRENT image (context area)
          sourceWidth = currentWidth
          sourceHeight = Math.round(currentHeight * overlapAmount)
          sourceX = 0
          sourceY = 0
          
          // Calculate extension based on REFERENCE (original) image dimensions for consistency
          const extensionHeight = Math.round(refHeight * extensionAmount)
          
          // Add white space above the context area
          newWidth = sourceWidth
          newHeight = sourceHeight + extensionHeight
          offsetX = 0
          offsetY = extensionHeight
          
          chunkInfo = {
            direction,
            originalWidth: currentWidth,
            originalHeight: currentHeight,
            chunkWidth: sourceWidth,
            chunkHeight: sourceHeight,
            extensionSize: extensionHeight,
            sourceX,
            sourceY
          }
          break
          
        case 'down':
          // Take bottom portion of CURRENT image (context area)
          sourceWidth = currentWidth
          sourceHeight = Math.round(currentHeight * overlapAmount)
          sourceX = 0
          sourceY = currentHeight - sourceHeight
          
          // Calculate extension based on REFERENCE (original) image dimensions
          const extensionHeightDown = Math.round(refHeight * extensionAmount)
          
          // Add white space below the context area
          newWidth = sourceWidth
          newHeight = sourceHeight + extensionHeightDown
          offsetX = 0
          offsetY = 0
          
          chunkInfo = {
            direction,
            originalWidth: currentWidth,
            originalHeight: currentHeight,
            chunkWidth: sourceWidth,
            chunkHeight: sourceHeight,
            extensionSize: extensionHeightDown,
            sourceX,
            sourceY
          }
          break
          
        case 'left':
          // Take left portion of CURRENT image (context area)
          sourceWidth = Math.round(currentWidth * overlapAmount)
          sourceHeight = currentHeight
          sourceX = 0
          sourceY = 0
          
          // Calculate extension based on REFERENCE (original) image dimensions
          const extensionWidthLeft = Math.round(refWidth * extensionAmount)
          
          // Add white space to left of context area
          newWidth = sourceWidth + extensionWidthLeft
          newHeight = sourceHeight
          offsetX = extensionWidthLeft
          offsetY = 0
          
          chunkInfo = {
            direction,
            originalWidth: currentWidth,
            originalHeight: currentHeight,
            chunkWidth: sourceWidth,
            chunkHeight: sourceHeight,
            extensionSize: extensionWidthLeft,
            sourceX,
            sourceY
          }
          break
          
        case 'right':
          // Take right portion of CURRENT image (context area)
          sourceWidth = Math.round(currentWidth * overlapAmount)
          sourceHeight = currentHeight
          sourceX = currentWidth - sourceWidth
          sourceY = 0
          
          // Calculate extension based on REFERENCE (original) image dimensions
          const extensionWidthRight = Math.round(refWidth * extensionAmount)
          
          // Add white space to right of context area
          newWidth = sourceWidth + extensionWidthRight
          newHeight = sourceHeight
          offsetX = 0
          offsetY = 0
          
          chunkInfo = {
            direction,
            originalWidth: currentWidth,
            originalHeight: currentHeight,
            chunkWidth: sourceWidth,
            chunkHeight: sourceHeight,
            extensionSize: extensionWidthRight,
            sourceX,
            sourceY
          }
          break
      }
      
      // Create canvas for the chunk with extension
      const canvas = document.createElement('canvas')
      canvas.width = newWidth
      canvas.height = newHeight
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      
      // Fill with white background
      ctx.fillStyle = EXTENSION_BLANK_COLOR
      ctx.fillRect(0, 0, newWidth, newHeight)
      
      // Draw the chunk from original image
      ctx.drawImage(
        img,
        sourceX, sourceY, sourceWidth, sourceHeight, // Source
        offsetX, offsetY, sourceWidth, sourceHeight  // Destination
      )
      
      // Smart downscale before sending to AI to prevent aggressive compression
      // Only scale the dimension being extended (keep width constant for up/down)
      const chunkDataUrl = canvas.toDataURL('image/png')
      smartDownscale(chunkDataUrl, direction, maxDimension).then(({ dataUrl, scale }) => {
        resolve({
          chunkToExtend: dataUrl,
          chunkInfo: { ...chunkInfo, scale }
        })
      }).catch(() => {
        // Fallback to original if downscale fails
        resolve({
          chunkToExtend: chunkDataUrl,
          chunkInfo: { ...chunkInfo, scale: 1 }
        })
      })
    }
    
    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }
    
    img.src = originalImageDataUrl
  })
}

// Stitch the extended chunk back to the original image
export async function stitchExtendedChunk(
  originalImageDataUrl: string,
  extendedChunkDataUrl: string,
  chunkInfo: ChunkInfo,
  debugMode: boolean = false // Add debug overlay to visualize seam
): Promise<string> {
  return new Promise((resolve, reject) => {
    const originalImg = new Image()
    const extendedImg = new Image()
    
    let originalLoaded = false
    let extendedLoaded = false
    
    const checkBothLoaded = () => {
      if (!originalLoaded || !extendedLoaded) return
      
      const { direction, originalWidth, originalHeight, chunkWidth, chunkHeight, extensionSize, scale = 1 } = chunkInfo
      
      // DEBUG: Log all dimensions
      console.log('=== STITCHING DEBUG INFO ===')
      console.log('Direction:', direction)
      console.log('Original Image:', originalImg.width, 'x', originalImg.height)
      console.log('Extended Chunk (AI result):', extendedImg.width, 'x', extendedImg.height)
      console.log('ChunkInfo - originalWidth:', originalWidth, 'originalHeight:', originalHeight)
      console.log('ChunkInfo - chunkWidth:', chunkWidth, 'chunkHeight:', chunkHeight)
      console.log('ChunkInfo - extensionSize:', extensionSize)
      
      // Check for dimension mismatches
      if (originalImg.width !== originalWidth || originalImg.height !== originalHeight) {
        console.warn('⚠️ DIMENSION MISMATCH DETECTED!')
        console.warn('Expected original:', originalWidth, 'x', originalHeight)
        console.warn('Actual original:', originalImg.width, 'x', originalImg.height)
      }
      
      // Calculate expected extended chunk dimensions (full resolution)
      const expectedChunkWidth = direction === 'left' || direction === 'right' 
        ? chunkWidth + extensionSize 
        : originalWidth
      const expectedChunkHeight = direction === 'up' || direction === 'down'
        ? chunkHeight + extensionSize
        : originalHeight

      // Dimensions at the scale sent to the AI (before upscaling back)
      const sentChunkWidth = Math.round(expectedChunkWidth * scale)
      const sentChunkHeight = Math.round(expectedChunkHeight * scale)
      
      console.log('Expected extended chunk:', expectedChunkWidth, 'x', expectedChunkHeight)
      console.log('Sent to AI (scaled):', sentChunkWidth, 'x', sentChunkHeight, `(scale: ${scale})`)
      
      // Handle AI dimension changes by resizing to expected dimensions
      let processedExtendedImg = extendedImg
      
      const resizeImage = (img: HTMLImageElement, width: number, height: number, onDone: (resized: HTMLImageElement) => void) => {
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = img.width
        tempCanvas.height = img.height
        tempCanvas.getContext('2d')?.drawImage(img, 0, 0)

        normalizeImageToSize(tempCanvas.toDataURL('image/png'), width, height, getChunkAlign(direction))
          .then((dataUrl) => {
            const resizedImg = new Image()
            resizedImg.onload = () => onDone(resizedImg)
            resizedImg.onerror = () => onDone(img)
            resizedImg.src = dataUrl
          })
          .catch(() => onDone(img))
      }
      
      if (extendedImg.width !== sentChunkWidth || extendedImg.height !== sentChunkHeight) {
        console.warn('⚠️ AI CHANGED DIMENSIONS (at sent scale)!')
        console.warn('Expected (sent scale):', sentChunkWidth, 'x', sentChunkHeight)
        console.warn('AI returned:', extendedImg.width, 'x', extendedImg.height)
        console.warn('🔧 Resizing to sent-scale dimensions...')
        
        resizeImage(extendedImg, sentChunkWidth, sentChunkHeight, (resizedAtSentScale) => {
          if (scale !== 1) {
            console.warn('🔧 Upscaling to full resolution...')
            resizeImage(resizedAtSentScale, expectedChunkWidth, expectedChunkHeight, (fullRes) => {
              console.log('✅ Resized to full res:', fullRes.width, 'x', fullRes.height)
              processedExtendedImg = fullRes
              continueStitching()
            })
          } else {
            console.log('✅ Resized to:', resizedAtSentScale.width, 'x', resizedAtSentScale.height)
            processedExtendedImg = resizedAtSentScale
            continueStitching()
          }
        })
        return
      }
      
      if (scale !== 1) {
        console.warn('🔧 Upscaling AI result from sent scale to full resolution...')
        resizeImage(extendedImg, expectedChunkWidth, expectedChunkHeight, (fullRes) => {
          console.log('✅ Upscaled to:', fullRes.width, 'x', fullRes.height)
          processedExtendedImg = fullRes
          continueStitching()
        })
        return
      }
      
      continueStitching()
      
      function continueStitching() {
      
        // Calculate final dimensions based on processed (potentially resized) extended image
        // Extended chunk = new content + AI-blended overlap
        // Remaining original = original minus the overlap portion
        let finalWidth = originalWidth
        let finalHeight = originalHeight
        
        switch (direction) {
          case 'up':
          case 'down':
            // Final height = extended chunk height + remaining original height
            finalHeight = processedExtendedImg.height + (originalHeight - chunkHeight)
            break
          case 'left':
          case 'right':
            // Final width = extended chunk width + remaining original width
            finalWidth = processedExtendedImg.width + (originalWidth - chunkWidth)
            break
        }
        
        console.log('Final canvas size:', finalWidth, 'x', finalHeight)
        console.log('===========================\n')
        
        // Create final canvas
        const canvas = document.createElement('canvas')
        canvas.width = finalWidth
        canvas.height = finalHeight
        const ctx = canvas.getContext('2d')
        
        if (!ctx) {
          reject(new Error('Failed to get canvas context'))
          return
        }
        
        // Position images based on direction with gradient feathering for seamless blending
        // Use the overlap dimension along the extension axis (width for L/R, height for U/D)
        const overlapSize = direction === 'left' || direction === 'right'
          ? chunkInfo.chunkWidth
          : chunkInfo.chunkHeight
        const baseFeatherSize = Math.floor(overlapSize * 0.2) // 20% of overlap region
        const featherSize = Math.min(
          Math.max(30, baseFeatherSize),
          200,
          Math.floor(overlapSize * 0.25) // Never feather more than 25% of overlap
        )
        
        console.log('--- POSITIONING DEBUG ---')
        console.log('Feather size:', featherSize, 'px')
        
        switch (direction) {
          case 'up':
            // 1. Draw entire extended chunk at top
            console.log('Step 1: Drawing extended chunk at (0, 0) size:', processedExtendedImg.width, 'x', processedExtendedImg.height)
            ctx.drawImage(processedExtendedImg, 0, 0)
          
            // 2. Draw remaining original below
            const extendedChunkHeight = processedExtendedImg.height
            const overlapStartY = extendedChunkHeight
          
            const sourceStartY = chunkInfo.chunkHeight
            const sourceHeightUp = originalHeight - chunkInfo.chunkHeight
            const destStartY = extendedChunkHeight
            
            console.log('Step 2: Drawing remaining original')
            console.log('  Source: (0,', sourceStartY, ') size:', originalWidth, 'x', sourceHeightUp)
            console.log('  Dest: (0,', destStartY, ') size:', finalWidth, 'x', sourceHeightUp)
            console.log('  Seam position (Y):', overlapStartY)
            
            ctx.drawImage(
              originalImg,
              0, sourceStartY, originalWidth, sourceHeightUp,
              0, destStartY, finalWidth, sourceHeightUp
            )
          
          // 3. Apply gradient feathering at the seam for seamless blending
          const gradientY = overlapStartY - featherSize
          console.log('Step 3: Applying gradient feather')
          console.log('  Gradient zone: Y', gradientY, 'to', overlapStartY + featherSize)
          console.log('  Feather zone height:', featherSize * 2, 'px')
          
          const gradient = ctx.createLinearGradient(0, gradientY, 0, overlapStartY + featherSize)
          gradient.addColorStop(0, 'rgba(0,0,0,1)')     // Extended chunk fully visible
          gradient.addColorStop(0.5, 'rgba(0,0,0,0.5)') // 50% blend at seam
          gradient.addColorStop(1, 'rgba(0,0,0,0)')     // Original fully visible
          
          // Create temporary canvas for gradient mask
          const tempCanvas = document.createElement('canvas')
          tempCanvas.width = finalWidth
          tempCanvas.height = featherSize * 2
          const tempCtx = tempCanvas.getContext('2d')
          
          if (tempCtx) {
            // Draw the transition area from both images
            tempCtx.drawImage(canvas, 0, gradientY, finalWidth, featherSize * 2, 0, 0, finalWidth, featherSize * 2)
            
            // Apply gradient mask
            tempCtx.globalCompositeOperation = 'destination-in'
            tempCtx.fillStyle = gradient
            tempCtx.fillRect(0, 0, finalWidth, featherSize * 2)
            
            // Draw back with blending
            ctx.globalCompositeOperation = 'source-over'
            ctx.drawImage(tempCanvas, 0, gradientY)
          }
          console.log('-------------------------\n')
          
          // DEBUG: Draw visual markers at seam
          if (debugMode) {
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)'
            ctx.lineWidth = 2
            ctx.setLineDash([10, 5])
            ctx.beginPath()
            ctx.moveTo(0, overlapStartY)
            ctx.lineTo(finalWidth, overlapStartY)
            ctx.stroke()
            ctx.setLineDash([])
            
            // Add text label
            ctx.fillStyle = 'rgba(255, 0, 0, 0.9)'
            ctx.font = 'bold 16px Arial'
            ctx.fillText(`Seam at Y: ${overlapStartY}`, 10, overlapStartY - 10)
          }
          break
          
          case 'down':
            // 1. Draw non-overlapping portion of original at top
            const nonOverlapHeight = originalHeight - chunkInfo.chunkHeight
            ctx.drawImage(
              originalImg,
              0, 0, originalWidth, nonOverlapHeight,
              0, 0, finalWidth, nonOverlapHeight
            )
            
            // 2. Draw entire extended chunk below
            ctx.drawImage(processedExtendedImg, 0, nonOverlapHeight)
          
          // 3. Apply gradient feathering at the seam
          const overlapStartYDown = nonOverlapHeight
          const gradientYDown = overlapStartYDown - featherSize
          const gradientDown = ctx.createLinearGradient(0, gradientYDown, 0, overlapStartYDown + featherSize)
          gradientDown.addColorStop(0, 'rgba(0,0,0,0)')
          gradientDown.addColorStop(0.5, 'rgba(0,0,0,0.5)')
          gradientDown.addColorStop(1, 'rgba(0,0,0,1)')
          
          const tempCanvasDown = document.createElement('canvas')
          tempCanvasDown.width = finalWidth
          tempCanvasDown.height = featherSize * 2
          const tempCtxDown = tempCanvasDown.getContext('2d')
          
          if (tempCtxDown) {
            tempCtxDown.drawImage(canvas, 0, gradientYDown, finalWidth, featherSize * 2, 0, 0, finalWidth, featherSize * 2)
            tempCtxDown.globalCompositeOperation = 'destination-in'
            tempCtxDown.fillStyle = gradientDown
            tempCtxDown.fillRect(0, 0, finalWidth, featherSize * 2)
            ctx.globalCompositeOperation = 'source-over'
            ctx.drawImage(tempCanvasDown, 0, gradientYDown)
          }
          break
          
          case 'left':
            // Layout: [AI chunk (extension + overlap) | original non-overlap]
            ctx.drawImage(
              originalImg,
              0, 0, originalWidth, originalHeight,
              extensionSize, 0, originalWidth, finalHeight
            )
            ctx.drawImage(
              processedExtendedImg,
              0, 0, processedExtendedImg.width, processedExtendedImg.height,
              0, 0, processedExtendedImg.width, finalHeight
            )
          
          const overlapStartXLeft = extensionSize
          const gradientXLeft = overlapStartXLeft - featherSize
          const gradientLeft = ctx.createLinearGradient(gradientXLeft, 0, overlapStartXLeft + featherSize, 0)
          gradientLeft.addColorStop(0, 'rgba(0,0,0,1)')
          gradientLeft.addColorStop(0.5, 'rgba(0,0,0,0.5)')
          gradientLeft.addColorStop(1, 'rgba(0,0,0,0)')
          
          const tempCanvasLeft = document.createElement('canvas')
          tempCanvasLeft.width = featherSize * 2
          tempCanvasLeft.height = finalHeight
          const tempCtxLeft = tempCanvasLeft.getContext('2d')
          
          if (tempCtxLeft) {
            tempCtxLeft.drawImage(canvas, gradientXLeft, 0, featherSize * 2, finalHeight, 0, 0, featherSize * 2, finalHeight)
            tempCtxLeft.globalCompositeOperation = 'destination-in'
            tempCtxLeft.fillStyle = gradientLeft
            tempCtxLeft.fillRect(0, 0, featherSize * 2, finalHeight)
            ctx.globalCompositeOperation = 'source-over'
            ctx.drawImage(tempCanvasLeft, gradientXLeft, 0)
          }
          break
          
          case 'right': {
            const overlapStartX = originalWidth - chunkWidth
            ctx.drawImage(
              originalImg,
              0, 0, overlapStartX, originalHeight,
              0, 0, overlapStartX, finalHeight
            )
            ctx.drawImage(
              processedExtendedImg,
              0, 0, processedExtendedImg.width, processedExtendedImg.height,
              overlapStartX, 0, processedExtendedImg.width, finalHeight
            )
          
          const overlapStartXRight = overlapStartX
          const gradientXRight = overlapStartXRight - featherSize
          const gradientRight = ctx.createLinearGradient(gradientXRight, 0, overlapStartXRight + featherSize, 0)
          gradientRight.addColorStop(0, 'rgba(0,0,0,0)')
          gradientRight.addColorStop(0.5, 'rgba(0,0,0,0.5)')
          gradientRight.addColorStop(1, 'rgba(0,0,0,1)')
          
          const tempCanvasRight = document.createElement('canvas')
          tempCanvasRight.width = featherSize * 2
          tempCanvasRight.height = finalHeight
          const tempCtxRight = tempCanvasRight.getContext('2d')
          
          if (tempCtxRight) {
            tempCtxRight.drawImage(canvas, gradientXRight, 0, featherSize * 2, finalHeight, 0, 0, featherSize * 2, finalHeight)
            tempCtxRight.globalCompositeOperation = 'destination-in'
            tempCtxRight.fillStyle = gradientRight
            tempCtxRight.fillRect(0, 0, featherSize * 2, finalHeight)
            ctx.globalCompositeOperation = 'source-over'
            ctx.drawImage(tempCanvasRight, gradientXRight, 0)
          }
            break
          }
        }
        
        resolve(canvas.toDataURL('image/png'))
      } // End of continueStitching()
    }
    
    originalImg.onload = () => {
      originalLoaded = true
      checkBothLoaded()
    }
    
    extendedImg.onload = () => {
      extendedLoaded = true
      checkBothLoaded()
    }
    
    originalImg.onerror = () => reject(new Error('Failed to load original image'))
    extendedImg.onerror = () => reject(new Error('Failed to load extended chunk'))
    
    originalImg.src = originalImageDataUrl
    extendedImg.src = extendedChunkDataUrl
  })
}

export interface ChunkInfo {
  direction: 'up' | 'down' | 'left' | 'right'
  originalWidth: number
  originalHeight: number
  chunkWidth: number
  chunkHeight: number
  extensionSize: number
  sourceX: number
  sourceY: number
  scale?: number // Downscale factor applied before sending to AI (1 = full resolution)
}

export function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.width, height: img.height })
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Parallax mode helpers — split a long horizontal background into game-sized
// tiles for engine import (Unity, Godot, Phaser, etc.)
// ─────────────────────────────────────────────────────────────────────────────

export interface ParallaxTile {
  dataUrl: string
  /** 1-indexed position in the strip, useful for filenames. */
  index: number
  width: number
  height: number
  /** X offset in the source image where this tile starts. */
  sourceX: number
}

/**
 * Slice a wide image into vertical tiles of `tileWidth`, full image height.
 * The last tile is the natural remaining width if the image isn't an exact
 * multiple — game engines handle non-uniform tail tiles fine and padding can
 * introduce false edges.
 */
export function splitIntoTiles(
  imageDataUrl: string,
  tileWidth: number
): Promise<ParallaxTile[]> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const tiles: ParallaxTile[] = []
      const tileHeight = img.height
      const numTiles = Math.max(1, Math.ceil(img.width / tileWidth))

      for (let i = 0; i < numTiles; i++) {
        const sourceX = i * tileWidth
        const w = Math.min(tileWidth, img.width - sourceX)
        if (w <= 0) break
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = tileHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Failed to get canvas context'))
          return
        }
        ctx.drawImage(img, sourceX, 0, w, tileHeight, 0, 0, w, tileHeight)
        tiles.push({
          dataUrl: canvas.toDataURL('image/png'),
          index: i + 1,
          width: w,
          height: tileHeight,
          sourceX,
        })
      }
      resolve(tiles)
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = imageDataUrl
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Chroma keying — turns a flat key-color background (default magenta) into
// real transparency. Used in parallax mode so the foreground / mid / far
// layers can stack over the sky layer with proper alpha. Includes a soft-
// edge falloff and despill so element borders don't show a magenta fringe.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChromaKeyOptions {
  /** Key color RGB. Default is pure magenta (255,0,255). */
  keyR?: number
  keyG?: number
  keyB?: number
  /**
   * Magenta-cast value at or above which a pixel becomes fully transparent.
   * Cast = max(0, min(r, b) - g). Range 0..255. Default 80 — comfortably
   * above the cast that natural warm/cool tones produce while still catching
   * blended-edge pixels.
   */
  castThreshold?: number
  /**
   * Width of the soft alpha falloff just below `castThreshold`. Pixels with
   * cast in `[castThreshold - castSoftness, castThreshold]` get partial
   * alpha so anti-aliased element borders feather cleanly. Default 30.
   */
  castSoftness?: number
  /**
   * How aggressively to neutralize magenta cast on every pixel that has
   * any. 0 = off (leaves a pink halo); 1 = fully subtract the cast from
   * R and B. Default 1.0 — natural images contain no real magenta, so any
   * cast is a blend artefact and should be removed.
   */
  despill?: number
  /**
   * Fraction of the despilled cast to add back into the green channel so
   * a desaturated edge pixel doesn't go dead grey. Default 0.5.
   */
  despillGreenBoost?: number
}

/**
 * Returns a new PNG data URL with the key color replaced by transparency.
 *
 * Default tuning is for pure magenta (#FF00FF) backgrounds. Instead of a
 * naive Euclidean RGB distance to the key — which treats saturated reds and
 * blues as "kinda magenta" — we use the standard chroma-key MAGENTA-CAST
 * metric: `cast = max(0, min(r, b) - g)`. This is 0 for any natural color
 * that lacks a magenta tint (greens, neutrals, deep reds, deep blues) and
 * approaches 255 for pure magenta. It cleanly separates "pixel is partially
 * blended with the magenta background" from "pixel happens to contain warm
 * red/blue tones that aren't magenta at all".
 *
 * The result:
 *   • Cast ≥ castThreshold      → fully transparent
 *   • castSoftness wide soft zone below that → smooth alpha falloff
 *   • Cast > 0                  → ALWAYS despilled (subtracts the cast from
 *                                 R and B, optionally boosts G to keep
 *                                 luminance), regardless of resulting alpha.
 *     The previous version only despilled semi-transparent pixels, which
 *     is exactly why fully-opaque-but-still-pink edge pixels showed up as
 *     a magenta halo around mountains / leaves / rocks. Despilling all
 *     pixels is safe because pure magenta never appears in natural art —
 *     any cast in the image is a blend artefact.
 */
export function chromaKeyToAlpha(
  imageDataUrl: string,
  opts: ChromaKeyOptions = {}
): Promise<string> {
  const {
    keyR = 255,
    keyG = 0,
    keyB = 255,
    castThreshold = 80,
    castSoftness = 30,
    despill = 1,
    despillGreenBoost = 0.5,
  } = opts

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, img.width, img.height)
      const data = imageData.data

      // Allow non-magenta keys to fall back to the original Euclidean
      // distance algorithm so callers who pass a custom (non-magenta)
      // key color still get a working chroma key.
      const isMagentaKey = keyR === 255 && keyG === 0 && keyB === 255

      for (let i = 0; i < data.length; i += 4) {
        let r = data[i]
        let g = data[i + 1]
        let b = data[i + 2]

        if (isMagentaKey) {
          const cast = Math.max(0, Math.min(r, b) - g)

          let alpha: number
          if (cast >= castThreshold) {
            alpha = 0
          } else if (cast <= 0) {
            alpha = 255
          } else {
            // Smooth ramp inside [max(0, castThreshold-castSoftness), castThreshold]:
            // pixels with mild cast keep most of their alpha but get partial
            // transparency so anti-aliased element borders feather cleanly
            // into the layer below.
            const softFloor = Math.max(0, castThreshold - castSoftness)
            if (cast <= softFloor) {
              alpha = 255
            } else {
              const t = (cast - softFloor) / (castThreshold - softFloor)
              alpha = Math.round(255 * (1 - t))
            }
          }
          data[i + 3] = alpha

          // Despill every pixel with any magenta cast — including the
          // fully-opaque ones the previous algorithm skipped, which were
          // the actual source of pink halos around real elements.
          if (cast > 0 && despill > 0) {
            const reduction = cast * despill
            r = Math.max(0, Math.round(r - reduction))
            b = Math.max(0, Math.round(b - reduction))
            if (despillGreenBoost > 0) {
              g = Math.min(255, Math.round(g + reduction * despillGreenBoost))
            }
            data[i] = r
            data[i + 1] = g
            data[i + 2] = b
          }
        } else {
          // Non-magenta key: legacy Euclidean distance fallback.
          const dr = r - keyR
          const dg = g - keyG
          const db = b - keyB
          const dist = Math.sqrt(dr * dr + dg * dg + db * db)
          const fallbackThreshold = 90
          const fallbackSoftness = 60
          let alpha: number
          if (dist <= fallbackThreshold) {
            alpha = 0
          } else if (dist >= fallbackThreshold + fallbackSoftness) {
            alpha = 255
          } else {
            alpha = Math.round(((dist - fallbackThreshold) / fallbackSoftness) * 255)
          }
          data[i + 3] = alpha
        }
      }
      ctx.putImageData(imageData, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = imageDataUrl
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Horizontal seam harmonization — kills the visible "panel banding" you get
// after chaining many AI outpaints. Each AI call introduces a tiny color /
// brightness shift; with N extends those shifts accumulate into clearly
// distinct vertical bands across a long parallax background, even though
// every individual seam was Poisson-blended at the moment of stitching.
//
// The fix: compute the per-column mean color across the image height, run
// a wide Gaussian over that 1-D profile to get a "what each column SHOULD
// look like if there were no panel drift" reference, and shift every pixel
// in column `x` by `(smoothed_mean(x) - actual_mean(x)) * strength`.
//
// This removes low-frequency horizontal DC drift while preserving every
// pixel's relative deviation from its column's mean, so clouds, shapes,
// and texture are untouched — only the underlying "tint trend" changes.
// ─────────────────────────────────────────────────────────────────────────────

export interface HarmonizeOptions {
  /**
   * Standard deviation of the smoothing Gaussian, in pixels. Larger values
   * smooth across more panels and give a more uniform result; smaller
   * values preserve more legitimate horizontal variation. Defaults to
   * `imageWidth / 8`, clamped to [120, 900].
   */
  sigmaPx?: number
  /**
   * How aggressively to apply the correction. 1.0 = match smoothed profile
   * exactly; 0.5 = halfway between original and target. Default 0.85 —
   * strong enough to kill panels, soft enough to keep natural variation.
   */
  strength?: number
  /**
   * Skip pixels that are close to this color in mean computation AND
   * correction. Used for parallax keyed layers (raw magenta-bg images) so
   * the magenta key stays uniform and only the visible elements get
   * harmonized.
   */
  ignoreKeyColor?: { r: number; g: number; b: number; threshold?: number }
  /**
   * Skip pixels with alpha below this value. Used for already-keyed images
   * (with real alpha) so transparent regions don't pollute column means
   * and don't get correction applied.
   */
  minAlpha?: number
}

function gaussianKernel1D(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const k = new Float32Array(radius * 2 + 1)
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    k[i + radius] = v
    sum += v
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum
  return k
}

function smooth1D(arr: Float32Array, sigma: number): Float32Array {
  const k = gaussianKernel1D(sigma)
  const radius = (k.length - 1) / 2
  const N = arr.length
  const out = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    let acc = 0
    let w = 0
    for (let j = -radius; j <= radius; j++) {
      const x = i + j
      if (x < 0 || x >= N) continue
      const kw = k[j + radius]
      acc += arr[x] * kw
      w += kw
    }
    out[i] = w > 0 ? acc / w : arr[i]
  }
  return out
}

/**
 * Equalize horizontal color drift across an image. See block comment above
 * for the algorithm. Returns a new PNG data URL; the input is unchanged.
 */
export function harmonizeHorizontalSeams(
  imageDataUrl: string,
  options: HarmonizeOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const W = img.width
      const H = img.height
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, W, H)
      const data = imageData.data

      const strength = options.strength ?? 0.85
      const sigmaPx =
        options.sigmaPx ?? Math.max(120, Math.min(900, Math.round(W / 8)))
      const minAlpha = options.minAlpha ?? 0
      const key = options.ignoreKeyColor
      const keyThreshold = key?.threshold ?? 80
      const keyThresholdSq = keyThreshold * keyThreshold

      // ── Pass 1: per-column means over participating pixels ─────────────
      const sumR = new Float32Array(W)
      const sumG = new Float32Array(W)
      const sumB = new Float32Array(W)
      const counts = new Float32Array(W)

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4
          const a = data[idx + 3]
          if (a < minAlpha) continue
          const r = data[idx]
          const g = data[idx + 1]
          const b = data[idx + 2]
          if (key) {
            const dr = r - key.r
            const dg = g - key.g
            const db = b - key.b
            if (dr * dr + dg * dg + db * db < keyThresholdSq) continue
          }
          sumR[x] += r
          sumG[x] += g
          sumB[x] += b
          counts[x] += 1
        }
      }

      const meanR = new Float32Array(W)
      const meanG = new Float32Array(W)
      const meanB = new Float32Array(W)
      // For columns with zero participating pixels (e.g. fully magenta
      // column on a keyed layer), fall back to the global mean of all
      // participating pixels so smoothing has a sensible value to use.
      let globalR = 0
      let globalG = 0
      let globalB = 0
      let globalCount = 0
      for (let x = 0; x < W; x++) {
        if (counts[x] > 0) {
          meanR[x] = sumR[x] / counts[x]
          meanG[x] = sumG[x] / counts[x]
          meanB[x] = sumB[x] / counts[x]
          globalR += sumR[x]
          globalG += sumG[x]
          globalB += sumB[x]
          globalCount += counts[x]
        }
      }
      if (globalCount === 0) {
        // No participating pixels at all — nothing to harmonize.
        resolve(imageDataUrl)
        return
      }
      const gR = globalR / globalCount
      const gG = globalG / globalCount
      const gB = globalB / globalCount
      for (let x = 0; x < W; x++) {
        if (counts[x] === 0) {
          meanR[x] = gR
          meanG[x] = gG
          meanB[x] = gB
        }
      }

      // ── Pass 2: smooth the per-column means across X ────────────────────
      const smoothR = smooth1D(meanR, sigmaPx)
      const smoothG = smooth1D(meanG, sigmaPx)
      const smoothB = smooth1D(meanB, sigmaPx)

      // ── Pass 3: shift every participating pixel toward the smoothed ────
      //          column mean. Skip key-color and low-alpha pixels so the
      //          magenta background and transparent regions stay clean.
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4
          const a = data[idx + 3]
          if (a < minAlpha) continue
          const r = data[idx]
          const g = data[idx + 1]
          const b = data[idx + 2]
          if (key) {
            const dr = r - key.r
            const dg = g - key.g
            const db = b - key.b
            if (dr * dr + dg * dg + db * db < keyThresholdSq) continue
          }
          const shiftR = (smoothR[x] - meanR[x]) * strength
          const shiftG = (smoothG[x] - meanG[x]) * strength
          const shiftB = (smoothB[x] - meanB[x]) * strength
          const nr = r + shiftR
          const ng = g + shiftG
          const nb = b + shiftB
          data[idx] = nr < 0 ? 0 : nr > 255 ? 255 : nr
          data[idx + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng
          data[idx + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb
        }
      }

      ctx.putImageData(imageData, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = imageDataUrl
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Make horizontally tileable — the AI generates a beautiful continuous
// background, but the LEFT edge and the RIGHT edge of the final image were
// never asked to match each other. So when a game engine tiles this texture
// horizontally with `repeat-x`, the loop point (right edge of one tile
// meeting left edge of the next) shows a hard discontinuity that ruins the
// illusion of an infinite parallax.
//
// The professional fix has THREE stages — a single seam patch isn't enough
// for non-pixel-art content. From Julieanne Kost's classic Photoshop tile
// recipe and modern parallax pipelines:
//
//   0. Equalize horizontal tonality FIRST. If the source has directional
//      lighting (sunset dark→bright, sunrise bright→dark, vignettes, etc.)
//      then even a perfect seam join will tile as a clearly periodic
//      dark/light pattern — every loop point becomes visible as a band
//      because the eye picks up the brightness rhythm. Flattening the
//      DC drift across the image kills that rhythm so the tile looks
//      like one continuous flow when repeated.
//
//   1. Offset the image by W/2 (split into halves and swap them). The
//      original wrap-around discontinuity is now in the MIDDLE of the
//      offset image; the new "edges" of the offset image come from pixels
//      that were ADJACENT in the original, so they naturally match.
//
//   2. Heal the now-middle seam by blending each pixel in a narrow strip
//      around the seam with its mirror across the seam line. The blend
//      weight peaks at 50/50 right at the seam (so seam pixel values
//      become the average of left and right — invisible) and falls to
//      zero at the strip edges. This mixes both COLORS (handles any
//      remaining local discontinuity) and SHAPE/TEXTURE content (so
//      painterly cloud shapes ghost-fade into each other instead of
//      butting hard).
//
//   3. Offset back so the user's "x=0" content stays in place. The healed
//      strip ends up split across the loop point — exactly where it
//      needs to be to make tiling seamless.
// ─────────────────────────────────────────────────────────────────────────────

export interface MakeTileableOptions {
  /**
   * Width in pixels of the seam-distribution strip. Wider = smoother
   * gradient near the loop, but more original content gets shifted.
   * Defaults to ~10% of the image width, clamped to [32, 800].
   */
  blendWidthPx?: number
  /**
   * Skip pixels close to this color when measuring/applying the seam
   * correction. Used for parallax keyed layers (raw magenta-bg images)
   * so the magenta key isn't tinted. Rows where either seam pixel is
   * the key color are skipped entirely.
   */
  ignoreKeyColor?: { r: number; g: number; b: number; threshold?: number }
  /**
   * Treat pixels with alpha below this value as "key" — so transparent
   * regions in already-keyed images don't get correction applied.
   */
  minAlpha?: number
  /**
   * How aggressively to flatten the horizontal tonal drift before the
   * seam fix (Stage 0). 0 = preserve original lighting (visible bands
   * if the source has a strong dark→bright gradient), 1 = fully flat
   * tonality (best tiling, but loses any directional sun/sunset look).
   * Default 0.85 — strong enough to kill periodic banding for painterly
   * skies, soft enough to keep some natural variation.
   */
  equalizeStrength?: number
}

/**
 * Returns a new PNG data URL that loops seamlessly when tiled horizontally.
 * The original is unchanged. Sky / opaque images and keyed (magenta-bg)
 * images both work — pass `ignoreKeyColor` for the latter.
 */
export async function makeHorizontallyTileable(
  imageDataUrl: string,
  options: MakeTileableOptions = {}
): Promise<string> {
  // ── Stage 0: equalize horizontal tonal drift ────────────────────────────
  // This is what makes the difference between "works for pixel art only"
  // and "works for everything". A painterly sky with directional lighting
  // tiles as visible periodic bands UNLESS the dark-to-bright gradient is
  // flattened across the whole image first. Pixel art usually has flat
  // tonality already, which is why the previous version looked fine on
  // pixel art and showed obvious banding on photo/painterly content.
  const equalizeStrength = options.equalizeStrength ?? 0.85
  const equalized =
    equalizeStrength > 0
      ? await harmonizeHorizontalSeams(imageDataUrl, {
          strength: equalizeStrength,
          // Tighter sigma than the default panel-banding fix because here
          // we want to flatten the WHOLE image's left-right drift, not
          // just smooth multi-panel artefacts. ~W/4 gives a smoothing
          // window that spans roughly half the image — enough to kill the
          // global directional gradient.
          sigmaPx: undefined,
          ignoreKeyColor: options.ignoreKeyColor,
          minAlpha: options.minAlpha,
        })
      : imageDataUrl

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const W = img.width
      const H = img.height
      if (W < 8 || H < 1) {
        resolve(equalized)
        return
      }
      const halfW = Math.floor(W / 2)
      // Default blend strip = 10% of width. Wider than a pure DC-shift
      // approach because the mirror-fade needs room to ramp the per-pixel
      // mirror weight smoothly from 0.5 (at seam) down to 0 (at edges) —
      // a wider ramp means painterly clouds get more frames to ghost-
      // fade into their counterpart, which reads as a soft transition
      // rather than a "double exposure".
      const K = Math.max(
        32,
        Math.min(800, options.blendWidthPx ?? Math.round(W * 0.1))
      )
      const seamX = W - halfW

      // ── Step 1: roll the image by halfW into a working canvas ───────────
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      // Right half of the original → left of rolled.
      ctx.drawImage(img, halfW, 0, W - halfW, H, 0, 0, W - halfW, H)
      // Left half of the original → right of rolled.
      ctx.drawImage(img, 0, 0, halfW, H, W - halfW, 0, halfW, H)

      // ── Step 2: mirror-fade across the middle seam ─────────────────────
      // For each pixel in the strip [seamX - K, seamX + K], blend its
      // value with the value of its mirror across the seam line. Blend
      // weight peaks at 0.5 right at the seam (making seam pixels equal
      // to the seam average → invisible) and falls smoothly to 0 at the
      // strip boundaries (so far-from-seam pixels are unchanged).
      const imageData = ctx.getImageData(0, 0, W, H)
      const data = imageData.data
      // Snapshot before any writes so reads always see the un-modified
      // rolled values regardless of iteration order.
      const snapshot = new Uint8ClampedArray(data)

      const smoothstep = (t: number): number => {
        const c = t < 0 ? 0 : t > 1 ? 1 : t
        return c * c * (3 - 2 * c)
      }

      const key = options.ignoreKeyColor
      const keyT = key?.threshold ?? 80
      const keyTSq = keyT * keyT
      const minAlpha = options.minAlpha ?? 0

      const isKeyPixel = (r: number, g: number, b: number, a: number) => {
        if (a < minAlpha) return true
        if (!key) return false
        const dr = r - key.r
        const dg = g - key.g
        const db = b - key.b
        return dr * dr + dg * dg + db * db < keyTSq
      }

      const stripStart = Math.max(0, seamX - K)
      const stripEnd = Math.min(W, seamX + K)

      for (let y = 0; y < H; y++) {
        for (let x = stripStart; x < stripEnd; x++) {
          const idx = (y * W + x) * 4
          const sR = snapshot[idx]
          const sG = snapshot[idx + 1]
          const sB = snapshot[idx + 2]
          const sA = snapshot[idx + 3]
          if (isKeyPixel(sR, sG, sB, sA)) continue

          const mirrorX = 2 * seamX - 1 - x
          if (mirrorX < 0 || mirrorX >= W) continue

          const mIdx = (y * W + mirrorX) * 4
          const mR = snapshot[mIdx]
          const mG = snapshot[mIdx + 1]
          const mB = snapshot[mIdx + 2]
          const mA = snapshot[mIdx + 3]
          if (isKeyPixel(mR, mG, mB, mA)) continue

          // Distance from seam, normalised to [0, 1]. Using the sub-pixel
          // offset 0.5 keeps the math symmetric across seamX so the two
          // pixels straddling the seam (seamX-1 and seamX) both land at
          // the same blend weight 0.5.
          const dist = Math.min(1, Math.abs(x - seamX + 0.5) / K)
          // Mirror weight peaks at 0.5 (at seam) and tapers to 0 (at
          // strip boundaries). Smoothstep on (1 - dist) gives a smooth
          // bell that's flat at both ends — no visible kink at the
          // strip edges.
          const alphaMirror = 0.5 * smoothstep(1 - dist)
          const alphaOrig = 1 - alphaMirror

          const r = alphaOrig * sR + alphaMirror * mR
          const g = alphaOrig * sG + alphaMirror * mG
          const b = alphaOrig * sB + alphaMirror * mB
          data[idx] = r < 0 ? 0 : r > 255 ? 255 : r
          data[idx + 1] = g < 0 ? 0 : g > 255 ? 255 : g
          data[idx + 2] = b < 0 ? 0 : b > 255 ? 255 : b
        }
      }
      ctx.putImageData(imageData, 0, 0)

      // ── Step 3: roll back so the user's original "start" stays at x=0.
      // Rolling by halfW twice = identity on indexing; the corrections we
      // applied at the rolled middle land split across positions [W-K, W-1]
      // and [0, K-1] in the final image — exactly the loop point.
      const finalCanvas = document.createElement('canvas')
      finalCanvas.width = W
      finalCanvas.height = H
      const finalCtx = finalCanvas.getContext('2d')
      if (!finalCtx) {
        reject(new Error('Failed to get final canvas context'))
        return
      }
      finalCtx.drawImage(canvas, halfW, 0, W - halfW, H, 0, 0, W - halfW, H)
      finalCtx.drawImage(canvas, 0, 0, halfW, H, W - halfW, 0, halfW, H)

      resolve(finalCanvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = equalized
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Make vertically tileable — same algorithm as `makeHorizontallyTileable`
// but applied along Y. Implementation rotates the source 90° clockwise,
// runs the horizontal pass, then rotates back. This reuses every helper
// (snapshot, smoothstep, mirror-fade, equalize) without duplication.
//
// Used by edge tiles whose only loop axis is vertical (left edge / right
// edge in a platformer auto-tile).
// ─────────────────────────────────────────────────────────────────────────────

export async function makeVerticallyTileable(
  imageDataUrl: string,
  options: MakeTileableOptions = {}
): Promise<string> {
  const rotated = await rotate90(imageDataUrl, 'cw')
  const tiled = await makeHorizontallyTileable(rotated, options)
  return rotate90(tiled, 'ccw')
}

/** Rotate a PNG data URL by 90 degrees in either direction. */
async function rotate90(
  imageDataUrl: string,
  direction: 'cw' | 'ccw'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const W = img.width
      const H = img.height
      const canvas = document.createElement('canvas')
      canvas.width = H
      canvas.height = W
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get rotation canvas context'))
        return
      }
      // Translate to the new center, rotate, then draw centered on origin.
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(direction === 'cw' ? Math.PI / 2 : -Math.PI / 2)
      ctx.drawImage(img, -W / 2, -H / 2)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Failed to load image for rotation'))
    img.src = imageDataUrl
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Slice an image into a uniform grid of cells. Used by the tile-set
// sprite-sheet flow: one AI call returns the full 4×4 sheet, then this
// utility cuts it into row-major cells. The source is rescaled to the
// expected sheet dimensions BEFORE slicing so the cuts always land on
// clean fractional boundaries even if the AI returned a slightly-off
// resolution (e.g. 2056×2048 instead of 2048²).
//
// Returns row-major cells: `result[row * cols + col]`.
// ─────────────────────────────────────────────────────────────────────────────

export interface SliceImageGridOptions {
  cols: number
  rows: number
  /** Final cell size in pixels. Each output PNG is exactly this size. */
  cellSize: number
}

export async function sliceImageGrid(
  imageDataUrl: string,
  options: SliceImageGridOptions
): Promise<string[]> {
  const { cols, rows, cellSize } = options
  const sheetW = cols * cellSize
  const sheetH = rows * cellSize

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      // Normalize to the expected sheet size first so slicing always lands
      // on clean cell boundaries, even when the model returns a slightly
      // different resolution.
      const sheetCanvas = document.createElement('canvas')
      sheetCanvas.width = sheetW
      sheetCanvas.height = sheetH
      const sheetCtx = sheetCanvas.getContext('2d')
      if (!sheetCtx) {
        reject(new Error('Failed to get sheet canvas context'))
        return
      }
      sheetCtx.imageSmoothingEnabled = true
      sheetCtx.imageSmoothingQuality = 'high'
      sheetCtx.drawImage(img, 0, 0, sheetW, sheetH)

      const cells: string[] = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cellCanvas = document.createElement('canvas')
          cellCanvas.width = cellSize
          cellCanvas.height = cellSize
          const cellCtx = cellCanvas.getContext('2d')
          if (!cellCtx) {
            reject(new Error('Failed to get cell canvas context'))
            return
          }
          cellCtx.drawImage(
            sheetCanvas,
            c * cellSize,
            r * cellSize,
            cellSize,
            cellSize,
            0,
            0,
            cellSize,
            cellSize
          )
          cells.push(cellCanvas.toDataURL('image/png'))
        }
      }
      resolve(cells)
    }
    img.onerror = () => reject(new Error('Failed to load image for slicing'))
    img.src = imageDataUrl
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Make 2D tileable — combines the horizontal pass (`makeHorizontallyTileable`)
// with a vertical pass that fixes the top↔bottom seam the same way: roll the
// image by H/2, mirror-fade the now-middle horizontal seam between halves,
// then roll back. The end result tiles seamlessly in BOTH X and Y for engine
// tile-map use (stones, grass, brick, dirt, etc.).
//
// Skips the equalize-tonality stage 0 by default for vertical: material
// textures usually have NO directional vertical gradient (no sky-to-ground)
// so flattening would only erase legitimate variation. The horizontal pass
// still runs equalize because horizontal directional drift is common (and
// the source already wasn't tile-friendly because of it).
// ─────────────────────────────────────────────────────────────────────────────

export interface MakeTileable2DOptions extends MakeTileableOptions {
  /**
   * Vertical seam-distribution strip height in pixels. Defaults to ~10% of
   * the image height, clamped to [32, 800].
   */
  verticalBlendHeightPx?: number
}

/**
 * Returns a new PNG data URL that loops seamlessly when tiled in BOTH X and Y.
 * The original is unchanged. Designed for opaque material textures; works on
 * keyed images too if `ignoreKeyColor` is passed.
 */
export async function makeTileable2D(
  imageDataUrl: string,
  options: MakeTileable2DOptions = {}
): Promise<string> {
  // ── Pass 1: horizontal tileability (with default tonal equalize) ───────
  const horizontallyTileable = await makeHorizontallyTileable(
    imageDataUrl,
    options
  )

  // ── Pass 2: vertical tileability ────────────────────────────────────────
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const W = img.width
      const H = img.height
      if (H < 8 || W < 1) {
        resolve(horizontallyTileable)
        return
      }

      const halfH = Math.floor(H / 2)
      const K = Math.max(
        32,
        Math.min(800, options.verticalBlendHeightPx ?? Math.round(H * 0.1))
      )
      const seamY = H - halfH

      // Step 1: roll the image by halfH into a working canvas.
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      // Bottom half of the source → top of rolled.
      ctx.drawImage(img, 0, halfH, W, H - halfH, 0, 0, W, H - halfH)
      // Top half of the source → bottom of rolled.
      ctx.drawImage(img, 0, 0, W, halfH, 0, H - halfH, W, halfH)

      // Step 2: mirror-fade across the now-middle horizontal seam.
      const imageData = ctx.getImageData(0, 0, W, H)
      const data = imageData.data
      const snapshot = new Uint8ClampedArray(data)

      const smoothstep = (t: number): number => {
        const c = t < 0 ? 0 : t > 1 ? 1 : t
        return c * c * (3 - 2 * c)
      }

      const key = options.ignoreKeyColor
      const keyT = key?.threshold ?? 80
      const keyTSq = keyT * keyT
      const minAlpha = options.minAlpha ?? 0

      const isKeyPixel = (r: number, g: number, b: number, a: number) => {
        if (a < minAlpha) return true
        if (!key) return false
        const dr = r - key.r
        const dg = g - key.g
        const db = b - key.b
        return dr * dr + dg * dg + db * db < keyTSq
      }

      const stripStart = Math.max(0, seamY - K)
      const stripEnd = Math.min(H, seamY + K)

      for (let y = stripStart; y < stripEnd; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4
          const sR = snapshot[idx]
          const sG = snapshot[idx + 1]
          const sB = snapshot[idx + 2]
          const sA = snapshot[idx + 3]
          if (isKeyPixel(sR, sG, sB, sA)) continue

          const mirrorY = 2 * seamY - 1 - y
          if (mirrorY < 0 || mirrorY >= H) continue

          const mIdx = (mirrorY * W + x) * 4
          const mR = snapshot[mIdx]
          const mG = snapshot[mIdx + 1]
          const mB = snapshot[mIdx + 2]
          const mA = snapshot[mIdx + 3]
          if (isKeyPixel(mR, mG, mB, mA)) continue

          const dist = Math.min(1, Math.abs(y - seamY + 0.5) / K)
          const alphaMirror = 0.5 * smoothstep(1 - dist)
          const alphaOrig = 1 - alphaMirror

          const r = alphaOrig * sR + alphaMirror * mR
          const g = alphaOrig * sG + alphaMirror * mG
          const b = alphaOrig * sB + alphaMirror * mB
          data[idx] = r < 0 ? 0 : r > 255 ? 255 : r
          data[idx + 1] = g < 0 ? 0 : g > 255 ? 255 : g
          data[idx + 2] = b < 0 ? 0 : b > 255 ? 255 : b
        }
      }
      ctx.putImageData(imageData, 0, 0)

      // Step 3: roll back so the user's "y=0" content stays at the top.
      // The healed horizontal strip lands at the top↔bottom loop point.
      const finalCanvas = document.createElement('canvas')
      finalCanvas.width = W
      finalCanvas.height = H
      const finalCtx = finalCanvas.getContext('2d')
      if (!finalCtx) {
        reject(new Error('Failed to get final canvas context'))
        return
      }
      finalCtx.drawImage(canvas, 0, halfH, W, H - halfH, 0, 0, W, H - halfH)
      finalCtx.drawImage(canvas, 0, 0, W, halfH, 0, H - halfH, W, halfH)

      resolve(finalCanvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = horizontallyTileable
  })
}

/**
 * Re-render an image at a target height while preserving its aspect ratio.
 * Used in parallax mode to normalize an uploaded starter frame to a chosen
 * game resolution height — keeps the workflow tidy when the user wants 1080,
 * 720, etc. Returns the original data URL untouched if it already matches.
 */
export function fitImageToHeight(
  imageDataUrl: string,
  targetHeight: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      if (img.height === targetHeight) {
        resolve(imageDataUrl)
        return
      }
      const scale = targetHeight / img.height
      const newWidth = Math.round(img.width * scale)
      const canvas = document.createElement('canvas')
      canvas.width = newWidth
      canvas.height = targetHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, newWidth, targetHeight)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = imageDataUrl
  })
}

// ---------------------------------------------------------------------------
// Sprite-sheet frame baseline alignment
// ---------------------------------------------------------------------------
//
// Even with a structural guide image, multi-panel AI sprite generation can
// drift on the y-axis from frame to frame — the model paints the character
// 5–25 pixels higher or lower in some cells than others, producing a "feet
// bouncing" flicker when the animation is played back at speed.
//
// The fix is purely post-process: once frames have been chroma-keyed to
// transparency, we scan each frame's alpha channel from the bottom up to
// detect the actual foot pixel coordinate, then translate the frame
// vertically so every detected foot coordinate matches a shared target.
// Detection uses opacity (not magenta) because the cells are already keyed.
//
// We use the MEDIAN of all bottoms as the target so the alignment is
// robust to airborne outliers (jump apex, run mid-air recovery frames):
// those frames have a wildly higher bottom and get filtered out before
// they can poison the target. Frames that drift further than `maxShift`
// from the target are treated as intentionally airborne and left alone.

interface FrameAlignmentOptions {
  /** Alpha (0–255) above which a pixel counts as "character" content.
   *  Anti-aliased halo pixels are typically <16; we use 32 to be safe. */
  alphaThreshold?: number
  /** Minimum opaque pixels per row to accept that row as the bottom.
   *  Guards against single stray pixels from chroma-key artifacts. */
  minRowPixels?: number
  /** Max absolute vertical shift (in pixels) to apply. Frames whose
   *  detected bottom drifts more than this from the target are skipped
   *  (assumed airborne). Defaults to 20% of the cell height. Ignored when
   *  `groundAll` is true. */
  maxShift?: number
  /** When true, treat the animation as fully GROUNDED (no airborne frames):
   *  EVERY frame is planted on the shared (median) baseline regardless of how
   *  far it must move — no frame is exempted as "airborne". Use for idle /
   *  walk / attack / hurt / death. Leave false for jump / run so apex frames
   *  that drift past `maxShift` keep their lift. */
  groundAll?: boolean
}

/**
 * Find the y-coordinate of the character's foot baseline: the lowest row that
 * is the bottom of a SOLID vertical run, not an isolated stray.
 *
 * Naively returning "the lowest row with ≥N opaque pixels" is fragile: a
 * single line of chroma-key halo pixels, a faint anti-aliased edge, or a thin
 * downward protrusion (a sword tip, a trailing cape) sits below the real feet
 * and poisons the baseline for that one frame — which is the main source of
 * per-frame baseline inconsistency. We instead require the detected bottom to
 * cap a run of `runRows` consecutive substantive rows, so thin artifacts are
 * ignored and we lock onto actual body mass (the foot).
 */
function findFrameBottomY(
  imageData: ImageData,
  alphaThreshold: number,
  minRowPixels: number,
  runRows: number
): number {
  const { data, width, height } = imageData
  const counts = new Array<number>(height)
  for (let y = 0; y < height; y++) {
    let c = 0
    const rowStart = y * width * 4
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] > alphaThreshold) c++
    }
    counts[y] = c
  }
  // Lowest row that caps a run of `runRows` substantive rows (rejects strays).
  for (let y = height - 1; y >= 0; y--) {
    if (counts[y] < minRowPixels) continue
    let run = 0
    for (let k = 0; k < runRows && y - k >= 0; k++) {
      if (counts[y - k] >= minRowPixels) run++
      else break
    }
    if (run >= runRows) return y
  }
  // Fallback: lowest row with any content at all (very short/thin subjects).
  for (let y = height - 1; y >= 0; y--) {
    if (counts[y] >= 1) return y
  }
  return -1
}

/**
 * Translate a chroma-keyed cell vertically by `shiftY` pixels, returning
 * a fresh PNG data URL. Positive `shiftY` moves content DOWN (top rows
 * become transparent, bottom rows clip off). Negative moves UP.
 */
function shiftCellVertical(
  img: HTMLImageElement,
  shiftY: number
): string {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, shiftY)
  return canvas.toDataURL('image/png')
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })
}

// ---------------------------------------------------------------------------
// Uploaded-character background cleanup
// ---------------------------------------------------------------------------
//
// Users often upload an asset that LOOKS transparent but actually has a
// checkerboard (or plain/solid) background baked into the pixels — e.g. a
// screenshot of a transparent sprite from an editor. Our chroma-key only
// strips magenta, so that baked background would otherwise be treated as part
// of the art by the model.
//
// This pass removes such a background by flood-filling inward from the image
// edges, clearing pixels that look like background:
//   • the editor "transparency" checkerboard (light + de-saturated greys), or
//   • a solid backdrop matching the sampled corner color.
// Because it only removes regions CONNECTED to the border, interior light
// areas of the character (white collar, etc.) are preserved.
//
// CRITICAL: if the image already carries real transparency, we assume it's a
// clean asset and return it untouched — so this never damages proper PNGs.

interface UploadBackgroundOptions {
  /** If the fraction of already-transparent pixels exceeds this, the image is
   *  treated as a clean transparent asset and returned unchanged. */
  transparentSkipFraction?: number
  /** Max dimension to process at (keeps the flood fill cheap on huge uploads). */
  maxSize?: number
}

export async function removeUploadedBackground(
  dataUrl: string,
  opts: UploadBackgroundOptions = {}
): Promise<string> {
  const transparentSkipFraction = opts.transparentSkipFraction ?? 0.02
  const maxSize = opts.maxSize ?? 1024

  const img = await loadImageFromUrl(dataUrl)
  let w = img.width
  let h = img.height
  if (!w || !h) return dataUrl
  // Downscale only for processing if absurdly large; otherwise keep native.
  const scale = Math.min(1, maxSize / Math.max(w, h))
  w = Math.max(1, Math.round(w * scale))
  h = Math.max(1, Math.round(h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(img, 0, 0, w, h)
  const imageData = ctx.getImageData(0, 0, w, h)
  const { data } = imageData
  const n = w * h

  // Already transparent? Treat as a clean asset and leave it alone.
  let transparent = 0
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 200) transparent++
  }
  if (transparent / n > transparentSkipFraction) return dataUrl

  // Sample the four corners to characterize a possible solid backdrop.
  const corners = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ].map(([x, y]) => {
    const i = (y * w + x) * 4
    return [data[i], data[i + 1], data[i + 2]] as [number, number, number]
  })
  const avgCorner: [number, number, number] = [
    Math.round(corners.reduce((s, c) => s + c[0], 0) / corners.length),
    Math.round(corners.reduce((s, c) => s + c[1], 0) / corners.length),
    Math.round(corners.reduce((s, c) => s + c[2], 0) / corners.length),
  ]
  // Are the corners consistent enough to call it a single solid backdrop?
  const cornerSpread = Math.max(
    ...corners.map((c) =>
      Math.max(
        Math.abs(c[0] - avgCorner[0]),
        Math.abs(c[1] - avgCorner[1]),
        Math.abs(c[2] - avgCorner[2])
      )
    )
  )
  const solidBackdrop = cornerSpread < 24

  const isCheckerLike = (r: number, g: number, b: number): boolean => {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    // Light and nearly grey — covers both the white and grey checker squares.
    return max > 175 && max - min < 38
  }
  const matchesCorner = (r: number, g: number, b: number): boolean => {
    if (!solidBackdrop) return false
    return (
      Math.abs(r - avgCorner[0]) +
        Math.abs(g - avgCorner[1]) +
        Math.abs(b - avgCorner[2]) <
      60
    )
  }
  const isBackground = (idx: number): boolean => {
    const i = idx * 4
    if (data[i + 3] < 16) return true
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    return isCheckerLike(r, g, b) || matchesCorner(r, g, b)
  }

  // BFS flood fill from every border pixel through background-like pixels.
  const visited = new Uint8Array(n)
  const queue: number[] = []
  const pushIf = (idx: number) => {
    if (idx < 0 || idx >= n) return
    if (visited[idx]) return
    visited[idx] = 1
    if (isBackground(idx)) queue.push(idx)
  }
  for (let x = 0; x < w; x++) {
    pushIf(x)
    pushIf((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    pushIf(y * w)
    pushIf(y * w + (w - 1))
  }
  let removed = 0
  while (queue.length) {
    const idx = queue.pop() as number
    data[idx * 4 + 3] = 0
    removed++
    const x = idx % w
    const y = (idx / w) | 0
    if (x > 0) pushIf(idx - 1)
    if (x < w - 1) pushIf(idx + 1)
    if (y > 0) pushIf(idx - w)
    if (y < h - 1) pushIf(idx + w)
  }

  // Nothing looked like background — return original to be safe.
  if (removed === 0) return dataUrl

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Align an array of chroma-keyed sprite-cell PNGs so their detected foot
 * baselines share a common y-coordinate. Returns the aligned cells in the
 * same order, plus diagnostic info about what was detected.
 *
 * Algorithm:
 *   1. Decode each cell's alpha channel to find its bottom y.
 *   2. Compute the MEDIAN of the detected bottoms (robust to outliers).
 *   3. For each cell, compute delta = median - cellBottom.
 *      - |delta| ≤ maxShift → translate cell by delta px (alignment).
 *      - |delta|  > maxShift → leave cell alone (assumed airborne).
 *      - cellBottom = -1 → leave cell alone (empty frame).
 *
 * Input cells are expected to be the same size; mismatched sizes still
 * work but the maxShift default is computed from the first cell.
 */
export async function alignSpriteFramesToBaseline(
  cells: string[],
  opts: FrameAlignmentOptions = {}
): Promise<{
  cells: string[]
  targetBaseline: number | null
  detected: number[]
  shifted: number[]
}> {
  if (cells.length === 0) {
    return { cells, targetBaseline: null, detected: [], shifted: [] }
  }

  // Ignore faint chroma-key halo (semi-transparent edge pixels) by requiring a
  // reasonably opaque pixel, and reject thin strays via the run requirement.
  const alphaThreshold = opts.alphaThreshold ?? 64
  const minRowPixels = opts.minRowPixels ?? 4
  const groundAll = opts.groundAll ?? false

  const images = await Promise.all(cells.map((c) => loadImageFromUrl(c)))
  const cellHeight = images[0]?.height ?? 512
  const maxShift = opts.maxShift ?? Math.floor(cellHeight * 0.2)
  const runRows = Math.max(3, Math.round(cellHeight * 0.012))

  // Extract bottoms.
  const detected: number[] = images.map((img) => {
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return -1
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, img.width, img.height)
    return findFrameBottomY(data, alphaThreshold, minRowPixels, runRows)
  })

  // Median over valid (non -1) bottoms. If none are valid, return
  // unchanged. The MEDIAN is deliberately robust: a single frame whose
  // detected bottom is still off (residual artifact, or a genuinely lower
  // pose) cannot drag the whole sheet's baseline with it. In the common case
  // the bottoms cluster tightly, so the median IS the true foot line; when a
  // whole row has drifted high, the median lands on the larger (grounded)
  // cluster, pulling the drifted row down to it.
  const validBottoms = detected.filter((b) => b >= 0).sort((a, b) => a - b)
  if (validBottoms.length === 0) {
    return { cells, targetBaseline: null, detected, shifted: detected.map(() => 0) }
  }
  const targetBaseline = validBottoms[Math.floor(validBottoms.length / 2)]

  // Shift each cell.
  const aligned: string[] = []
  const shifts: number[] = []
  for (let i = 0; i < cells.length; i++) {
    const bottom = detected[i]
    if (bottom < 0) {
      aligned.push(cells[i])
      shifts.push(0)
      continue
    }
    const delta = targetBaseline - bottom
    if (!groundAll && Math.abs(delta) > maxShift) {
      // Airborne / outlier frame — preserve (only when the anim can have
      // airborne frames; grounded anims always plant every frame).
      aligned.push(cells[i])
      shifts.push(0)
      continue
    }
    if (Math.abs(delta) < 1) {
      // Already aligned.
      aligned.push(cells[i])
      shifts.push(0)
      continue
    }
    try {
      aligned.push(shiftCellVertical(images[i], delta))
      shifts.push(delta)
    } catch {
      aligned.push(cells[i])
      shifts.push(0)
    }
  }

  return {
    cells: aligned,
    targetBaseline,
    detected,
    shifted: shifts,
  }
}

// ---------------------------------------------------------------------------
// Sprite-sheet frame-border cleanup
// ---------------------------------------------------------------------------
//
// The model sometimes paints faint cell-divider lines on the sheet (a thin
// dark rectangle around each cell) even though the prompt forbids it. Those
// lines aren't magenta, so chroma-keying leaves them in place and every sliced
// frame ends up with a dark square border around it.
//
// This pass erases that border: for each of the 4 edges it scans a thin band
// inward and clears any row/column that is "border-like" — i.e. opaque across
// most of the edge's length. A real character never forms a near-full-width
// opaque line right at a cell edge (it's centered with margin), so this only
// catches divider lines, not the character.

interface BorderCleanupOptions {
  /** Fraction of an edge's length that must be opaque for the row/col to be
   *  treated as a border line. High enough that character limbs/feet never
   *  trip it. Default 0.7. */
  coverage?: number
  /** How far inward to look for border lines, as a fraction of cell size.
   *  Default 0.03 (≈15px on a 512 cell) to also catch borders inset a few px. */
  bandFraction?: number
  /** Alpha above which a pixel counts as opaque. Default 24 (catches even
   *  semi-transparent divider lines). */
  alphaThreshold?: number
}

/**
 * Erase full-span border lines from the edges of a single chroma-keyed cell.
 * Returns a fresh PNG data URL (unchanged if no border is detected).
 */
export async function removeFrameBorder(
  cellDataUrl: string,
  opts: BorderCleanupOptions = {}
): Promise<string> {
  const coverage = opts.coverage ?? 0.7
  const bandFraction = opts.bandFraction ?? 0.03
  const alphaThreshold = opts.alphaThreshold ?? 24

  const img = await loadImageFromUrl(cellDataUrl)
  const w = img.width
  const h = img.height
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return cellDataUrl
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, w, h)
  const { data } = imageData

  const band = Math.max(2, Math.round(Math.min(w, h) * bandFraction))
  const rowNeed = Math.round(w * coverage)
  const colNeed = Math.round(h * coverage)
  let changed = false

  const rowOpaque = (y: number): number => {
    let c = 0
    const rs = y * w * 4
    for (let x = 0; x < w; x++) if (data[rs + x * 4 + 3] > alphaThreshold) c++
    return c
  }
  const colOpaque = (x: number): number => {
    let c = 0
    for (let y = 0; y < h; y++) if (data[(y * w + x) * 4 + 3] > alphaThreshold) c++
    return c
  }
  const clearRow = (y: number) => {
    const rs = y * w * 4
    for (let x = 0; x < w; x++) data[rs + x * 4 + 3] = 0
  }
  const clearCol = (x: number) => {
    for (let y = 0; y < h; y++) data[(y * w + x) * 4 + 3] = 0
  }

  for (let k = 0; k < band; k++) {
    if (rowOpaque(k) >= rowNeed) {
      clearRow(k)
      changed = true
    }
    if (rowOpaque(h - 1 - k) >= rowNeed) {
      clearRow(h - 1 - k)
      changed = true
    }
    if (colOpaque(k) >= colNeed) {
      clearCol(k)
      changed = true
    }
    if (colOpaque(w - 1 - k) >= colNeed) {
      clearCol(w - 1 - k)
      changed = true
    }
  }

  if (!changed) return cellDataUrl
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

// ---------------------------------------------------------------------------
// Sprite-sheet horizontal centering
// ---------------------------------------------------------------------------
//
// Companion to the baseline (vertical) pass. The model sometimes paints the
// character offset to one side of a cell, or lets it slide left/right across
// frames so an "in place" walk/run looks like it's drifting. This pass scans
// each chroma-keyed cell, finds the character's horizontal CENTER OF MASS
// (centroid of opaque pixels — robust against a thin protrusion like a drawn
// sword or a swinging arm, which a bounding-box midpoint would over-weight),
// then translates the cell horizontally so that center lands on a shared
// target. The default target is the exact cell center, which both centers the
// character and pins it "in place" frame-to-frame.

interface FrameCenterOptions {
  /** Alpha (0–255) above which a pixel counts as character content. */
  alphaThreshold?: number
  /** Minimum opaque pixels required to trust the centroid (skips empty cells). */
  minPixels?: number
  /** 'cellCenter' (default) centers each frame's mass at width/2. 'shared'
   *  instead aligns every frame to the MEDIAN centroid — removes drift between
   *  frames without forcing dead-center, useful if the art is intentionally
   *  off-center but should stay put. */
  mode?: 'cellCenter' | 'shared'
  /** Max absolute horizontal shift (px). Guards against a bad detection
   *  shoving a frame off-screen. Defaults to 40% of the cell width. */
  maxShift?: number
}

/** Horizontal center of mass of opaque pixels; -1 if too few pixels. */
function findFrameCentroidX(
  imageData: ImageData,
  alphaThreshold: number,
  minPixels: number
): number {
  const { data, width, height } = imageData
  let sumX = 0
  let count = 0
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * 4 + 3] > alphaThreshold) {
        sumX += x
        count++
      }
    }
  }
  if (count < minPixels) return -1
  return sumX / count
}

/** Translate a cell horizontally by `shiftX` px (positive = right). */
function shiftCellHorizontal(img: HTMLImageElement, shiftX: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, shiftX, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Center an array of chroma-keyed sprite cells horizontally so each
 * character's center of mass lands on a shared target (the cell center by
 * default). Returns the centered cells in order plus diagnostics.
 */
export async function centerSpriteFramesHorizontally(
  cells: string[],
  opts: FrameCenterOptions = {}
): Promise<{
  cells: string[]
  targetCenterX: number | null
  detected: number[]
  shifted: number[]
}> {
  if (cells.length === 0) {
    return { cells, targetCenterX: null, detected: [], shifted: [] }
  }

  const alphaThreshold = opts.alphaThreshold ?? 32
  const minPixels = opts.minPixels ?? 24
  const mode = opts.mode ?? 'cellCenter'

  const images = await Promise.all(cells.map((c) => loadImageFromUrl(c)))
  const cellWidth = images[0]?.width ?? 512
  const maxShift = opts.maxShift ?? Math.floor(cellWidth * 0.4)

  const detected: number[] = images.map((img) => {
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return -1
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, img.width, img.height)
    return findFrameCentroidX(data, alphaThreshold, minPixels)
  })

  const validCenters = detected.filter((c) => c >= 0).sort((a, b) => a - b)
  if (validCenters.length === 0) {
    return {
      cells,
      targetCenterX: null,
      detected,
      shifted: detected.map(() => 0),
    }
  }

  const targetCenterX =
    mode === 'shared'
      ? validCenters[Math.floor(validCenters.length / 2)]
      : cellWidth / 2

  const centered: string[] = []
  const shifts: number[] = []
  for (let i = 0; i < cells.length; i++) {
    const cx = detected[i]
    if (cx < 0) {
      centered.push(cells[i])
      shifts.push(0)
      continue
    }
    let delta = Math.round(targetCenterX - cx)
    if (Math.abs(delta) > maxShift) {
      delta = Math.sign(delta) * maxShift
    }
    if (Math.abs(delta) < 1) {
      centered.push(cells[i])
      shifts.push(0)
      continue
    }
    try {
      centered.push(shiftCellHorizontal(images[i], delta))
      shifts.push(delta)
    } catch {
      centered.push(cells[i])
      shifts.push(0)
    }
  }

  return { cells: centered, targetCenterX, detected, shifted: shifts }
}
