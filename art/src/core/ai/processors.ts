/**
 * AI 工具页的本地处理器。
 *
 * 与 `mockGenerator.ts` 的差别：这里做的是**图生图**——输入一张源图，按各工具的参数
 * 用 Canvas 2D 做真实变换（放大 / 扩边 / 透视 / 抠图 / 切图 …），让工具页面在没有
 * 后端模型时也能跑通「上传 → 调参 → 出结果 → 存素材」的完整链路。
 * 接入真实 AI 服务时，只需替换 `PROCESSORS` 里对应的实现（或改为发起请求）。
 */

import { renderArtwork } from './mockGenerator'

/** 工作台里的源图：dataURL 或素材库地址 + 原始尺寸 */
export interface SourceImage {
  url: string
  name: string
  width: number
  height: number
}

/** 归一化区域（0~1，相对源图宽高），由工作区的选区编辑器给出 */
export interface RegionBox {
  x: number
  y: number
  w: number
  h: number
}

export interface ProcessInput {
  /** 源图 dataURL；纯生成类工具为 null */
  source: string | null
  /** 能力参数值，key 对应 capabilities.ts 的 field.key */
  values: Record<string, string | number>
  /** 涂抹遮罩 dataURL（黑底白笔），涂抹替换使用 */
  mask?: string | null
  /** 选区（局部细化使用） */
  region?: RegionBox | null
  /** 随机种子，保证同一组参数可复现 */
  seed: number
}

export interface ProcessOutput {
  /** 结果图 dataURL 列表；视频类返回的是帧序列 */
  images: string[]
  /** 结果区展示的补充信息，例如尺寸 */
  note: string
  /** frames=帧序列（结果区循环播放），image=普通图片 */
  kind: 'image' | 'frames'
}

export type Processor = (input: ProcessInput) => Promise<ProcessOutput>

/* ------------------------------------------------------------------ 工具函数 */

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('画布初始化失败')
  return [canvas, ctx]
}

let imageLoader: (src: string) => Promise<HTMLImageElement> = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片读取失败'))
    image.src = src
  })

export function loadImage(src: string): Promise<HTMLImageElement> {
  return imageLoader(src)
}

/** 仅供测试替换图片加载实现 */
export function setImageLoader(loader: (src: string) => Promise<HTMLImageElement>): void {
  imageLoader = loader
}

function num(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function str(value: unknown, fallback: string): string {
  return value === undefined || value === null || value === '' ? fallback : String(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function rand01(seed: number): () => number {
  let a = (seed >>> 0) || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 逐像素处理：回调直接改 data（RGBA 数组） */
function mapPixels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fn: (data: Uint8ClampedArray, index: number) => void,
): void {
  const frame = ctx.getImageData(0, 0, width, height)
  const data = frame.data
  for (let i = 0; i < data.length; i += 4) fn(data, i)
  ctx.putImageData(frame, 0, 0)
}

/** 3x3 卷积（锐化 / 模糊），alpha 通道不参与 */
function convolve(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  kernel: number[],
  divisor: number,
): void {
  const frame = ctx.getImageData(0, 0, width, height)
  const src = frame.data
  const out = new Uint8ClampedArray(src.length)
  const norm = divisor || 1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          const px = clamp(x + kx, 0, width - 1)
          const py = clamp(y + ky, 0, height - 1)
          const idx = (py * width + px) * 4
          const weight = kernel[(ky + 1) * 3 + (kx + 1)]!
          r += src[idx]! * weight
          g += src[idx + 1]! * weight
          b += src[idx + 2]! * weight
        }
      }
      const idx = (y * width + x) * 4
      out[idx] = r / norm
      out[idx + 1] = g / norm
      out[idx + 2] = b / norm
      out[idx + 3] = src[idx + 3]!
    }
  }
  frame.data.set(out)
  ctx.putImageData(frame, 0, 0)
}

const SHARPEN_KERNEL = [0, -1, 0, -1, 5, -1, 0, -1, 0]
const BLUR_KERNEL = [1, 1, 1, 1, 1, 1, 1, 1, 1]

