import {
  ActiveSelection,
  Canvas,
  Ellipse,
  FabricImage,
  FabricObject,
  Group,
  IText,
  Line,
  PencilBrush,
  Point,
  Rect,
  Triangle,
} from 'fabric'
import { customAlphabet } from 'nanoid'
import type {
  AiToolCard,
  ArtboardSize,
  EngineSnapshot,
  LayerInfo,
  LayerKind,
  SelectionInfo,
  ShapeStyle,
  ToolName,
} from '@/types/board'
import { DEFAULT_STYLE } from '@/types/board'

type MetaObject = FabricObject & {
  id?: string
  name?: string
  locked?: boolean
  artboard?: boolean
}

export interface ViewportState {
  zoom: number
  offsetX: number
  offsetY: number
  panning: boolean
  spacePressed: boolean
}

interface ContentBounds {
  left: number
  top: number
  width: number
  height: number
}

const CUSTOM_PROPS = ['id', 'name', 'locked', 'artboard']
const createObjectId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const GRID_SIZE = 24
const CONTENT_EXPORT_PADDING = 48
const ARTBOARD_FOCUS_PADDING = 32
const MAX_EXPORT_PIXELS = 16_000_000
const EXPORT_BACKGROUND = '#0b0d14'

const ARTBOARD_FILL = 'rgba(255, 255, 255, 0.015)'
const ARTBOARD_STROKE = 'rgba(124, 140, 255, 0.5)'

const KIND_LABELS: Record<LayerKind, string> = {
  text: '文字',
  image: '图片',
  shape: '图形',
  path: '画笔',
  group: '组合',
  other: '对象',
}

const DRAW_LABELS: Partial<Record<ToolName, string>> = {
  rect: '矩形',
  ellipse: '椭圆',
  line: '直线',
  arrow: '箭头',
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function meta(object: FabricObject): MetaObject {
  return object as MetaObject
}

/** 是否为画板区域的装饰对象（不属于用户内容） */
function isArtboardObject(object: unknown): boolean {
  if (!object || typeof object !== 'object') return false
  return (object as { artboard?: unknown }).artboard === true
}

/** 序列化数据里的对象是否带画板标记（兼容早期误存进 JSON 的画板矩形） */
function isArtboardJson(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return (value as { artboard?: unknown }).artboard === true
}

/** 规整画板尺寸：非法值一律按「无限画布」处理 */
function normalizeArtboard(value: unknown): ArtboardSize | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { width?: unknown; height?: unknown }
  const width = Number(candidate.width)
  const height = Number(candidate.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width < 16 || height < 16) return null
  return { width: Math.min(20000, Math.round(width)), height: Math.min(20000, Math.round(height)) }
}

/** 规整画布内 AI 工具面板数据：字段不全的条目直接丢弃 */
function normalizeAiTools(value: unknown): AiToolCard[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Partial<AiToolCard>
    const x = Number(candidate.x)
    const y = Number(candidate.y)
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.capability !== 'string' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return []
    }
    const values: Record<string, string | number> = {}
    const raw = candidate.values
    if (raw && typeof raw === 'object') {
      Object.entries(raw as Record<string, unknown>).forEach(([key, entry]) => {
        if (typeof entry === 'string' || typeof entry === 'number') values[key] = entry
      })
    }
    return [{ id: candidate.id, capability: candidate.capability, x, y, values }]
  })
}

function kindOf(object: FabricObject): LayerKind {
  switch (object.type) {
    case 'i-text':
    case 'text':
    case 'textbox':
      return 'text'
    case 'image':
      return 'image'
    case 'path':
      return 'path'
    case 'group':
    case 'activeselection':
      return 'group'
    case 'rect':
    case 'ellipse':
    case 'circle':
    case 'triangle':
    case 'line':
    case 'polygon':
    case 'polyline':
      return 'shape'
    default:
      return 'other'
  }
}

function typeLabelOf(object: FabricObject): string {
  switch (object.type) {
    case 'i-text':
    case 'text':
    case 'textbox':
      return '文字'
    case 'image':
      return '图片'
    case 'path':
      return '画笔'
    case 'rect':
      return '矩形'
    case 'ellipse':
    case 'circle':
      return '椭圆'
    case 'line':
      return '直线'
    case 'triangle':
      return '三角'
    case 'group':
      return '组合'
    case 'activeselection':
      return '多选'
    default:
      return '对象'
  }
}

function clientPoint(event: Event): { x: number; y: number } {
  if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY }
  const touch = (event as TouchEvent).touches?.[0] ?? (event as TouchEvent).changedTouches?.[0]
  return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 }
}

/** 序列化前确保自定义属性随对象一起保存 */
FabricObject.customProperties = CUSTOM_PROPS

export interface CanvasEngineOptions {
  style?: ShapeStyle
  onChange?: (snapshot: EngineSnapshot) => void
}

export interface ExportPngOptions {
  /** 导出倍率，缺省 2（超大画布会自动降档） */
  multiplier?: number
  /** 深色底或透明底，缺省深色 */
  background?: 'dark' | 'transparent'
  /** 导出内容区域或画板区域，缺省内容区域 */
  region?: 'content' | 'artboard'
}

/**
 * 无限画布引擎：视口（缩放/平移）、图形绘制、图层、历史记录与导出。
 * UI 层只依赖本类的公开方法，不直接操作 fabric。
 */
export class CanvasEngine {
  readonly canvas: Canvas
  readonly gridSize = GRID_SIZE

  private readonly host: HTMLElement
  private readonly resizeObserver: ResizeObserver
  private style: ShapeStyle
  private tool: ToolName = 'select'
  private artboard: ArtboardSize | null = null

