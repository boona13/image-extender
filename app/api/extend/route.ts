import { NextRequest, NextResponse } from 'next/server'
import {
  ProviderHttpError,
  assertProviderReady,
  callImageProvider,
  resolveProvider,
} from '@/app/lib/providers/server'

// Default model when the client doesn't specify one.
const DEFAULT_MODEL = 'google/gemini-3.1-flash-image-preview'

export async function POST(request: NextRequest) {
  try {
    const {
      expandedCanvas,
      direction,
      extensionAmount,
      customPrompt,
      artStyle,
      chunkInfo,
      useFullContext,
      extensionInfo,
      attempt = 0,
      apiKey,
      model,
      layerRole,
      sceneBrief,
      providerSettings,
    } = await request.json()

    if (!expandedCanvas || !direction || !extensionAmount) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // 扩图是 image-to-image 能力，必须走 image provider；旧字段继续作为默认
    // OpenRouter 回退，保证老用户无须迁移设置。
    const provider = resolveProvider({
      capability: 'image',
      providerSettings,
      legacyApiKey: apiKey,
      legacyModel: model,
      defaultModel: DEFAULT_MODEL,
    })
    const providerProblem = assertProviderReady(provider)
    if (providerProblem) {
      return NextResponse.json(
        { error: providerProblem.message },
        { status: providerProblem.status }
      )
    }

    // Create inpainting prompt
    const directionDescriptions = {
      up: 'top',
      down: 'bottom',
      left: 'left side',
      right: 'right side',
    }

    const dirDesc = directionDescriptions[direction as keyof typeof directionDescriptions]
    
    // Full context = entire image sent; chunked = partial strip only
    const isFullContext = !!useFullContext
    const isChunked = !isFullContext && !!chunkInfo
    
    let prompt = isFullContext
      ? `OUTPAINTING TASK: You are extending an image ${direction === 'left' || direction === 'right' ? 'HORIZONTALLY' : 'VERTICALLY'} on the ${dirDesc}.

The input is a single image. The ${dirDesc} portion of the canvas is filled with solid LIGHT GRAY (#B0B0B0). This gray area is the empty space you must fill with realistic scene content.

YOUR TASK:
1. Generate a complete output image at the SAME pixel dimensions as the input.
2. Replace EVERY gray pixel with photorealistic content that continues the existing scene naturally.
3. Keep the non-gray (already-painted) pixels exactly as they appear in the input.

EXTENSION RULES:
- The blank area is on the ${dirDesc} side (${direction === 'up' ? 'ABOVE' : direction === 'down' ? 'BELOW' : direction === 'left' ? 'LEFT OF' : 'RIGHT OF'} the existing content).
- ${direction === 'left' || direction === 'right' ? 'For HORIZONTAL extension: continue the same horizon line, sky band, and ground level. Do NOT add a second ground plane, second sky, or new vanishing point. The new area is more of the same lateral landscape at the same elevation.' : 'For VERTICAL extension: continue the same spatial layer (sky above sky, ground below ground). Do not duplicate ground or sky surfaces.'}
- Match exact color temperature, lighting direction, saturation, contrast, and art style of the existing pixels.
- The seam between original and new content must be invisible — no color shift, brightness jump, or texture discontinuity.

CRITICAL: If you return the image unchanged with the gray area still present, the task has failed. Every gray pixel MUST be replaced.`
      : isChunked
      ? `You are an expert at seamlessly extending image edges. This is a PARTIAL edge strip from a larger image with a light gray blank area on the ${dirDesc} that needs to be filled.

CRITICAL INSTRUCTIONS:
1. Fill ONLY the light gray (#B0B0B0) blank area on the ${dirDesc} — do NOT leave any gray pixels unfilled
2. Continue the visible content naturally - match colors, textures, lighting at the edge
3. Do NOT modify the existing content portion of this strip
4. Make the transition at the boundary completely invisible
5. Return the complete strip with every gray pixel replaced by scene content`
      : `You are an expert at seamlessly extending images. This image has a light gray blank area on the ${dirDesc} that needs to be filled naturally.

KEY INSTRUCTIONS:
1. Analyze the existing content carefully - note colors, patterns, textures, lighting
2. Fill the blank ${dirDesc} area by naturally continuing what exists
3. Ensure perfect color matching at the transition boundary
4. Continue any patterns, textures, or elements seamlessly across the border
5. Make the transition completely invisible - no visible seams or borders
6. Preserve the exact style, quality, and atmosphere of the existing content`

    // Add art style if provided
    const artStyleDescriptions: { [key: string]: string } = {
      'cinematic': 'cinematic photography with dramatic lighting and film grain',
      'vintage': 'vintage film photography with faded colors and retro feel',
      'black-white': 'black and white photography with rich contrast',
      'macro': 'macro photography with shallow depth of field',
      'oil-painting': 'oil painting style with visible brush strokes and rich textures',
      'watercolor': 'watercolor painting with soft washes and flowing colors',
      'impressionism': 'impressionist painting style with loose brushwork',
      'abstract': 'abstract art with bold shapes and colors',
      'pop-art': 'pop art style with bold colors and graphic elements',
      'cubism': 'cubist style with geometric shapes and multiple perspectives',
      'minimalist': 'minimalist art with simple forms and limited colors',
      'digital-art': 'digital art with smooth gradients and modern aesthetics',
      'cyberpunk': 'cyberpunk style with neon colors and futuristic elements',
      'vaporwave': 'vaporwave aesthetic with pastel colors and retro-futuristic vibes',
      'low-poly': 'low poly 3D art with geometric faceted surfaces',
      'pixel-art': 'pixel art style with retro video game aesthetics',
      '3d-render': '3D rendered look with realistic lighting and materials',
      'anime': 'anime/manga style with bold lines and vibrant colors',
      'cartoon': 'cartoon illustration with exaggerated features',
      'comic-book': 'comic book style with bold inking and halftone dots',
      'sketch': 'pencil sketch with cross-hatching and shading',
      'ink': 'ink drawing with bold black lines and dramatic contrast',
      'studio-ghibli': 'Studio Ghibli animation style with whimsical, hand-drawn aesthetics and rich environmental details',
      'pixar': 'Pixar animation style with smooth 3D rendering, expressive characters, and vibrant colors',
      'disney': 'Disney animation style with classic hand-drawn or modern 3D aesthetics and magical atmosphere',
      'dreamworks': 'DreamWorks animation style with dynamic expressions and cinematic lighting',
      'illumination': 'Illumination Entertainment style with bright colors, playful characters, and bold shapes',
      'laika': 'Laika Studios stop-motion style with intricate textures and handcrafted details',
      'cartoon-network': 'Cartoon Network style with bold outlines, simplified shapes, and vibrant colors',
      'nickelodeon': 'Nickelodeon animation style with energetic, expressive characters and bright color palettes',
      'aardman': 'Aardman claymation style with textured plasticine characters and British humor aesthetics',
      'blue-sky': 'Blue Sky Studios animation style with detailed 3D rendering and dynamic action sequences',
      'fantasy': 'fantasy art with magical and ethereal elements',
      'sci-fi': 'science fiction with futuristic technology and environments',
      'steampunk': 'steampunk style with Victorian-era and industrial elements',
      'surreal': 'surrealist style with dreamlike and impossible elements',
      'art-deco': 'Art Deco style with geometric patterns and elegant lines',
      'art-nouveau': 'Art Nouveau with flowing organic lines and natural motifs',
      'retro-80s': '1980s retro style with bright colors and bold graphics',
      'retro-50s': '1950s vintage style with pastel colors and classic aesthetics'
    }
    
    if (artStyle && artStyleDescriptions[artStyle]) {
      prompt += `\n\n7. ARTISTIC STYLE: Create the extended area in ${artStyleDescriptions[artStyle]}`
      prompt += `\n   - Apply this style consistently to the new content`
      prompt += `\n   - Ensure smooth transition from original to styled extension`
      prompt += `\n   - The style should blend naturally with the existing content at the boundary`
    }
    
    // Add custom prompt if provided, otherwise add creative instructions
    if (customPrompt) {
      const instructionNumber = artStyle ? '7' : '6'
      prompt += `\n\n${instructionNumber}. USER'S SPECIFIC REQUEST FOR THE NEW EXTENDED AREA: "${customPrompt}"`
      if (isChunked) {
        prompt += `\n   IMPORTANT - PARTIAL STRIP CONTEXT:`
        prompt += `\n   - You only see an edge strip, not the full image - extrapolate naturally from visible content`
        prompt += `\n   - The user's request applies ONLY to the new ${direction === 'up' ? 'upper' : direction === 'down' ? 'lower' : direction === 'left' ? 'left' : 'right'} area (the light gray blank space)`
        prompt += `\n   - Blend and integrate smoothly with the visible edge content`
      } else if (isFullContext) {
        prompt += `\n   IMPORTANT - FULL SCENE CONTEXT:`
        prompt += `\n   - You can see the entire scene - use it to place elements correctly`
        prompt += `\n   - The user's request applies ONLY to the new ${direction === 'up' ? 'upper' : direction === 'down' ? 'lower' : direction === 'left' ? 'left' : 'right'} area (the light gray blank space)`
        prompt += `\n   - Blend and integrate smoothly with the existing scene`
      } else {
        prompt += `\n   - Incorporate this request while maintaining seamless blending`
      }
      if (!artStyle) {
        prompt += `\n   - Maintain perfect style, color, and lighting consistency`
      }
    } else {
      // No custom prompt - guide the AI to continue the existing scene naturally
      // without biasing toward any specific subject matter. Earlier versions of
      // this prompt listed examples like "celestial bodies" which caused the AI
      // to invent planets/galaxies for upward extensions of normal skies, etc.
      const instructionNumber = artStyle ? '7' : '6'
      prompt += `\n\n${instructionNumber}. NATURAL SCENE CONTINUATION:`
      prompt += `\n   - Stay strictly within the genre, setting, environment, and subject matter of the existing image`
      prompt += `\n   - Do NOT introduce new subjects, objects, creatures, or thematic elements that are not already implied by the scene`
      prompt += `\n   - Continue the existing physics consistently: same lighting direction, same time of day, same weather, same atmosphere, same scale, same perspective`
      prompt += `\n   - Avoid mechanical repetition — small natural variation in textures and shapes is good (e.g., slightly different cloud forms, organic terrain undulation, varied foliage)`
      prompt += `\n   - The new area should look like more of the same environment a real camera would capture if panned/tilted in that direction — nothing more, nothing less`
      prompt += `\n   - Match exact color, brightness, contrast, and saturation at the boundary`
    }

    // Parallax layer extensions need extra discipline: the keyed layers must
    // keep their magenta background pure across the new area, and the sky
    // layer must stay opaque without introducing fake silhouettes.
    const KEY_COLOR_HEX = '#FF00FF'
    if (typeof layerRole === 'string') {
      if (layerRole === 'sky') {
        prompt += `\n\nPARALLAX LAYER — SKY / BACK (must tile horizontally):
- This image is the back-most opaque layer of a parallax scene. The new area must continue the same sky / atmosphere / very-distant horizon only — do NOT introduce mid-ground or foreground elements. Keep the result fully opaque, no transparency, no magenta.
- HORIZONTALLY UNIFORM TONE is required for tileability:
  • The sky tone (color, brightness, saturation) must be IDENTICAL at every X position, including the new area you fill — no left-to-right gradient, no warm-to-cool drift, no one-side-darker-than-the-other.
  • Any gradient must run TOP-TO-BOTTOM ONLY. If the existing image already has a top-to-bottom gradient, copy that exact gradient column-for-column into the new area; every horizontal row at the same Y must end up the same color across the whole result.
  • Do NOT introduce a sun, moon, sunbeams, sunrise/sunset glow, gradient backlighting, vignettes, or any directional light source. If the existing image contains any such directional lighting, blend it OUT in the new area so the result becomes horizontally uniform.
  • Cloud distribution should be roughly even across X — do not concentrate clouds on one side of the new area.`
      } else if (
        layerRole === 'far' ||
        layerRole === 'mid' ||
        layerRole === 'near'
      ) {
        const roleDesc =
          layerRole === 'far'
            ? 'far-distant silhouettes only (distant mountains, faint horizon line)'
            : layerRole === 'mid'
              ? 'mid-distance scene elements only (mid-size trees, buildings, terrain features)'
              : 'near foreground elements only (near grass, foreground bushes, rocks, near tree trunks)'
        prompt += `\n\nPARALLAX LAYER — ${layerRole.toUpperCase()} (alpha-keyed):
- This image is a parallax layer where everything OUTSIDE the actual scene elements is a perfectly flat solid pure magenta color exactly ${KEY_COLOR_HEX} (R=255, G=0, B=255). That magenta will be removed by the client and replaced with transparency.
- In the new area you fill, render ONLY ${roleDesc}. Everywhere else in the new area MUST also be the same flat solid ${KEY_COLOR_HEX} magenta — no other background colors, no sky, no other layers' content.
- Continue the existing elements naturally into the new area. Element silhouettes should be crisp against the magenta to minimize halos.
- Do NOT change the magenta background color in any region — it must stay pure ${KEY_COLOR_HEX} everywhere outside the elements, both in the existing area and in the new area.`
      }
    }

    if (typeof sceneBrief === 'string' && sceneBrief.trim()) {
      prompt += `\n\nSHARED SCENE DIRECTION — maintain this art direction exactly in the new area (palette, lighting, mood, style). Do not drift from it:\n${sceneBrief.trim()}`
    }

    prompt += `\n\nFINAL OUTPUT: Return the complete image with the blank area filled. The result must look like a single, unified ${artStyle && artStyleDescriptions[artStyle] ? 'artistic work' : 'scene'} with absolutely no visible seams. The boundary should be completely invisible.`

    if (extensionInfo?.newWidth && extensionInfo?.newHeight) {
      prompt += `\n\nOUTPUT DIMENSIONS: Return the image at exactly ${extensionInfo.newWidth}x${extensionInfo.newHeight} pixels. Do NOT crop, letterbox, or change the aspect ratio. Fill every pixel of the light gray extension area — no gray or white pixels should remain.`
    } else if (isChunked && chunkInfo) {
      const chunkW = chunkInfo.direction === 'left' || chunkInfo.direction === 'right'
        ? chunkInfo.chunkWidth + chunkInfo.extensionSize
        : chunkInfo.originalWidth
      const chunkH = chunkInfo.direction === 'up' || chunkInfo.direction === 'down'
        ? chunkInfo.chunkHeight + chunkInfo.extensionSize
        : chunkInfo.originalHeight
      prompt += `\n\nOUTPUT DIMENSIONS: Return the image at exactly ${chunkW}x${chunkH} pixels — the same dimensions as the input image. Fill every gray pixel in the blank area. Do NOT return a different size or aspect ratio.`
    }

    // 不同图片模型的请求/返回结构差异在 provider 层处理；业务 route 只声明
    // “输入一张扩展画布，并要求返回一张新图”。
    const result = await callImageProvider(
      provider,
      {
        prompt,
        inputImages: [expandedCanvas],
        width: outputWidthFromRequest(extensionInfo, chunkInfo),
        height: outputHeightFromRequest(extensionInfo, chunkInfo),
        maxTokens: 2000,
        temperature: attempt === 0 ? 0.3 : attempt === 1 ? 0.5 : 0.7,
        title: 'AI Image Extender',
        forceEdit: true,
      },
      { referer: request.headers.get('referer') }
    )
    const imageUrl = result.imageUrl

    return NextResponse.json({ imageUrl, chunkInfo })
  } catch (error) {
    console.error('Error in extend route:', error)
    if (error instanceof ProviderHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/** 从 full-context 或 chunked 扩图参数里推导 provider 需要的目标宽度。 */
function outputWidthFromRequest(extensionInfo: any, chunkInfo: any): number {
  if (extensionInfo?.newWidth) return extensionInfo.newWidth
  if (!chunkInfo) return 1024
  return chunkInfo.direction === 'left' || chunkInfo.direction === 'right'
    ? chunkInfo.chunkWidth + chunkInfo.extensionSize
    : chunkInfo.originalWidth
}

/** 从 full-context 或 chunked 扩图参数里推导 provider 需要的目标高度。 */
function outputHeightFromRequest(extensionInfo: any, chunkInfo: any): number {
  if (extensionInfo?.newHeight) return extensionInfo.newHeight
  if (!chunkInfo) return 1024
  return chunkInfo.direction === 'up' || chunkInfo.direction === 'down'
    ? chunkInfo.chunkHeight + chunkInfo.extensionSize
    : chunkInfo.originalHeight
}