function sharpen(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number): void {
  const times = clamp(Math.round(amount * 3), 0, 4)
  for (let i = 0; i < times; i += 1) convolve(ctx, w, h, SHARPEN_KERNEL, 1)
}

function blur(ctx: CanvasRenderingContext2D, w: number, h: number, times: number): void {
  for (let i = 0; i < times; i += 1) convolve(ctx, w, h, BLUR_KERNEL, 9)
}

/** 对比度 / 饱和度 / 亮度：amount 为 -1~1 的偏移量 */
function adjust(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opt: { contrast?: number; saturation?: number; brightness?: number },
): void {
  const contrast = opt.contrast ?? 0
  const saturation = opt.saturation ?? 0
  const brightness = opt.brightness ?? 0
  const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255))
  mapPixels(ctx, w, h, (data, i) => {
    const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
    for (let c = 0; c < 3; c += 1) {
      let value = factor * (data[i + c]! - 128) + 128
      value = lum + (value - lum) * (1 + saturation)
      data[i + c] = value + brightness * 255
    }
  })
}

function addGrain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, strength: number): void {
  if (strength <= 0) return
  const rand = rand01(seed)
  mapPixels(ctx, w, h, (data, i) => {
    const noise = (rand() - 0.5) * 255 * strength
    data[i] = data[i]! + noise
    data[i + 1] = data[i + 1]! + noise
    data[i + 2] = data[i + 2]! + noise
  })
}

function sizeNote(width: number, height: number): string {
  return `${Math.round(width)} × ${Math.round(height)}`
}

/* ------------------------------------------------------------- 各工具处理器 */

const RATIO_SIZE: Record<string, [number, number]> = {
  '16:9': [1024, 576],
  '1:1': [768, 768],
  '4:3': [1024, 768],
  '9:16': [576, 1024],
}

const DRAFT_STYLE: Record<string, string> = {
  japanese: '水彩',
  realistic: '胶片',
  chinese: '国风',
  scifi: '赛博',
}

/** 一键成稿：纯生成，不需要源图 */
const processDraft: Processor = async ({ values, seed }) => {
  const ratio = str(values.ratio, '1:1')
  const style = str(values.style, 'japanese')
  const prompt = str(values.prompt, '一键成稿') || '一键成稿'
  const [width, height] = RATIO_SIZE[ratio] ?? RATIO_SIZE['1:1']!
  const image = renderArtwork({
    prompt: `${prompt}|${style}`,
    style: DRAFT_STYLE[style] ?? '极简',
    width,
    height,
    seed,
  })
  return { images: [image], note: sizeNote(width, height), kind: 'image' }
}

/** 万能渲染：按精致度做锐化与色彩还原 */
const processRender: Processor = async ({ source, values }) => {
  const image = await loadImage(source!)
  const [canvas, ctx] = createCanvas(image.width, image.height)
  ctx.drawImage(image, 0, 0)
  const fidelity = clamp(num(values.fidelity, 3), 1, 5)
  const model = str(values.model, 'standard')
  const speedup = model === 'fast' ? 0.6 : model === 'detailed' ? 1.25 : 1
  sharpen(ctx, canvas.width, canvas.height, (fidelity / 5) * speedup)
  adjust(ctx, canvas.width, canvas.height, {
    contrast: 0.06 * (fidelity / 5) * speedup,
    saturation: 0.1 * (fidelity / 5),
  })
  return {
    images: [canvas.toDataURL('image/jpeg', 0.92)],
    note: sizeNote(canvas.width, canvas.height),
    kind: 'image',
  }
}

/** 丰富细节：细节权重决定锐化，重绘幅度决定整体强度 */
const processStyleAdjust: Processor = async ({ source, values }) => {
  const image = await loadImage(source!)
  const [canvas, ctx] = createCanvas(image.width, image.height)
  ctx.drawImage(image, 0, 0)
  const detail = clamp(num(values.detail, 3), 1, 5)
  const strength = clamp(num(values.strength, 40), 0, 100) / 100
  if (detail >= 3) {
    sharpen(ctx, canvas.width, canvas.height, ((detail - 2) / 3) * (0.4 + strength * 0.6))
  } else {
    blur(ctx, canvas.width, canvas.height, 3 - detail > 0 ? 1 : 0)
  }
  adjust(ctx, canvas.width, canvas.height, {
    contrast: (detail - 3) * 0.03 * (0.5 + strength),
    saturation: 0.08 * strength,
  })
  return {
    images: [canvas.toDataURL('image/jpeg', 0.92)],
    note: sizeNote(canvas.width, canvas.height),
    kind: 'image',
  }
}