  private readonly stateListeners = new Set<(snapshot: EngineSnapshot) => void>()
  private readonly viewportListeners = new Set<(viewport: ViewportState) => void>()
  private readonly contentListeners = new Set<() => void>()
  /** 画布内 AI 工具面板，仅随画板 JSON 存读，不参与 fabric 渲染 */
  private aiTools: AiToolCard[] = []
  private counters: Record<string, number> = {}

  private history: string[] = []
  private historyIndex = -1
  private quiet = false
  private ready = false
  private commitTimer: number | undefined

  private spacePressed = false
  private panning = false
  private panStart = { x: 0, y: 0 }
  private panOrigin = { x: 0, y: 0 }
  private drawing = false
  private drawOrigin: Point | null = null
  private drawTool: ToolName | null = null
  private draft: FabricObject | null = null
  private erasing = false
  private lastErasePoint: Point | null = null

  constructor(host: HTMLElement, canvasElement: HTMLCanvasElement, options: CanvasEngineOptions = {}) {
    this.host = host
    this.style = { ...DEFAULT_STYLE, ...(options.style ?? {}) }

    const width = Math.max(host.clientWidth, 1)
    const height = Math.max(host.clientHeight, 1)

    this.canvas = new Canvas(canvasElement, {
      width,
      height,
      backgroundColor: 'transparent',
      preserveObjectStacking: true,
      selection: true,
      selectionColor: 'rgba(124, 140, 255, 0.10)',
      selectionBorderColor: '#7c8cff',
      selectionLineWidth: 1,
      stopContextMenu: true,
      fireRightClick: false,
      controlsAboveOverlay: true,
    })

    this.canvas.setDimensions({ width, height }, { cssOnly: false })

    if (options.onChange) this.stateListeners.add(options.onChange)

    this.bindEvents()
    this.applyBrush()

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(host)

    this.ready = true
    this.resetHistory()
    this.emitViewport()
  }

  /* ------------------------------------------------------------- 订阅 */

  subscribe(listener: (snapshot: EngineSnapshot) => void): () => void {
    this.stateListeners.add(listener)
    listener(this.snapshot())
    return () => this.stateListeners.delete(listener)
  }

  onViewport(listener: (viewport: ViewportState) => void): () => void {
    this.viewportListeners.add(listener)
    listener(this.viewport())
    return () => this.viewportListeners.delete(listener)
  }

  /** 仅在画布内容真正提交（新增/修改/删除/撤销）时触发 */
  onContentChange(listener: () => void): () => void {
    this.contentListeners.add(listener)
    return () => this.contentListeners.delete(listener)
  }

  /* ------------------------------------------------------------- AI 工具面板 */

  getAiTools(): AiToolCard[] {
    return this.aiTools.map((card) => ({ ...card, values: { ...card.values } }))
  }

  setAiTools(cards: AiToolCard[]): void {
    this.aiTools = cards.map((card) => ({ ...card, values: { ...card.values } }))
  }

  /* ------------------------------------------------------------- 查询 */

  snapshot(): EngineSnapshot {
    const viewport = this.viewport()
    const selected = this.selectedObjects()
    return {
      tool: this.tool,
      zoom: viewport.zoom,
      offsetX: viewport.offsetX,
      offsetY: viewport.offsetY,
      layers: this.layers(),
      selectedIds: selected.map((object) => meta(object).id ?? '').filter(Boolean),
      selection: this.selectionInfo(selected[0]),
      objectCount: this.contentObjects().length,
      artboard: this.artboard ? { ...this.artboard } : null,
      canUndo: this.historyIndex > 0,
      canRedo: this.historyIndex < this.history.length - 1,
    }
  }

  viewport(): ViewportState {
    const vpt = this.canvas.viewportTransform
    return {
      zoom: this.canvas.getZoom(),
      offsetX: vpt[4],
      offsetY: vpt[5],
      panning: this.panning,
      spacePressed: this.spacePressed,
    }
  }

  layers(): LayerInfo[] {
    return [...this.contentObjects()].reverse().map((object) => {
      const kind = kindOf(object)
      return {
        id: meta(object).id ?? '',
        name: meta(object).name ?? typeLabelOf(object),
        kind,
        typeLabel: typeLabelOf(object),
        visible: object.visible !== false,
        locked: meta(object).locked === true,
      }
    })
  }

  /** 用户内容对象（排除画板区域的装饰矩形） */
  private contentObjects(): FabricObject[] {
    return this.canvas.getObjects().filter((object) => !isArtboardObject(object))
  }

  getStyle(): ShapeStyle {
    return { ...this.style }
  }

  /* ------------------------------------------------------------- 画板区域 */

  getArtboard(): ArtboardSize | null {
    return this.artboard ? { ...this.artboard } : null
  }

  /** 设置画板尺寸；传 null 回到无限画布 */
  setArtboard(size: ArtboardSize | null): void {
    this.artboard = size ? normalizeArtboard(size) : null
    this.syncArtboardRect()
    if (this.artboard) this.focusArtboard()
    this.canvas.requestRenderAll()
    this.commitNow()
    this.emitState()
  }

  /** 把视口适配到画板区域；没有画板时回退适应内容 */
  fitArtboard(padding = 64): void {
    const artboard = this.artboard
    if (!artboard) {
      this.fitContent()
      return
    }
    const width = this.canvas.getWidth()
    const height = this.canvas.getHeight()
    const zoom = clamp(
      Math.min((width - padding * 2) / artboard.width, (height - padding * 2) / artboard.height),
      MIN_ZOOM,
      1.5,
    )
    const offsetX = width / 2 - (artboard.width / 2) * zoom
    const offsetY = height / 2 - (artboard.height / 2) * zoom
    this.canvas.setViewportTransform([zoom, 0, 0, zoom, offsetX, offsetY])
    this.canvas.requestRenderAll()
    this.emitViewport()
  }

