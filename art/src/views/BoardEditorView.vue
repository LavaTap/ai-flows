<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { FullscreenOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons-vue'
import AiToolMenu from '@/components/canvas/AiToolMenu.vue'
import AiToolPanel from '@/components/canvas/AiToolPanel.vue'
import AiPanel from '@/components/canvas/AiPanel.vue'
import CanvasStage from '@/components/canvas/CanvasStage.vue'
import EditorHeader from '@/components/canvas/EditorHeader.vue'
import LayerPanel from '@/components/canvas/LayerPanel.vue'
import MyAssetsPanel from '@/components/canvas/MyAssetsPanel.vue'
import PropertyPanel from '@/components/canvas/PropertyPanel.vue'
import ToolRail from '@/components/canvas/ToolRail.vue'
import { boardApi } from '@/api/board'
import { assetApi, type AssetSource } from '@/api/asset'
import type { AiCapability } from '@/core/ai/capabilities'
import { CanvasEngine, type ViewportState } from '@/core/canvas/CanvasEngine'
import { MAX_FOLDER_DEPTH } from '@/core/layers/tree'
import { useBoardHotkeys } from '@/composables/useBoardHotkeys'
import { useLayerTree } from '@/composables/useLayerTree'
import type {
  AiToolCard,
  ArtboardSize,
  BoardMeta,
  EngineSnapshot,
  SaveState,
  ToolName,
} from '@/types/board'

const route = useRoute()
const router = useRouter()
const boardId = String(route.params.id ?? '')

const board = ref<BoardMeta | null>(null)
const engine = shallowRef<CanvasEngine | null>(null)
const loading = ref(true)
const generating = ref(false)
const saveState = ref<SaveState>('idle')
const activeTab = ref('layers')
const fileInput = ref<HTMLInputElement | null>(null)
const assetsPanel = ref<InstanceType<typeof MyAssetsPanel> | null>(null)

const snapshot = ref<EngineSnapshot>({
  tool: 'select',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  layers: [],
  selectedIds: [],
  selection: null,
  objectCount: 0,
  artboard: null,
  canUndo: false,
  canRedo: false,
})

const viewport = ref<ViewportState>({
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  panning: false,
  spacePressed: false,
})

const hasArtboard = computed(() => snapshot.value.artboard !== null)

/** 图层面板里选中的节点（可含文件夹），与画布选中对象互为映射 */
const selectedNodeIds = ref<string[]>([])
/** 面板发起的选中：画布回传时要跳过，否则文件夹/锁定图层的选择会被替换成图层 id */
let selectionFromPanel = false

/** 缩放百分比输入：聚焦时暂停跟随视口，提交后再同步 */
const zoomText = ref('100')
const zoomEditing = ref(false)

/** 右键唤出的 AI 工具菜单，以及摆放在画布上的 AI 工具参数面板 */
interface AiMenuState {
  sceneX: number
  sceneY: number
  screenX: number
  screenY: number
}

const aiMenu = ref<AiMenuState | null>(null)
const aiTools = ref<AiToolCard[]>([])
const stageWrap = ref<HTMLElement | null>(null)
const createAiToolId = (): string => `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** 画板尺寸弹窗 */
interface ArtboardPreset {
  key: string
  label: string
  width: number | null
  height: number | null
}

const ARTBOARD_PRESETS: ArtboardPreset[] = [
  { key: 'infinite', label: '无限画布', width: null, height: null },
  { key: '1920x1080', label: '1920 × 1080', width: 1920, height: 1080 },
  { key: '1080x1080', label: '1080 × 1080', width: 1080, height: 1080 },
  { key: '1200x1600', label: '1200 × 1600', width: 1200, height: 1600 },
  { key: '1240x1754', label: '1240 × 1754（A4）', width: 1240, height: 1754 },
  { key: 'custom', label: '自定义宽高', width: null, height: null },
]

const artboardOpen = ref(false)
const artboardPresetKey = ref('infinite')
const customWidth = ref(1920)
const customHeight = ref(1080)

let saveTimer: number | undefined
let destroyed = false

const layerTree = useLayerTree(() => engine.value, { onChange: () => scheduleSave() })
const layerNodes = layerTree.tree

/** 画布上的选中变化（直接点选/框选/撤销）反向同步到面板 */
watch(
  () => snapshot.value.selectedIds,
  (ids) => {
    if (selectionFromPanel) {
      selectionFromPanel = false
      return
    }
    const expanded = layerTree.layerIdsFor(selectedNodeIds.value)
    // 用集合比较：画布返回的是堆叠顺序，面板给的是树顺序，顺序不同不算变化
    const same = expanded.length === ids.length && expanded.every((id) => ids.includes(id))
    if (!same) selectedNodeIds.value = [...ids]
  },
)

function handleReady(instance: CanvasEngine): void {
  engine.value = instance
  instance.subscribe((next) => {
    snapshot.value = next
  })
  instance.onViewport((next) => {
    viewport.value = next
  })
  instance.onContentChange(() => {
    layerTree.reconcile()
    scheduleSave()
  })
  void bootstrap(instance)
}

async function bootstrap(instance: CanvasEngine): Promise<void> {
  if (!boardId) {
    await router.replace('/')
    return
  }
  try {
    const record = await boardApi.detail(boardId)
    if (!record) {
      message.error('画板不存在或已被删除')
      await router.replace('/')
      return
    }
    board.value = record.meta
    await instance.load(record.canvas)
    aiTools.value = instance.getAiTools()
    layerTree.hydrate(record.tree ?? null)
    if (instance.getArtboard()) instance.fitArtboard()
    else if (record.meta.objectCount > 0) instance.fitContent()
    saveState.value = 'saved'
  } catch (error) {
    message.error(error instanceof Error ? error.message : '画板加载失败')
  } finally {
    loading.value = false
  }
}

function scheduleSave(): void {
  if (loading.value) return
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void persist(true)
  }, 900)
}

async function persist(silent = false): Promise<void> {
  const instance = engine.value
  const current = board.value
  if (!instance || !current || destroyed) return

  saveState.value = 'saving'
  try {
    const saved = await boardApi.save(current.id, {
      name: current.name,
      canvas: instance.serialize(),
      tree: layerTree.serialize(),
      objectCount: instance.layers().length,
      thumbnail: instance.thumbnail(),
    })
    board.value = saved
    saveState.value = 'saved'
  } catch (error) {
    saveState.value = 'error'
    if (!silent) {
      message.error(error instanceof Error ? error.message : '保存失败')
    }
  }
}

async function handleRename(name: string): Promise<void> {
  const current = board.value
  if (!current) return
  const previous = current.name
  board.value = { ...current, name }
  try {
    board.value = await boardApi.rename(current.id, name)
  } catch (error) {
    board.value = { ...current, name: previous }
    message.error(error instanceof Error ? error.message : '重命名失败')
  }
}

function handleTool(tool: ToolName): void {
  engine.value?.setTool(tool)
}

function handleCreateFolder(parentId: string | null): void {
  if (!layerTree.createFolder(parentId)) {
    message.warning(`文件夹最多 ${MAX_FOLDER_DEPTH} 层`)
  }
}

function handleLayerRename(id: string, name: string): void {
  layerTree.renameNode(id, name)
}

function handleLayerRemove(id: string): void {
  layerTree.removeNode(id)
  // 解散文件夹/删除图层后，面板里可能残留已不存在的节点
  selectedNodeIds.value = selectedNodeIds.value.filter((nodeId) => layerTree.hasNode(nodeId))
}

function handleLayerSelect(payload: { id: string; additive: boolean }): void {
  const current = selectedNodeIds.value
  const next = payload.additive
    ? current.includes(payload.id)
      ? current.filter((id) => id !== payload.id)
      : [...current, payload.id]
    : [payload.id]
  selectedNodeIds.value = next
  const instance = engine.value
  if (!instance) return
  selectionFromPanel = true
  instance.selectLayers(layerTree.layerIdsFor(next))
}

function handleLayerMove(payload: { ids: string[]; parentId: string | null; beforeId: string | null }): void {
  const ok = layerTree.moveNodes(payload.ids, {
    parentId: payload.parentId,
    beforeId: payload.beforeId,
  })
  if (!ok) message.warning(`文件夹最多 ${MAX_FOLDER_DEPTH} 层，无法移到该位置`)
}

/** 属性面板的上移/下移/置顶/置底：按图层树同级顺序调整，并同步画布遮挡 */
function handleLayerOrder(direction: 'up' | 'down' | 'top' | 'bottom'): void {
  const id =
    selectedNodeIds.value.length === 1
      ? selectedNodeIds.value[0]
      : (snapshot.value.selectedIds[0] ?? '')
  if (!id) return
  layerTree.reorder(id, direction)
}

function handleLayerToggleVisible(id: string): void {
  layerTree.toggleVisible(id)
}

function handleLayerToggleLocked(id: string): void {
  layerTree.toggleLocked(id)
}

function handleLayerToggleCollapse(id: string): void {
  layerTree.toggleCollapse(id)
}

function openFilePicker(): void {
  fileInput.value?.click()
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

/** 图片先登记进「我的素材」，画布只引用平台地址，避免 base64 把画板 JSON 撑大 */
async function registerAsset(dataUrl: string, name: string, source: AssetSource): Promise<string> {
  const asset = await assetApi.upload(dataUrl, name, source)
  void assetsPanel.value?.reload()
  return asset.url
}

async function insertFile(
  file: File,
  point?: { clientX: number; clientY: number },
): Promise<void> {
  const instance = engine.value
  if (!instance) return
  if (file.size > 8 * 1024 * 1024) {
    message.warning('单张图片不能超过 8MB')
    return
  }
  try {
    const dataUrl = await readAsDataUrl(file)
    const url = await registerAsset(dataUrl, file.name || '粘贴图片', point ? 'paste' : 'upload')
    await instance.addImageUrl(url, point?.clientX, point?.clientY)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '图片插入失败')
  }
}

async function handleFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await insertFile(file)
}

async function handleStageImage(payload: {
  file: File
  clientX?: number
  clientY?: number
}): Promise<void> {
  await insertFile(
    payload.file,
    payload.clientX !== undefined && payload.clientY !== undefined
      ? { clientX: payload.clientX, clientY: payload.clientY }
      : undefined,
  )
}

async function handleGenerated(images: string[]): Promise<void> {
  const instance = engine.value
  if (!instance || !images.length) return
  generating.value = true
  try {
    const urls: string[] = []
    for (let index = 0; index < images.length; index += 1) {
      const dataUrl = images[index]
      if (!dataUrl) continue
      urls.push(await registerAsset(dataUrl, `生成素材 ${index + 1}`, 'generate'))
    }
    await instance.addImages(urls)
    activeTab.value = 'layers'
    message.success(`已放入 ${urls.length} 张生成结果，并存入我的素材`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '生成结果插入失败')
  } finally {
    generating.value = false
  }
}

/** 从「我的素材」点选一张放进画布（复用已有素材，不重复登记） */
async function handleInsertAsset(url: string): Promise<void> {
  try {
    await engine.value?.addImageUrl(url)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '素材插入失败')
  }
}

/** 触发浏览器下载；blob 地址用完即回收 */
function downloadFile(href: string, filename: string): void {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  if (href.startsWith('blob:')) URL.revokeObjectURL(href)
}

function safeBoardName(): string {
  return (board.value?.name ?? 'free-canvas').replace(/[\\/:*?"<>|]/g, '_')
}

function handleExport(kind: 'png' | 'png-board' | 'json'): void {
  const instance = engine.value
  if (!instance) return

  if (kind === 'json') {
    try {
      const blob = new Blob([JSON.stringify(instance.exportJSON(), null, 2)], {
        type: 'application/json',
      })
      downloadFile(URL.createObjectURL(blob), `${safeBoardName()}.json`)
      message.success('JSON 源文件已导出')
    } catch {
      message.error('导出失败')
    }
    return
  }

  if (kind === 'png-board' && !instance.getArtboard()) {
    message.info('尚未设置画板尺寸')
    return
  }
  if (kind === 'png' && !snapshot.value.objectCount) {
    message.info('画布还是空的，先画点什么吧')
    return
  }

  try {
    const url = instance.exportPNG({
      region: kind === 'png-board' ? 'artboard' : 'content',
    })
    downloadFile(url, `${safeBoardName()}.png`)
    message.success(kind === 'png-board' ? '画板区域 PNG 已导出' : 'PNG 已导出')
  } catch {
    message.error('导出失败')
  }
}

/* ------------------------------------------------------------- 缩放输入 */

watch(
  () => viewport.value.zoom,
  (zoom) => {
    if (!zoomEditing.value) zoomText.value = String(Math.round(zoom * 100))
  },
  { immediate: true },
)

function commitZoom(): void {
  zoomEditing.value = false
  const percent = Number(zoomText.value.replace('%', '').trim())
  if (!Number.isFinite(percent) || percent < 10 || percent > 800) {
    zoomText.value = String(Math.round(viewport.value.zoom * 100))
    return
  }
  engine.value?.setZoom(percent / 100)
  zoomText.value = String(Math.round(viewport.value.zoom * 100))
}

/* ------------------------------------------------------------- AI 工具 */

const AI_MENU_WIDTH = 268
const AI_MENU_HEIGHT = 320

/** 右键（捕获阶段，避免被 fabric 的 canvas 事件吞掉）：在光标处弹出 AI 工具菜单 */
function openAiMenu(event: MouseEvent): void {
  const target = event.target as Element | null
  // 只有点在画布区域才响应，侧边面板/缩放条上右键不弹菜单
  if (!target?.closest('.stage')) return
  event.preventDefault()
  const instance = engine.value
  const wrap = stageWrap.value
  if (!instance || !wrap) return
  const scene = instance.sceneFromClient(event.clientX, event.clientY)
  const rect = wrap.getBoundingClientRect()
  const maxX = Math.max(rect.width - AI_MENU_WIDTH - 8, 8)
  const maxY = Math.max(rect.height - AI_MENU_HEIGHT - 8, 8)
  aiMenu.value = {
    sceneX: scene.x,
    sceneY: scene.y,
    screenX: Math.min(Math.max(event.clientX - rect.left, 8), maxX),
    screenY: Math.min(Math.max(event.clientY - rect.top, 8), maxY),
  }
}

function closeAiMenu(): void {
  aiMenu.value = null
}

/** 点选能力后把参数面板落到右键位置，并随画板 JSON 保存 */
function addAiTool(capability: AiCapability): void {
  const menu = aiMenu.value
  if (!menu) return
  const values: Record<string, string | number> = {}
  capability.fields.forEach((field) => {
    values[field.key] = field.default
  })
  aiTools.value = [
    ...aiTools.value,
    { id: createAiToolId(), capability: capability.key, x: menu.sceneX, y: menu.sceneY, values },
  ]
  aiMenu.value = null
  syncAiTools()
}

function moveAiTool(id: string, x: number, y: number): void {
  aiTools.value = aiTools.value.map((card) =>
    card.id === id ? { ...card, x: Math.round(x), y: Math.round(y) } : card,
  )
  syncAiTools()
}

function setAiToolValues(id: string, values: Record<string, string | number>): void {
  aiTools.value = aiTools.value.map((card) => (card.id === id ? { ...card, values } : card))
  syncAiTools()
}

function removeAiTool(id: string): void {
  aiTools.value = aiTools.value.filter((card) => card.id !== id)
  syncAiTools()
}

function syncAiTools(): void {
  engine.value?.setAiTools(aiTools.value)
  scheduleSave()
}

/* ------------------------------------------------------------- 画板尺寸 */

function openArtboardDialog(): void {
  const current = snapshot.value.artboard
  if (!current) {
    artboardPresetKey.value = 'infinite'
    customWidth.value = 1920
    customHeight.value = 1080
  } else {
    const matched = ARTBOARD_PRESETS.find(
      (preset) => preset.width === current.width && preset.height === current.height,
    )
    if (matched) {
      artboardPresetKey.value = matched.key
    } else {
      artboardPresetKey.value = 'custom'
    }
    customWidth.value = current.width
    customHeight.value = current.height
  }
  artboardOpen.value = true
}

function applyArtboard(): void {
  const instance = engine.value
  if (!instance) return

  let size: ArtboardSize | null = null
  if (artboardPresetKey.value === 'custom') {
    const width = Number(customWidth.value)
    const height = Number(customHeight.value)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 16 || height < 16) {
      message.warning('自定义宽高需在 16 到 20000 之间')
      return
    }
    size = { width: Math.round(width), height: Math.round(height) }
  } else if (artboardPresetKey.value !== 'infinite') {
    const preset = ARTBOARD_PRESETS.find((item) => item.key === artboardPresetKey.value)
    if (preset?.width && preset.height) {
      size = { width: preset.width, height: preset.height }
    }
  }

  instance.setArtboard(size)
  instance.fitArtboard()
  artboardOpen.value = false
  message.success(size ? `画板已设为 ${size.width} × ${size.height}` : '已切换为无限画布')
}

async function handleBack(): Promise<void> {
  void persist(true)
  await router.push('/')
}

useBoardHotkeys(() => engine.value, { save: () => void persist(false) })

onBeforeUnmount(() => {
  window.clearTimeout(saveTimer)
  void persist(true)
  destroyed = true
})
</script>

<template>
  <div class="editor">
    <EditorHeader
      :name="board?.name ?? '加载中…'"
      :save-state="saveState"
      :can-undo="snapshot.canUndo"
      :can-redo="snapshot.canRedo"
      :has-artboard="hasArtboard"
      @back="handleBack"
      @rename="handleRename"
      @save="persist(false)"
      @undo="engine?.undo()"
      @redo="engine?.redo()"
      @export="handleExport"
      @artboard="openArtboardDialog"
      @fit="engine?.fitContent()"
    />

    <div class="editor-body">
      <ToolRail :tool="snapshot.tool" @update:tool="handleTool" @upload="openFilePicker" />

      <div
        ref="stageWrap"
        class="stage-wrap"
        @wheel="closeAiMenu"
        @contextmenu.capture="openAiMenu"
      >
        <CanvasStage
          :empty="!loading && snapshot.objectCount === 0 && !hasArtboard"
          @ready="handleReady"
          @image-file="handleStageImage"
        />

        <div v-if="aiMenu" class="ai-menu-backdrop" @pointerdown="closeAiMenu" />

        <AiToolMenu
          v-if="aiMenu"
          :x="aiMenu.screenX"
          :y="aiMenu.screenY"
          @pick="addAiTool"
          @close="closeAiMenu"
        />

        <AiToolPanel
          v-for="card in aiTools"
          :key="card.id"
          :card="card"
          :zoom="viewport.zoom"
          :x="card.x * viewport.zoom + viewport.offsetX"
          :y="card.y * viewport.zoom + viewport.offsetY"
          @move="(x, y) => moveAiTool(card.id, x, y)"
          @values="(values) => setAiToolValues(card.id, values)"
          @close="removeAiTool(card.id)"
        />

        <div v-if="loading" class="stage-loading">
          <a-spin size="large" />
          <span>正在打开画板…</span>
        </div>

        <div v-if="generating" class="stage-loading">
          <a-spin size="large" />
          <span>正在把生成结果放入画布…</span>
        </div>

        <div class="zoom-bar">
          <button type="button" class="icon-btn" title="缩小" @click="engine?.zoomOut()">
            <ZoomOutOutlined />
          </button>
          <input
            v-model="zoomText"
            class="zoom-input"
            inputmode="numeric"
            title="输入缩放百分比（10%–800%），回车或失焦生效"
            @focus="zoomEditing = true"
            @blur="commitZoom"
            @keydown.enter.prevent="commitZoom"
          />
          <span class="zoom-suffix">%</span>
          <button type="button" class="icon-btn" title="放大" @click="engine?.zoomIn()">
            <ZoomInOutlined />
          </button>
          <span class="header-divider" style="height: 16px" />
          <button type="button" class="icon-btn" title="适应内容 · Ctrl+1" @click="engine?.fitContent()">
            <FullscreenOutlined />
          </button>
        </div>

        <div class="stage-floating-tip">滚轮缩放 · 空格拖拽 · 右键 AI 工具</div>
      </div>

      <aside class="side-panel">
        <a-tabs v-model:activeKey="activeTab" size="small">
          <a-tab-pane key="layers" tab="图层">
            <LayerPanel
              :tree="layerNodes"
              :layers="snapshot.layers"
              :selected-ids="selectedNodeIds"
              :max-depth="MAX_FOLDER_DEPTH"
              @select="handleLayerSelect"
              @create-folder="handleCreateFolder"
              @rename="handleLayerRename"
              @remove="handleLayerRemove"
              @move="handleLayerMove"
              @toggle-visible="handleLayerToggleVisible"
              @toggle-lock="handleLayerToggleLocked"
              @toggle-collapse="handleLayerToggleCollapse"
            />
          </a-tab-pane>

          <a-tab-pane key="props" tab="属性">
            <PropertyPanel
              :selection="snapshot.selection"
              @patch="(patch) => engine?.setStyle(patch)"
              @delete="engine?.deleteSelection()"
              @duplicate="engine?.duplicateSelection()"
              @move="handleLayerOrder"
            />
          </a-tab-pane>

          <a-tab-pane key="ai" tab="智能">
            <AiPanel @generated="handleGenerated" />
          </a-tab-pane>

          <a-tab-pane key="assets" tab="我的素材">
            <MyAssetsPanel ref="assetsPanel" @insert="handleInsertAsset" />
          </a-tab-pane>
        </a-tabs>
      </aside>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      style="display: none"
      @change="handleFileChange"
    />

    <a-modal
      v-model:open="artboardOpen"
      title="画板尺寸"
      :width="440"
      ok-text="应用"
      cancel-text="取消"
      @ok="applyArtboard"
    >
      <div class="artboard-dialog">
        <p class="artboard-note">设置画板区域后，适配与导出会以该尺寸为准；选无限画布则不限制边界。</p>
        <div class="artboard-presets">
          <button
            v-for="preset in ARTBOARD_PRESETS"
            :key="preset.key"
            type="button"
            class="artboard-preset"
            :class="{ active: artboardPresetKey === preset.key }"
            @click="artboardPresetKey = preset.key"
          >
            {{ preset.label }}
          </button>
        </div>
        <div v-if="artboardPresetKey === 'custom'" class="artboard-custom">
          <a-input-number v-model:value="customWidth" :min="16" :max="20000" :step="10" />
          <span class="artboard-times">×</span>
          <a-input-number v-model:value="customHeight" :min="16" :max="20000" :step="10" />
          <span class="artboard-unit">px</span>
        </div>
        <p v-else-if="hasArtboard" class="artboard-current">
          当前画板：{{ snapshot.artboard?.width }} × {{ snapshot.artboard?.height }}
        </p>
      </div>
    </a-modal>
  </div>
</template>