/** 一键抠图：以四周边缘取样色为基准做色差抠图，再按背景合成 */
const processMatting: Processor = async ({ source, values }) => {
  const image = await loadImage(source!)
  const [canvas, ctx] = createCanvas(image.width, image.height)
  ctx.drawImage(image, 0, 0)
  const w = canvas.width
  const h = canvas.height
  const frame = ctx.getImageData(0, 0, w, h)
  const data = frame.data

  // 沿四边取样求背景基准色
  const samples: [number, number, number][] = []
  const step = Math.max(1, Math.floor(Math.min(w, h) / 40))
  const push = (x: number, y: number): void => {
    const i = (y * w + x) * 4
    samples.push([data[i]!, data[i + 1]!, data[i + 2]!])
  }
  for (let x = 0; x < w; x += step) {
    push(x, 0)
    push(x, h - 1)
  }
  for (let y = 0; y < h; y += step) {
    push(0, y)
    push(w - 1, y)
  }
  const base = samples
    .reduce<[number, number, number]>((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]], [0, 0, 0])
    .map((v) => v / Math.max(1, samples.length)) as [number, number, number]

  const subject = str(values.subject, 'auto')
  const tolerance = subject === 'product' ? 46 : subject === 'person' ? 34 : 40
  const feather = clamp(num(values.feather, 2), 0, 10) * 3 + 6

  for (let i = 0; i < data.length; i += 4) {
    const distance = Math.sqrt(
      (data[i]! - base[0]) ** 2 + (data[i + 1]! - base[1]) ** 2 + (data[i + 2]! - base[2]) ** 2,
    )
    const alpha = distance <= tolerance ? 0 : clamp((distance - tolerance) / feather, 0, 1)
    data[i + 3] = Math.round(alpha * 255)
  }
  ctx.putImageData(frame, 0, 0)

  // 背景合成：透明 / 白底 / 黑底
  const background = str(values.background, '透明')
  const [out, outCtx] = createCanvas(w, h)
  if (background === '白底' || background === '黑底') {
    outCtx.fillStyle = background === '白底' ? '#ffffff' : '#000000'
    outCtx.fillRect(0, 0, w, h)
  } else {
    // 透明底用棋盘格预览，避免看不出抠图效果
    const cell = Math.max(8, Math.round(Math.min(w, h) / 24))
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        outCtx.fillStyle = ((x / cell + y / cell) | 0) % 2 ? '#1b1f2b' : '#232838'
        outCtx.fillRect(x, y, cell, cell)
      }
    }
  }
  outCtx.drawImage(canvas, 0, 0)
  return {
    images: [out.toDataURL(background === '透明' ? 'image/png' : 'image/jpeg', 0.92)],
    note: sizeNote(w, h),
    kind: 'image',
  }
}

/** 超清放大：倍数 + 无损 / 重绘模式 */
const processZoom: Processor = async ({ source, values }) => {
  const image = await loadImage(source!)
  const scale = clamp(num(values.scale, 2), 1, 8)
  const w = Math.round(image.width * scale)
  const h = Math.round(image.height * scale)
  const [canvas, ctx] = createCanvas(w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, w, h)
  const mode = str(values.mode, 'lossless')
  if (mode === 'repaint') {
    sharpen(ctx, w, h, 0.8)
    adjust(ctx, w, h, { contrast: 0.05, saturation: 0.06 })
  }
  if (str(values.denoise, '开') === '开') blur(ctx, w, h, 1)
  return {
    images: [canvas.toDataURL('image/jpeg', 0.94)],
    note: `${sizeNote(w, h)} · ${scale}x`,
    kind: 'image',
  }
}