  private selectedObjects(): FabricObject[] {
    const objects = this.canvas.getActiveObjects()
    return objects.filter((object) => !meta(object).locked)
  }

  /** 把视口移到画板左上角附近 */
  private focusArtboard(): void {
    const zoom = clamp(this.canvas.getZoom(), MIN_ZOOM, MAX_ZOOM)
    this.canvas.setViewportTransform([
      zoom,
      0,
      0,
      zoom,
      ARTBOARD_FOCUS_PADDING,
      ARTBOARD_FOCUS_PADDING,
    ])
    this.canvas.requestRenderAll()
    this.emitViewport()
  }

  /** 让画板矩形与当前尺寸保持一致（先清旧的再垫到最底层） */
  private syncArtboardRect(): void {
    const previousQuiet = this.quiet
    this.quiet = true
    this.canvas
      .getObjects()
      .filter((object) => isArtboardObject(object))
      .forEach((object) => this.canvas.remove(object))

    if (this.artboard) {
      const rect = this.createArtboardRect(this.artboard)
      this.canvas.add(rect)
      this.ensureArtboardBack()
    }

    this.quiet = previousQuiet
    this.canvas.requestRenderAll()
  }

  /** 画板矩形始终压在最底层，避免图层下移/下沉时跑到画板下面 */
  private ensureArtboardBack(): void {
    const objects = this.canvas.getObjects()
    const rect = objects.find((object) => isArtboardObject(object))
    if (rect && objects[0] !== rect) void this.canvas.sendObjectToBack(rect)
  }

  /** 画板矩形：虚线描边 + 极淡填充，不可选中/不可擦除，也不参与导出与序列化 */
  private createArtboardRect(size: ArtboardSize): Rect {
    const rect = new Rect({
      left: 0,
      top: 0,
      width: size.width,
      height: size.height,
      originX: 'left',
      originY: 'top',
      fill: ARTBOARD_FILL,
      stroke: ARTBOARD_STROKE,
      strokeWidth: 1.5,
      strokeDashArray: [8, 6],
      strokeUniform: true,
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
    })
    const tagged = meta(rect)
    tagged.artboard = true
    tagged.locked = true
    rect.setCoords()
    return rect
  }

  private selectionInfo(object: FabricObject | undefined): SelectionInfo | null {
    if (!object) return null
    const fill = typeof object.fill === 'string' ? object.fill : this.style.fill
    const stroke = typeof object.stroke === 'string' ? object.stroke : this.style.stroke
    const isText = kindOf(object) === 'text'
    return {
      kind: kindOf(object),
      typeLabel: meta(object).name ?? typeLabelOf(object),
      style: {
        fill,
        stroke,
        strokeWidth: object.strokeWidth ?? this.style.strokeWidth,
        opacity: object.opacity ?? 1,
        fontSize: object instanceof IText ? object.fontSize : this.style.fontSize,
      },
    }
  }

  /* ------------------------------------------------------------- 工具 */

  getTool(): ToolName {
    return this.tool
  }

  setTool(tool: ToolName): void {
    if (this.tool === tool) return

    if (this.canvas.getActiveObjects().some((object) => object instanceof IText && object.isEditing)) {
      this.canvas.getObjects().forEach((object) => {
        if (object instanceof IText && object.isEditing) object.exitEditing()
      })
    }

    this.tool = tool
    this.canvas.isDrawingMode = tool === 'pen'
    this.canvas.selection = tool === 'select'
    this.canvas.skipTargetFind = tool !== 'select'
    this.canvas.defaultCursor = tool === 'hand' ? 'grab' : tool === 'text' ? 'text' : 'default'

    if (tool === 'pen') {
      this.applyBrush()
    }
    if (tool !== 'select') {
      this.canvas.discardActiveObject()
      this.canvas.requestRenderAll()
    }

    this.emitState()
    this.emitViewport()
  }

  setSpacePressed(pressed: boolean): void {
    if (this.spacePressed === pressed) return
    this.spacePressed = pressed
    if (!pressed) this.endPan()
    this.emitViewport()
  }

  /* ------------------------------------------------------------- 视口 */

  handleWheel(event: WheelEvent): void {
    event.preventDefault()
    const rect = this.host.getBoundingClientRect()
    const anchor = new Point(event.clientX - rect.left, event.clientY - rect.top)
    const sensitivity = event.ctrlKey ? 0.01 : 0.0012
    const factor = Math.exp(-event.deltaY * sensitivity)
    this.zoomToPoint(anchor, this.canvas.getZoom() * factor)
  }

  zoomIn(): void {
    this.zoomToPoint(this.viewportCenter(), this.canvas.getZoom() * 1.2)
  }

  zoomOut(): void {
    this.zoomToPoint(this.viewportCenter(), this.canvas.getZoom() / 1.2)
  }

  setZoom(zoom: number): void {
    this.zoomToPoint(this.viewportCenter(), zoom)
  }

  resetView(): void {
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    this.canvas.requestRenderAll()
    this.emitViewport()
  }

