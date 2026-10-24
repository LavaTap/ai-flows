<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { FullscreenOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons-vue'
import AiPanel from '@/components/canvas/AiPanel.vue'
import CanvasStage from '@/components/canvas/CanvasStage.vue'
import EditorHeader from '@/components/canvas/EditorHeader.vue'
import LayerPanel from '@/components/canvas/LayerPanel.vue'
import MyAssetsPanel from '@/components/canvas/MyAssetsPanel.vue'
import PropertyPanel from '@/components/canvas/PropertyPanel.vue'
import ToolRail from '@/components/canvas/ToolRail.vue'
import { boardApi } from '@/api/board'
import { assetApi, type AssetSource } from '@/api/asset'
import { CanvasEngine, type ViewportState } from '@/core/canvas/CanvasEngine'
import { MAX_FOLDER_DEPTH } from '@/core/layers/tree'
import { useBoardHotkeys } from '@/composables/useBoardHotkeys'
import { useLayerTree } from '@/composables/useLayerTree'
import type { BoardMeta, EngineSnapshot, SaveState, ToolName } from '@/types/board'

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

let saveTimer: number | undefined
let destroyed = false

const layerTree = useLayerTree(() => engine.value, { onChange: () => scheduleSave() })
const layerNodes = layerTree.tree

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
    layerTree.hydrate(record.tree ?? null)
    if (record.meta.objectCount > 0) instance.fitContent()
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
}

function handleLayerMove(id: string, targetFolderId: string | null): void {
  if (!layerTree.moveNode(id, targetFolderId)) {
    message.warning(`文件夹最多 ${MAX_FOLDER_DEPTH} 层，无法移入`)
  }
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

function handleExport(): void {
  const instance = engine.value
  if (!instance) return
  if (!snapshot.value.objectCount) {
    message.info('画布还是空的，先画点什么吧')
    return
  }
  try {
    const url = instance.exportPNG()
    const link = document.createElement('a')
    link.href = url
    link.download = `${(board.value?.name ?? 'free-canvas').replace(/[\\/:*?"<>|]/g, '_')}.png`
    link.click()
    message.success('PNG 已导出')
  } catch {
    message.error('导出失败')
  }
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
      @back="handleBack"
      @rename="handleRename"
      @save="persist(false)"
      @undo="engine?.undo()"
      @redo="engine?.redo()"
      @export="handleExport"
      @fit="engine?.fitContent()"
    />

    <div class="editor-body">
      <ToolRail :tool="snapshot.tool" @update:tool="handleTool" @upload="openFilePicker" />

      <div class="stage-wrap">
        <CanvasStage
          :empty="!loading && snapshot.objectCount === 0"
          @ready="handleReady"
          @image-file="handleStageImage"
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
          <span class="zoom-value" title="点击恢复 100%" @click="engine?.resetView()">
            {{ Math.round(viewport.zoom * 100) }}%
          </span>
          <button type="button" class="icon-btn" title="放大" @click="engine?.zoomIn()">
            <ZoomInOutlined />
          </button>
          <span class="header-divider" style="height: 16px" />
          <button type="button" class="icon-btn" title="适应内容 · Ctrl+1" @click="engine?.fitContent()">
            <FullscreenOutlined />
          </button>
        </div>

        <div class="stage-floating-tip">滚轮缩放 · 空格拖拽 · 双击加字</div>
      </div>

      <aside class="side-panel">
        <a-tabs v-model:activeKey="activeTab" size="small">
          <a-tab-pane key="layers" tab="图层">
            <LayerPanel
              :tree="layerNodes"
              :layers="snapshot.layers"
              :selected-ids="snapshot.selectedIds"
              :max-depth="MAX_FOLDER_DEPTH"
              @select="(id) => engine?.selectLayer(id)"
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
              @move="(direction) => engine?.moveLayer(snapshot.selectedIds[0] ?? '', direction)"
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
  </div>
</template>