/** 相似图裂变：按相似度做色彩与构图扰动，一次出多张 */
const processFission: Processor = async ({ source, values, seed }) => {
  const image = await loadImage(source!)
  const count = clamp(num(values.count, 4), 1, 12)
  const similarity = clamp(num(values.similarity, 70), 0, 100)
  const drift = (100 - similarity) / 100
  const images: string[] = []
  for (let i = 0; i < count; i += 1) {
    const rand = rand01(seed + i * 7919)
    const [canvas, ctx] = createCanvas(image.width, image.height)
    // 轻微缩放裁剪，制造构图差异
    const zoom = 1 + (rand() - 0.5) * 0.12 * drift
    const dw = image.width * zoom
    const dh = image.height * zoom
    ctx.drawImage(image, (image.width - dw) / 2, (image.height - dh) / 2, dw, dh)
    adjust(ctx, canvas.width, canvas.height, {
      contrast: (rand() - 0.5) * 0.3 * drift,
      saturation: (rand() - 0.5) * 0.5 * drift,
      brightness: (rand() - 0.5) * 0.16 * drift,
    })
    addGrain(ctx, canvas.width, canvas.height, seed + i, 0.05 * drift)
    images.push(canvas.toDataURL('image/jpeg', 0.9))
  }
  return { images, note: `${count} 张变体`, kind: 'image' }
}