  fitContent(padding = 80): void {
    const bounds = this.contentBounds()
    if (!bounds) {
      this.resetView()
      return
    }
    const width = this.canvas.getWidth()
    const height = this.canvas.getHeight()
    const zoom = clamp(
      Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height),
      MIN_ZOOM,
      1.5,
    )
    const offsetX = width / 2 - (bounds.left + bounds.width / 2) * zoom
    const offsetY = height / 2 - (bounds.top + bounds.height / 2) * zoom
    this.canvas.setViewportTransform([zoom, 0, 0, zoom, offsetX, offsetY])
    this.canvas.requestRenderAll()
    this.emitViewport()
  }

  private zoomToPoint(anchor: Point, zoom: number): void {
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
    if (Math.abs(next - this.canvas.getZoom()) < 0.0001) return
    this.canvas.zoomToPoint(anchor, next)
    this.canvas.requestRenderAll()
    this.emitViewport()
  }

  private viewportCenter(): Point {
    return new Point(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2)
  }

  private sceneCenter(): Point {
    const vpt = this.canvas.viewportTransform
    const zoom = this.canvas.getZoom()
    return new Point(
      (this.canvas.getWidth() / 2 - vpt[4]) / zoom,
      (this.canvas.getHeight() / 2 - vpt[5]) / zoom,
    )
  }

  private clientToScene(clientX: number, clientY: number): Point {
    const rect = this.host.getBoundingClientRect()
    const vpt = this.canvas.viewportTransform
    const zoom = this.canvas.getZoom()
    return new Point(
      (clientX - rect.left - vpt[4]) / zoom,
      (clientY - rect.top - vpt[5]) / zoom,
    )
  }

  /** 屏幕坐标 → 场景坐标（UI 层做右键菜单定位用） */
  sceneFromClient(clientX: number, clientY: number): { x: number; y: number } {
    const point = this.clientToScene(clientX, clientY)
    return { x: point.x, y: point.y }
  }

  /* ------------------------------------------------------------- 绘制 */

  addText(at?: Point): void {
    const point = at ?? this.sceneCenter()
    const text = new IText('双击编辑文字', {
      left: point.x,
      top: point.y,
      originX: 'center',
      originY: 'center',
      fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: this.style.fontSize,
      fill: this.style.fill,
      opacity: this.style.opacity,
    })
    this.decorate(text, 'text')
    this.canvas.add(text)
    this.setTool('select')
    this.canvas.setActiveObject(text)
    text.enterEditing()
    text.selectAll()
    this.canvas.requestRenderAll()
    this.commitNow()
  }

  /** 按图片地址插入（素材已存在平台 db/art-assets/，画布只引用其 URL） */
  async addImageUrl(url: string, clientX?: number, clientY?: number): Promise<void> {
    const point =
      clientX !== undefined && clientY !== undefined
        ? this.clientToScene(clientX, clientY)
        : undefined
    await this.addImageDataUrl(url, point)
  }

  async addImageDataUrl(url: string, at?: Point): Promise<void> {
    const image = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
    const sourceWidth = image.width || 1
    const sourceHeight = image.height || 1
    const scale = Math.min(1, 520 / Math.max(sourceWidth, sourceHeight))
    image.scale(scale)

    const point = at ?? this.sceneCenter()
    image.set({
      left: point.x - (sourceWidth * scale) / 2,
      top: point.y - (sourceHeight * scale) / 2,
      opacity: this.style.opacity,
    })
    this.decorate(image, 'image')
    this.canvas.add(image)
    this.setTool('select')
    this.canvas.setActiveObject(image)
    this.canvas.requestRenderAll()
    this.commitNow()
  }

  async addImages(urls: string[]): Promise<void> {
    if (!urls.length) return
    const maxSide = 340
    const gap = 30
    const columns = Math.min(urls.length, 2)
    const rows = Math.ceil(urls.length / columns)
    const cell = maxSide + gap
    const center = this.sceneCenter()
    const startX = center.x - (columns * cell) / 2 + cell / 2
    const startY = center.y - (rows * cell) / 2 + cell / 2

    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index]
      if (!url) continue
      const image = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
      const sourceWidth = image.width || 1
      const sourceHeight = image.height || 1
      const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight))
      image.scale(scale)

      const column = index % columns
      const row = Math.floor(index / columns)
      image.set({
        left: startX + column * cell - (sourceWidth * scale) / 2,
        top: startY + row * cell - (sourceHeight * scale) / 2,
      })
      this.decorate(image, 'image')
      this.canvas.add(image)
    }

    this.canvas.requestRenderAll()
    this.commitNow()
  }

  clearSelection(): void {
    this.canvas.discardActiveObject()
    this.canvas.requestRenderAll()
    this.emitState()
  }

  deleteSelection(): void {
    const objects = this.canvas
      .getActiveObjects()
      .filter((object) => !meta(object).locked && !isArtboardObject(object))
    if (!objects.length) return
    this.canvas.discardActiveObject()
    this.canvas.remove(...objects)
    this.canvas.requestRenderAll()
    this.commitNow()
  }

  async duplicateSelection(): Promise<void> {
    const objects = this.canvas.getActiveObjects()
    if (!objects.length) return
    const clones = await Promise.all(objects.map((object) => object.clone(CUSTOM_PROPS)))
    const duplicates = clones.filter((clone): clone is FabricObject => Boolean(clone))
    if (!duplicates.length) return

    this.quiet = true
    duplicates.forEach((clone) => {
      meta(clone).id = createObjectId()
      meta(clone).locked = false
      clone.set({
        left: (clone.left ?? 0) + 28,
        top: (clone.top ?? 0) + 28,
      })
      clone.setCoords()
      this.canvas.add(clone)
    })
    this.quiet = false

    this.canvas.discardActiveObject()
    if (duplicates.length === 1) {
      this.canvas.setActiveObject(duplicates[0]!)
    }
    this.canvas.requestRenderAll()
    this.commitNow()
  }

  /* ------------------------------------------------------------- 样式 */

  setStyle(patch: Partial<ShapeStyle>): void {
    this.style = { ...this.style, ...patch }
    const objects = this.canvas.getActiveObjects()
    objects.forEach((object) => {
      const kind = kindOf(object)
      if (patch.opacity !== undefined) object.set({ opacity: patch.opacity })

      if (kind === 'text') {
        if (patch.fill !== undefined) object.set({ fill: patch.fill })
        if (patch.fontSize !== undefined && object instanceof IText) {
          object.set({ fontSize: patch.fontSize })
        }
      } else if (kind === 'image' || kind === 'group') {
        // 图片与组合（箭头）只改透明度，避免破坏内部结构
      } else if (kind === 'path') {
        if (patch.stroke !== undefined) object.set({ stroke: patch.stroke })
        if (patch.strokeWidth !== undefined) object.set({ strokeWidth: patch.strokeWidth })
      } else {
        if (patch.fill !== undefined && object.type !== 'line') {
          object.set({ fill: patch.fill })
        }
        if (patch.stroke !== undefined) object.set({ stroke: patch.stroke })
        if (patch.strokeWidth !== undefined) object.set({ strokeWidth: patch.strokeWidth })
      }
      object.setCoords()
    })

    if (this.tool === 'pen') this.applyBrush()
    this.canvas.requestRenderAll()
    if (objects.length) this.commitNow()
    this.emitState()
  }

  private applyBrush(): void {
    const brush = new PencilBrush(this.canvas)
    brush.color = this.style.stroke
    brush.width = Math.max(1, this.style.strokeWidth * 2)
    this.canvas.freeDrawingBrush = brush
  }

  /* ------------------------------------------------------------- 图层 */

  selectLayer(id: string): void {
    this.selectLayers([id])
  }

  /** 选中一批图层；两张及以上组成 ActiveSelection，可一起拖动/变换 */
  selectLayers(ids: string[]): void {
    const objects = ids
      .map((id) => this.findObject(id))
      .filter((object): object is FabricObject => Boolean(object))
      .filter((object) => !meta(object).locked && object.visible !== false)

    this.canvas.discardActiveObject()
    if (objects.length === 1) {
      this.canvas.setActiveObject(objects[0]!)
    } else if (objects.length > 1) {
      this.canvas.setActiveObject(new ActiveSelection(objects, { canvas: this.canvas }))
    }
    this.canvas.requestRenderAll()
    this.emitState()
  }

  renameLayer(id: string, name: string): void {
    const object = this.findObject(id)
    const clean = name.trim().slice(0, 40)
    if (!object || !clean) return
    meta(object).name = clean
    this.commitNow()
    this.emitState()
  }

  /** 应用文件夹继承后的最终显隐/锁定状态（一次提交，避免多次入栈） */
  applyLayerStates(states: Record<string, { visible: boolean; locked: boolean }>): void {
    let changed = false

    this.canvas.getObjects().forEach((object) => {
      const id = meta(object).id
      if (!id) return
      const state = states[id] ?? { visible: true, locked: false }

      if ((object.visible !== false) !== state.visible) {
        object.set({ visible: state.visible })
        changed = true
      }
      if ((meta(object).locked === true) !== state.locked) {
        meta(object).locked = state.locked
        object.set({ selectable: !state.locked, evented: !state.locked })
        changed = true
      }
    })

    const active = this.canvas.getActiveObjects()
    if (active.some((object) => object.visible === false || meta(object).locked)) {
      this.canvas.discardActiveObject()
    }

    this.canvas.requestRenderAll()
    if (!changed) return
    // 显隐/锁定属于面板元数据，不写入画布历史；由图层树自行持久化
    this.emitState()
  }

  removeLayer(id: string): void {
    const object = this.findObject(id)
    if (!object) return
    if (this.canvas.getActiveObjects().includes(object)) this.canvas.discardActiveObject()
    this.canvas.remove(object)
    this.canvas.requestRenderAll()
    this.commitNow()
  }

  /** 按图层面板的自上而下顺序重排画布堆叠（面板顶部 = 画布最上层，即最后绘制） */
  applyLayerOrder(orderedIds: string[]): void {
    const objects = this.contentObjects()
    const byId = new Map<string, FabricObject>()
    objects.forEach((object) => {
      const id = meta(object).id
      if (id) byId.set(id, object)
    })

    const ordered: FabricObject[] = []
    const seen = new Set<string>()
    for (let index = orderedIds.length - 1; index >= 0; index -= 1) {
      const id = orderedIds[index]
      if (!id || seen.has(id)) continue
      const object = byId.get(id)
      if (!object) continue
      seen.add(id)
      ordered.push(object)
    }
    objects.forEach((object) => {
      const id = meta(object).id ?? ''
      if (!seen.has(id)) ordered.push(object)
    })

    const changed =
      ordered.length !== objects.length || ordered.some((object, index) => object !== objects[index])
    if (!changed) return

    // remove/add 会清掉选中态，重排前先记下选中 id 并解散当前选择，重排后恢复
    const activeIds = this.canvas
      .getActiveObjects()
      .map((object) => meta(object).id ?? '')
      .filter(Boolean)
    this.canvas.discardActiveObject()

    const previousQuiet = this.quiet
    this.quiet = true
    objects.forEach((object) => this.canvas.remove(object))
    ordered.forEach((object) => this.canvas.add(object))
    this.quiet = previousQuiet

    const restored = activeIds
      .map((id) => byId.get(id))
      .filter((object): object is FabricObject => Boolean(object))
    if (restored.length === 1) this.canvas.setActiveObject(restored[0]!)
    else if (restored.length > 1) {
      this.canvas.setActiveObject(new ActiveSelection(restored, { canvas: this.canvas }))
    }

    this.ensureArtboardBack()
    this.canvas.requestRenderAll()
    this.emitState()
  }

  private findObject(id: string): FabricObject | undefined {
    return this.canvas.getObjects().find((object) => meta(object).id === id)
  }

  /* ------------------------------------------------------------- 历史 */

  undo(): void {
    if (this.historyIndex <= 0) return
    this.historyIndex -= 1
    void this.restore(this.history[this.historyIndex])
  }

  redo(): void {
    if (this.historyIndex >= this.history.length - 1) return
    this.historyIndex += 1
    void this.restore(this.history[this.historyIndex])
  }

  private async restore(json: string | undefined): Promise<void> {
    if (!json) return
    window.clearTimeout(this.commitTimer)
    this.quiet = true
    try {
      await this.applyCanvasJson(JSON.parse(json))
      this.hydrate()
    } finally {
      this.quiet = false
    }
    this.canvas.requestRenderAll()
    this.emitState()
    // 撤销/重做后对象可能增减，通知外部对账图层树并触发自动保存
    this.contentListeners.forEach((listener) => listener())
  }

  private resetHistory(): void {
    this.history = [JSON.stringify(this.serialize())]
    this.historyIndex = 0
    this.emitState()
  }

  private commitNow(): void {
    if (!this.ready || this.quiet) return
    const json = JSON.stringify(this.serialize())
    if (this.history[this.historyIndex] === json) return
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.history.push(json)
    if (this.history.length > 60) this.history.shift()
    this.historyIndex = this.history.length - 1
    this.emitState()
    this.contentListeners.forEach((listener) => listener())
  }

  private scheduleCommit(): void {
    if (!this.ready || this.quiet) return
    window.clearTimeout(this.commitTimer)
    this.commitTimer = window.setTimeout(() => this.commitNow(), 240)
  }

  /* ------------------------------------------------------------- 持久化 */

  serialize(): unknown {
    return {
      ...this.canvas.toJSON(),
      artboard: this.artboard ? { ...this.artboard } : null,
      aiTools: this.getAiTools(),
    }
  }

  async load(data: unknown): Promise<void> {
    this.quiet = true
    try {
      await this.applyCanvasJson(data)
      this.hydrate()
    } finally {
      this.quiet = false
    }
    this.canvas.requestRenderAll()
    this.resetHistory()
    this.emitViewport()
  }

  thumbnail(): string | null {
    if (!this.contentObjects().length) return null
    return this.canvas.toDataURL({
      format: 'png',
      multiplier: 0.24,
      filter: (object) => !isArtboardObject(object),
    })
  }

  /** 导出 JSON 源文件（含画板尺寸，可直接回灌 load） */
  exportJSON(): unknown {
    return this.serialize()
  }

  /**
   * 导出 PNG：默认导出内容区域、深色底、2 倍；画板区域按 (0,0,width,height) 导出。
   * 导出结束后恢复画布尺寸、视口与底色。
   */
  exportPNG(options: ExportPngOptions = {}): string {
    const region = options.region ?? 'content'
    const background = options.background ?? 'dark'
    const artboard = this.artboard
    const useArtboard = region === 'artboard' && Boolean(artboard)

    // 导出时补上与编辑器一致的深色底，避免浅色描边在透明底上不可见
    const previousBackground = this.canvas.backgroundColor
    if (background === 'dark') this.canvas.backgroundColor = EXPORT_BACKGROUND

    const bounds: ContentBounds | null = useArtboard && artboard
      ? { left: 0, top: 0, width: artboard.width, height: artboard.height }
      : this.contentBounds()

    if (!bounds) {
      const url = this.canvas.toDataURL({
        format: 'png',
        multiplier: 1,
        filter: (object) => !isArtboardObject(object),
      })
      this.canvas.backgroundColor = previousBackground
      this.canvas.requestRenderAll()
      return url
    }

    const padding = useArtboard ? 0 : CONTENT_EXPORT_PADDING
    const width = Math.ceil(bounds.width + padding * 2)
    const height = Math.ceil(bounds.height + padding * 2)
    let multiplier = options.multiplier ?? 2
    while (width * multiplier * height * multiplier > MAX_EXPORT_PIXELS && multiplier > 0.5) {
      multiplier -= 0.25
    }

    const previousWidth = this.canvas.getWidth()
    const previousHeight = this.canvas.getHeight()
    const previousTransform = [...this.canvas.viewportTransform] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ]

    this.canvas.setDimensions({ width, height })
    this.canvas.setViewportTransform([1, 0, 0, 1, -bounds.left + padding, -bounds.top + padding])
    const url = this.canvas.toDataURL({
      format: 'png',
      multiplier,
      filter: (object) => !isArtboardObject(object),
    })

    this.canvas.setDimensions({ width: previousWidth, height: previousHeight })
    this.canvas.setViewportTransform(previousTransform)
    this.canvas.backgroundColor = previousBackground
    this.canvas.requestRenderAll()
    this.emitViewport()
    return url
  }

  /** 清空画布并按数据重建内容与画板矩形（原 JSON 里的画板对象会被剔除） */
  private async applyCanvasJson(data: unknown): Promise<void> {
    const payload =
      data && typeof data === 'object'
        ? ({ ...(data as Record<string, unknown>) } as Record<string, unknown>)
        : null

    if (payload) {
      this.artboard = normalizeArtboard(payload.artboard)
      this.aiTools = normalizeAiTools(payload.aiTools)
      delete payload.artboard
      delete payload.aiTools
      if (Array.isArray(payload.objects)) {
        payload.objects = payload.objects.filter((object) => !isArtboardJson(object))
      }
      await this.canvas.loadFromJSON(payload)
    } else {
      this.canvas.clear()
      this.artboard = null
      this.aiTools = []
    }
    this.syncArtboardRect()
  }

  private contentBounds(): ContentBounds | null {
    const objects = this.contentObjects().filter((object) => object.visible !== false)
    if (!objects.length) return null

    let left = Number.POSITIVE_INFINITY
    let top = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY

    objects.forEach((object) => {
      const rect = object.getBoundingRect()
      left = Math.min(left, rect.left)
      top = Math.min(top, rect.top)
      right = Math.max(right, rect.left + rect.width)
      bottom = Math.max(bottom, rect.top + rect.height)
    })

    if (!Number.isFinite(left) || !Number.isFinite(top)) return null
    return {
      left,
      top,
      width: Math.max(right - left, 1),
      height: Math.max(bottom - top, 1),
    }
  }

  /* ------------------------------------------------------------- 内部 */

  private decorate(object: FabricObject, kind: LayerKind, label?: string): void {
    meta(object).id = createObjectId()
    meta(object).locked = false
    meta(object).name = this.nextName(label ?? KIND_LABELS[kind])
    object.set({ selectable: true, evented: true })
    object.setCoords()
  }

  private nextName(label: string): string {
    const next = (this.counters[label] ?? 0) + 1
    this.counters[label] = next
    return `${label} ${next}`
  }

  private hydrate(): void {
    this.counters = {}
    const labelPattern = /^(.*?)\s+(\d+)$/

    this.canvas.getObjects().forEach((object) => {
      if (isArtboardObject(object)) return
      if (!meta(object).id) meta(object).id = createObjectId()
      if (!meta(object).name) meta(object).name = typeLabelOf(object)

      const locked = meta(object).locked === true
      object.set({ selectable: !locked, evented: !locked })
      object.setCoords()

      const match = labelPattern.exec(meta(object).name ?? '')
      if (match) {
        const label = match[1] ?? ''
        const index = Number(match[2] ?? 0)
        this.counters[label] = Math.max(this.counters[label] ?? 0, index)
      }
    })
  }

  private handleResize(): void {
    const width = Math.max(this.host.clientWidth, 1)
    const height = Math.max(this.host.clientHeight, 1)
    this.canvas.setDimensions({ width, height })
    this.canvas.requestRenderAll()
    this.emitViewport()
  }

  private bindEvents(): void {
    this.canvas.on('mouse:down', (opt) => {
      this.handlePointerDown(opt.scenePoint, opt.e)
      this.emitState()
    })

    this.canvas.on('mouse:move', (opt) => {
      this.handlePointerMove(opt.scenePoint, opt.e)
    })

    this.canvas.on('mouse:up', () => {
      this.handlePointerUp()
    })

    this.canvas.on('path:created', (event) => {
      const path = (event as unknown as { path?: FabricObject }).path
      if (!path) return
      this.decorate(path, 'path')
      this.canvas.requestRenderAll()
      this.commitNow()
    })

    this.canvas.on('object:added', () => this.scheduleCommit())
    this.canvas.on('object:modified', () => this.scheduleCommit())
    this.canvas.on('object:removed', () => this.scheduleCommit())
    this.canvas.on('text:editing:exited', () => this.commitNow())

    this.canvas.on('selection:created', () => this.emitState())
    this.canvas.on('selection:updated', () => this.emitState())
    this.canvas.on('selection:cleared', () => this.emitState())
  }

  private handlePointerDown(scene: Point, event: Event): void {
    const { x, y } = clientPoint(event)
    // 右键留给 AI 工具菜单，不参与绘制与框选
    if (event instanceof MouseEvent && event.button === 2) return
    const middleButton = event instanceof MouseEvent && event.button === 1

    if (this.tool === 'hand' || this.spacePressed || middleButton) {
      this.panning = true
      this.panStart = { x, y }
      this.panOrigin = {
        x: this.canvas.viewportTransform[4],
        y: this.canvas.viewportTransform[5],
      }
      this.emitViewport()
      return
    }

    if (this.tool === 'eraser') {
      this.erasing = true
      this.lastErasePoint = scene
      this.eraseAt(scene, event)
      return
    }

    if (this.tool === 'select' || this.tool === 'pen') return

    if (this.tool === 'text') {
      this.addText(scene)
      return
    }

    this.startDrawing(scene, this.tool)
  }

  private handlePointerMove(scene: Point, event: Event): void {
    if (this.panning) {
      const { x, y } = clientPoint(event)
      const zoom = this.canvas.getZoom()
      this.canvas.setViewportTransform([
        zoom,
        0,
        0,
        zoom,
        this.panOrigin.x + (x - this.panStart.x),
        this.panOrigin.y + (y - this.panStart.y),
      ])
      this.canvas.requestRenderAll()
      this.emitViewport()
      return
    }

    if (this.erasing) {
      this.eraseAt(scene, event)
      return
    }

    if (!this.drawing || !this.drawOrigin || !this.draft) return
    this.updateDraft(this.drawOrigin, scene)
  }

  private handlePointerUp(): void {
    if (this.panning) {
      this.endPan()
      return
    }

    if (this.erasing) {
      this.erasing = false
      this.lastErasePoint = null
      this.commitNow()
      return
    }

    if (!this.drawing || !this.draft || !this.drawOrigin) return

    const object = this.draft
    const toolLabel = this.drawTool ? DRAW_LABELS[this.drawTool] : undefined
    const kind = this.drawTool === 'arrow' ? 'group' : kindOf(object)

    this.draft = null
    this.drawOrigin = null
    this.drawTool = null
    this.drawing = false

    if (this.isDegenerate(object)) {
      this.quiet = true
      this.canvas.remove(object)
      this.quiet = false
      this.canvas.requestRenderAll()
      this.emitState()
      return
    }

    this.decorate(object, kind, toolLabel)
    this.canvas.setActiveObject(object)
    this.canvas.requestRenderAll()
    this.commitNow()
    this.setTool('select')
  }

  private startDrawing(scene: Point, tool: ToolName): void {
    this.drawing = true
    this.drawOrigin = scene
    this.drawTool = tool

    let object: FabricObject
    if (tool === 'rect') {
      object = new Rect({
        left: scene.x,
        top: scene.y,
        width: 1,
        height: 1,
        fill: this.style.fill,
        stroke: this.style.stroke,
        strokeWidth: this.style.strokeWidth,
        opacity: this.style.opacity,
      })
    } else if (tool === 'ellipse') {
      object = new Ellipse({
        left: scene.x,
        top: scene.y,
        rx: 1,
        ry: 1,
        originX: 'left',
        originY: 'top',
        fill: this.style.fill,
        stroke: this.style.stroke,
        strokeWidth: this.style.strokeWidth,
        opacity: this.style.opacity,
      })
    } else if (tool === 'line') {
      object = new Line([scene.x, scene.y, scene.x + 1, scene.y + 1], {
        stroke: this.style.stroke,
        strokeWidth: this.style.strokeWidth,
        strokeLineCap: 'round',
        opacity: this.style.opacity,
      })
    } else {
      object = this.createArrow(scene, new Point(scene.x + 1, scene.y + 1))
    }

    this.draft = object
    this.quiet = true
    this.canvas.add(object)
    this.quiet = false
  }

  private updateDraft(origin: Point, current: Point): void {
    const object = this.draft
    if (!object) return

    if (this.drawTool === 'arrow') {
      this.quiet = true
      this.canvas.remove(object)
      const arrow = this.createArrow(origin, current)
      this.draft = arrow
      this.canvas.add(arrow)
      this.quiet = false
      this.canvas.requestRenderAll()
      return
    }

    const left = Math.min(origin.x, current.x)
    const top = Math.min(origin.y, current.y)
    const width = Math.abs(current.x - origin.x)
    const height = Math.abs(current.y - origin.y)

    if (object instanceof Line) {
      object.set({ x1: origin.x, y1: origin.y, x2: current.x, y2: current.y })
    } else if (object instanceof Ellipse) {
      object.set({ left, top, rx: Math.max(width / 2, 1), ry: Math.max(height / 2, 1) })
    } else if (object instanceof Rect) {
      object.set({ left, top, width: Math.max(width, 1), height: Math.max(height, 1) })
    }

    object.setCoords()
    this.canvas.requestRenderAll()
  }

  private createArrow(from: Point, to: Point): Group {
    const angle = Math.atan2(to.y - from.y, to.x - from.x)
    const headSize = 8 + this.style.strokeWidth * 1.6

    const shaft = new Line([from.x, from.y, to.x, to.y], {
      stroke: this.style.stroke,
      strokeWidth: this.style.strokeWidth,
      strokeLineCap: 'round',
    })

    const head = new Triangle({
      width: headSize * 1.5,
      height: headSize * 1.9,
      fill: this.style.stroke,
      left: to.x,
      top: to.y,
      originX: 'center',
      originY: 'center',
      angle: (angle * 180) / Math.PI + 90,
    })

    return new Group([shaft, head], { opacity: this.style.opacity })
  }

  private isDegenerate(object: FabricObject): boolean {
    if (object instanceof Line) {
      const dx = (object.x2 ?? 0) - (object.x1 ?? 0)
      const dy = (object.y2 ?? 0) - (object.y1 ?? 0)
      return Math.hypot(dx, dy) < 4
    }
    if (object instanceof Group) {
      const rect = object.getBoundingRect()
      return rect.width < 4 && rect.height < 4
    }
    const rect = object.getBoundingRect()
    return rect.width < 4 || rect.height < 4
  }

  private eraseAt(scene: Point, event: Event): void {
    if (this.lastErasePoint && Math.hypot(scene.x - this.lastErasePoint.x, scene.y - this.lastErasePoint.y) < 3) {
      return
    }
    this.lastErasePoint = scene

    // fabric 的 findTarget 在 skipTargetFind 时直接返回空，这里临时关闭再恢复
    const previousSkipTargetFind = this.canvas.skipTargetFind
    this.canvas.skipTargetFind = false
    const target = this.canvas.findTarget(event as MouseEvent)
    this.canvas.skipTargetFind = previousSkipTargetFind

    if (!target || meta(target).locked || isArtboardObject(target)) return
    if (this.canvas.getActiveObjects().includes(target)) this.canvas.discardActiveObject()
    this.canvas.remove(target)
    this.canvas.requestRenderAll()
  }

  private endPan(): void {
    if (!this.panning) return
    this.panning = false
    this.emitViewport()
  }

  private emitState(): void {
    const snapshot = this.snapshot()
    this.stateListeners.forEach((listener) => listener(snapshot))
  }

  private emitViewport(): void {
    const viewport = this.viewport()
    this.viewportListeners.forEach((listener) => listener(viewport))
  }

  destroy(): void {
    window.clearTimeout(this.commitTimer)
    this.resizeObserver.disconnect()
    this.stateListeners.clear()
    this.viewportListeners.clear()
    void this.canvas.dispose()
  }
}
