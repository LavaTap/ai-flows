/**
 * 离线「智能生成」模拟器。
 *
 * 参考项目通过 ComfyUI / 云端模型出图（CanvasComfyUISingle、CanvasSeedreamV5Pro 等）。
 * 本工程没有后端，这里用 Canvas 2D 程序化生成抽象图像，
 * 保持与真实生成管线一致的调用形态：prompt + style + 尺寸 -> 图片 dataURL。
 * 接入真实服务时，只需替换 `generateArtwork` 的实现。
 */

export interface ArtworkRequest {
  prompt: string
  style: string
  width: number
  height: number
  seed: number
}

const PALETTES: Record<string, string[]> = {
  赛博: ['#22d3ee', '#a855f7', '#f472b6', '#2563eb', '#0ea5e9'],
  国风: ['#c8b89a', '#5d8b7a', '#2f4858', '#d9c7a7', '#8aa79a'],
  水彩: ['#f9a8d4', '#a5b4fc', '#7dd3fc', '#fcd34d', '#bbf7d0'],
  胶片: ['#f97316', '#0d9488', '#fbbf24', '#b45309', '#155e75'],
  极简: ['#e5e7eb', '#94a3b8', '#7c8cff', '#1e293b', '#cbd5e1'],
}

const BACKGROUNDS: Record<string, string> = {
  赛博: '#070812',
  国风: '#171512',
  水彩: '#191a24',
  胶片: '#14100c',
  极简: '#101218',
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rand: () => number, list: T[]): T {
  return list[Math.floor(rand() * list.length) % list.length] as T
}

export function renderArtwork({ prompt, style, width, height, seed }: ArtworkRequest): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const colors = PALETTES[style] ?? PALETTES['极简']!
  const rand = mulberry32(hashString(`${prompt}|${style}|${seed}`))

  ctx.fillStyle = BACKGROUNDS[style] ?? '#0b0d14'
  ctx.fillRect(0, 0, width, height)

  // 大色块光晕
  const blobs = 5 + Math.floor(rand() * 4)
  for (let i = 0; i < blobs; i += 1) {
    const cx = rand() * width
    const cy = rand() * height
    const radius = (0.18 + rand() * 0.42) * Math.max(width, height)
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    const color = pick(rand, colors)
    gradient.addColorStop(0, `${color}b3`)
    gradient.addColorStop(1, `${color}00`)
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }

  // 弧形笔触
  ctx.globalCompositeOperation = 'screen'
  const strokes = 6 + Math.floor(rand() * 8)
  for (let i = 0; i < strokes; i += 1) {
    const cx = rand() * width
    const cy = rand() * height
    const radius = (0.1 + rand() * 0.6) * Math.max(width, height)
    const start = rand() * Math.PI * 2
    ctx.beginPath()
    ctx.strokeStyle = `${pick(rand, colors)}${Math.floor(40 + rand() * 90).toString(16)}`
    ctx.lineWidth = 1 + rand() * 3
    ctx.arc(cx, cy, radius, start, start + (0.3 + rand() * 1.6) * Math.PI)
    ctx.stroke()
  }

  // 细颗粒
  ctx.globalCompositeOperation = 'lighter'
  const grains = Math.floor((width * height) / 900)
  for (let i = 0; i < grains; i += 1) {
    ctx.fillStyle = `rgba(255,255,255,${(rand() * 0.06).toFixed(3)})`
    ctx.fillRect(rand() * width, rand() * height, 1, 1)
  }

  // 暗角
  ctx.globalCompositeOperation = 'source-over'
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.2,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.78,
  )
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)

  // 边缘细框，让画面更像一张作品
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1)

  // 生成图不透明，用 JPEG 控制体积，便于整块画布 JSON 持久化
  return canvas.toDataURL('image/jpeg', 0.88)
}