/** 智能扩图：沿指定方向延展画布，延展区用模糊拉伸与渐变融合补全 */
const processExpansion: Processor = async ({ source, values }) => {
  const image = await loadImage(source!)
  const ratio = clamp(num(values.ratio, 25), 5, 200) / 100
  const direction = str(values.direction, '右')
  const horizontal = direction === '左' || direction === '右'
  const grow = Math.round((horizontal ? image.width : image.height) * ratio)
  const nw = horizontal ? image.width + grow : image.width
  const nh = horizontal ? image.height : image.height + grow

  const [canvas, ctx] = createCanvas(nw, nh)
  const offsetX = direction === '左' ? grow : 0
  const offsetY = direction === '上' ? grow : 0

  // 1) 底层：整图拉伸铺满后模糊，作为延展区的补全内容
  ctx.filter = `blur(${Math.max(4, Math.round(grow / 6))}px)`
  ctx.drawImage(image, 0, 0, nw, nh)
  ctx.filter = 'none'

  // 2) 原图贴回，压住非延展区
  ctx.drawImage(image, offsetX, offsetY, image.width, image.height)

  // 3) 接缝处做一次渐变融合，避免硬边
  const blend = clamp(num(values.blend, 60), 0, 100) / 100
  const fade = Math.round(Math.min(grow, Math.max(12, grow * 0.35)) * (0.4 + blend * 0.6))
  const gradient = ctx.createLinearGradient(
    direction === '右' ? offsetX + image.width - fade : offsetX,
    direction === '下' ? offsetY + image.height - fade : offsetY,
    direction === '左' ? offsetX + fade : offsetX + image.width,
    direction === '上' ? offsetY + fade : offsetY + image.height,
  )
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, `rgba(0,0,0,${(0.25 * blend).toFixed(3)})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, nw, nh)

  return {
    images: [canvas.toDataURL('image/jpeg', 0.92)],
    note: sizeNote(nw, nh),
    kind: 'image',
  }
}

/** 自由视角：逐列 / 逐行梯形变换，近似水平与俯仰视角 */
const processFreePerspective: Processor = async ({ source, values }) => {
  const image = await loadImage(source!)
  const hAngle = clamp(num(values.horizontal, 0), -60, 60)
  const vAngle = clamp(num(values.vertical, 0), -30, 30)

  const w = image.width
  const h = image.height
  // 水平：左右两侧高度比不同
  const kH = Math.tan((hAngle * Math.PI) / 180) * 0.5
  const [stage, stageCtx] = createCanvas(w, h)
  for (let x = 0; x < w; x += 1) {
    const t = w === 1 ? 0 : x / (w - 1)
    const scale = 1 + kH * (t - 0.5) * 2
    const dh = h * scale
    stageCtx.drawImage(image, x, 0, 1, h, x, (h - dh) / 2, 1, dh)
  }

  // 垂直：上下两侧宽度比不同
  const kV = Math.tan((vAngle * Math.PI) / 180) * 0.5
  const [out, outCtx] = createCanvas(w, h)
  for (let y = 0; y < h; y += 1) {
    const t = h === 1 ? 0 : y / (h - 1)
    const scale = 1 + kV * (t - 0.5) * 2
    const dw = w * scale
    outCtx.drawImage(stage, 0, y, w, 1, (w - dw) / 2, y, dw, 1)
  }

  // 视角变换后空白处补一点暗角，减少拉伸感
  const vignette = outCtx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.35)')
  outCtx.fillStyle = vignette
  outCtx.fillRect(0, 0, w, h)

  return {
    images: [out.toDataURL('image/jpeg', 0.92)],
    note: `${sizeNote(w, h)} · H${hAngle}° / V${vAngle}°`,
    kind: 'image',
  }
}

/** 涂抹替换：遮罩白色区域按 prompt 生成色块替换，边缘羽化融合 */
const processReplace: Processor = async ({ source, values, mask, seed }) => {
  const image = await loadImage(source!)
  const [canvas, ctx] = createCanvas(image.width, image.height)
  ctx.drawImage(image, 0, 0)

  const prompt = str(values.prompt, '') || 'replace'
  const rand = rand01(seed)
  const hue = Math.floor(rand() * 360)
  const hue2 = (hue + 40 + Math.floor(rand() * 80)) % 360

  // 替换内容：按描述生成的双色渐变（接入模型后替换为真实重绘结果）
  const [fill, fillCtx] = createCanvas(image.width, image.height)
  const gradient = fillCtx.createLinearGradient(0, 0, image.width, image.height)
  gradient.addColorStop(0, `hsl(${hue} 62% 46%)`)
  gradient.addColorStop(1, `hsl(${hue2} 58% 32%)`)
  fillCtx.fillStyle = gradient
  fillCtx.fillRect(0, 0, image.width, image.height)
  addGrain(fillCtx, image.width, image.height, seed + 11, 0.06)

  if (mask) {
    const maskImage = await loadImage(mask)
    const [maskCanvas, maskCtx] = createCanvas(image.width, image.height)
    maskCtx.drawImage(maskImage, 0, 0, image.width, image.height)
    // 遮罩边缘羽化，避免替换痕迹过硬
    blur(maskCanvas.getContext('2d')!, image.width, image.height, 2)
    const maskFrame = maskCtx.getImageData(0, 0, image.width, image.height)
    const fillFrame = fillCtx.getImageData(0, 0, image.width, image.height)
    const baseFrame = ctx.getImageData(0, 0, image.width, image.height)
    for (let i = 0; i < baseFrame.data.length; i += 4) {
      const alpha = maskFrame.data[i]! / 255
      if (alpha <= 0) continue
      for (let c = 0; c < 3; c += 1) {
        baseFrame.data[i + c] = baseFrame.data[i + c]! * (1 - alpha) + fillFrame.data[i + c]! * alpha
      }
    }
    ctx.putImageData(baseFrame, 0, 0)
  } else {
    ctx.globalAlpha = 0.85
    ctx.drawImage(fill, 0, 0)
    ctx.globalAlpha = 1
  }

  return {
    images: [canvas.toDataURL('image/jpeg', 0.92)],
    note: sizeNote(canvas.width, canvas.height),
    kind: 'image',
  }
}

/** 局部细化：只重绘选区，做锐化与降噪 */
const processRefine: Processor = async ({ source, values, region }) => {
  const image = await loadImage(source!)
  const [canvas, ctx] = createCanvas(image.width, image.height)
  ctx.drawImage(image, 0, 0)
  const strength = clamp(num(values.strength, 3), 1, 5)
  const box = region ?? { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
  const x = Math.round(box.x * image.width)
  const y = Math.round(box.y * image.height)
  const w = Math.max(1, Math.round(box.w * image.width))
  const h = Math.max(1, Math.round(box.h * image.height))

  const frame = ctx.getImageData(x, y, w, h)
  const [patch, patchCtx] = createCanvas(w, h)
  patchCtx.putImageData(frame, 0, 0)
  sharpen(patchCtx, w, h, strength / 5)
  adjust(patchCtx, w, h, { contrast: 0.04 * strength, saturation: 0.05 })
  addGrain(patchCtx, w, h, Math.round(x + y + w), 0.02)
  ctx.drawImage(patch, x, y)

  return {
    images: [canvas.toDataURL('image/jpeg', 0.92)],
    note: `${sizeNote(w, h)} 选区`,
    kind: 'image',
  }
}

/** 图生视频：按运镜生成一段帧序列（结果区循环播放） */
const processVideo: Processor = async ({ source, values }) => {
  const image = await loadImage(source!)
  const duration = clamp(num(values.duration, 5), 1, 20)
  const camera = str(values.camera, 'push')
  const total = Math.max(8, Math.round(duration * 8))
  // 预览帧降采样，避免一整段视频的 dataURL 占满内存
  const ratio = Math.min(1, Math.max(0.6, 480 / Math.max(1, image.width)))
  const fw = Math.round(image.width * ratio)
  const fh = Math.round(image.height * ratio)
  const images: string[] = []
  for (let i = 0; i < total; i += 1) {
    const t = total === 1 ? 0 : i / (total - 1)
    const [canvas, ctx] = createCanvas(fw, fh)
    ctx.fillStyle = '#05070c'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const scale =
      camera === 'push'
        ? 1 + t * 0.28
        : camera === 'pull'
          ? 1.28 - t * 0.28
          : camera === 'orbit'
            ? 1 + Math.sin(t * Math.PI * 2) * 0.12
            : 1
    const dw = fw * scale
    const dh = fh * scale
    const dx =
      camera === 'orbit' ? (fw - dw) / 2 + Math.sin(t * Math.PI * 2) * fw * 0.06 : (fw - dw) / 2
    const dy = (fh - dh) / 2
    ctx.globalAlpha = camera === 'static' ? 1 : 0.65 + 0.35 * Math.sin(t * Math.PI)
    ctx.drawImage(image, dx, dy, dw, dh)
    ctx.globalAlpha = 1
    images.push(canvas.toDataURL('image/jpeg', 0.72))
  }
  return { images, note: `${total} 帧 · ${duration}s · ${camera}`, kind: 'frames' }
}

/** 游戏 UI 切图：按数量切网格，输出多张素材 */
const processGameUiSplitter: Processor = async ({ source, values }) => {
  const image = await loadImage(source!)
  const count = clamp(num(values.count, 8), 1, 64)
  const format = str(values.format, 'png')
  const mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const cw = Math.floor(image.width / cols)
  const ch = Math.floor(image.height / rows)
  const images: string[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (images.length >= count) break
      const [canvas, ctx] = createCanvas(cw, ch)
      ctx.drawImage(image, col * cw, row * ch, cw, ch, 0, 0, cw, ch)
      images.push(canvas.toDataURL(mime, 0.94))
    }
  }
  return { images, note: `${images.length} 张 · ${Math.round(cw)} × ${Math.round(ch)}`, kind: 'image' }
}

/** 能力 key → 处理器 */
const PROCESSORS: Record<string, Processor> = {
  draft: processDraft,
  render: processRender,
  'style-adjust': processStyleAdjust,
  matting: processMatting,
  zoom: processZoom,
  fission: processFission,
  expansion: processExpansion,
  'free-perspective': processFreePerspective,
  replace: processReplace,
  refine: processRefine,
  video: processVideo,
  'game-ui-splitter': processGameUiSplitter,
}

/** 该工具是否需要源图 */
export function needsSource(key: string): boolean {
  return key !== 'draft'
}

/** 该工具是否需要在源图上画遮罩（涂抹） */
export function needsMask(key: string): boolean {
  return key === 'replace'
}

/** 该工具是否需要在源图上框选区域 */
export function needsRegion(key: string): boolean {
  return key === 'refine'
}

export function runProcessor(key: string, input: ProcessInput): Promise<ProcessOutput> {
  const processor = PROCESSORS[key]
  if (!processor) return Promise.reject(new Error(`未实现的 AI 能力：${key}`))
  return processor(input)
}
