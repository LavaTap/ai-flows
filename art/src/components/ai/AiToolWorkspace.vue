<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import {
  CloudUploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons-vue'
import { assetApi, type ArtAsset } from '@/api/asset'
import type { AiCapability } from '@/core/ai/capabilities'
import {
  loadImage,
  needsMask,
  needsRegion,
  needsSource,
  runProcessor,
  type RegionBox,
  type SourceImage,
} from '@/core/ai/processors'
import AiImageCompare from './AiImageCompare.vue'
import AiMaskEditor from './AiMaskEditor.vue'
import AiParamFields from './AiParamFields.vue'

/** 单个 AI 工具的工作区：源图 → 参数 → 生成 → 结果对比 → 存入素材 */

const props = defineProps<{
  capability: AiCapability
  source: SourceImage | null
}>()

const emit = defineEmits<{ 'update:source': [source: SourceImage | null] }>()

const MAX_SOURCE_BYTES = 8 * 1024 * 1024

type ViewMode = 'result' | 'source' | 'compare'
type RunKind = 'image' | 'frames'

interface RunResult {
  id: string
  images: string[]
  kind: RunKind
  note: string
  at: number
  elapsed: number
  label: string
}

const values = ref<Record<string, string | number>>({})
const mask = ref<string | null>(null)
const region = ref<RegionBox | null>(null)
const running = ref(false)
const result = ref<RunResult | null>(null)
const history = ref<RunResult[]>([])
const activeIndex = ref(0)
const viewMode = ref<ViewMode>('result')
const saving = ref(false)
const assets = ref<ArtAsset[]>([])
const assetOpen = ref(false)
const assetLoading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const playing = ref(false)
let timer: number | null = null

const requiresSource = computed(() => needsSource(props.capability.key))
const needsSourceImage = computed(() => requiresSource.value)
const showMask = computed(() => needsMask(props.capability.key) && Boolean(props.source))
const showRegion = computed(() => needsRegion(props.capability.key) && Boolean(props.source))
const canRun = computed(() => !needsSourceImage.value || Boolean(props.source))
const currentImage = computed(() => {
  if (!result.value) return null
  return result.value.images[Math.min(activeIndex.value, result.value.images.length - 1)] ?? null
})
const brushSize = computed(() => Number(values.value.brush ?? 30))

/* ------------------------------------------------------------ 参数与源图 */

function resetValues(): void {
  const next: Record<string, string | number> = {}
  props.capability.fields.forEach((field) => {
    next[field.key] = field.default
  })
  values.value = next
}

/** 切换工具时清空上一轮的中间态，避免遮罩 / 结果串味 */
watch(
  () => props.capability,
  () => {
    stopPlay()
    resetValues()
    mask.value = null
    region.value = null
    result.value = null
    history.value = []
    activeIndex.value = 0
  },
  { immediate: true },
)

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

async function useImage(url: string, name: string): Promise<void> {
  try {
    const image = await loadImage(url)
    emit('update:source', { url, name, width: image.width, height: image.height })
    mask.value = null
    region.value = null
  } catch {
    message.error('图片读取失败')
  }
}

async function handleFiles(files: File[]): Promise<void> {
  const file = files.find((item) => item.type.startsWith('image/'))
  if (!file) {
    message.warning('请选择图片文件')
    return
  }
  if (file.size > MAX_SOURCE_BYTES) {
    message.error('图片超过 8MB，请先压缩')
    return
  }
  await useImage(await readAsDataUrl(file), file.name)
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  void handleFiles(Array.from(input.files ?? []))
  input.value = ''
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  void handleFiles(Array.from(event.dataTransfer?.files ?? []))
}

function onPaste(event: ClipboardEvent): void {
  const files = Array.from(event.clipboardData?.files ?? [])
  if (files.length) {
    event.preventDefault()
    void handleFiles(files)
  }
}

onMounted(() => window.addEventListener('paste', onPaste))
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
  stopPlay()
})

function clearSource(): void {
  emit('update:source', null)
}

async function openAssets(): Promise<void> {
  assetOpen.value = true
  assetLoading.value = true
  try {
    assets.value = await assetApi.list()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '素材读取失败')
  } finally {
    assetLoading.value = false
  }
}

async function chooseAsset(asset: ArtAsset): Promise<void> {
  assetOpen.value = false
  await useImage(asset.url, asset.name)
}

/* -------------------------------------------------------------- 生成结果 */

async function generate(): Promise<void> {
  if (!canRun.value) {
    message.warning('请先上传或选择一张图片')
    return
  }
  running.value = true
  const started = performance.now()
  try {
    const output = await runProcessor(props.capability.key, {
      source: props.source?.url ?? null,
      values: values.value,
      mask: mask.value,
      region: region.value,
      seed: Math.floor(Math.random() * 100000),
    })
    const next: RunResult = {
      id: `${Date.now()}`,
      images: output.images,
      kind: output.kind,
      note: output.note,
      at: Date.now(),
      elapsed: Math.round(performance.now() - started),
      label: props.capability.label,
    }
    result.value = next
    history.value = [next, ...history.value].slice(0, 8)
    activeIndex.value = 0
    viewMode.value = 'result'
    if (next.kind === 'frames') startPlay()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '生成失败')
  } finally {
    running.value = false
  }
}

function startPlay(): void {
  stopPlay()
  if (!result.value || result.value.images.length < 2) return
  playing.value = true
  timer = window.setInterval(() => {
    if (!result.value) return
    activeIndex.value = (activeIndex.value + 1) % result.value.images.length
  }, 120)
}

function stopPlay(): void {
  playing.value = false
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

function togglePlay(): void {
  if (playing.value) stopPlay()
  else startPlay()
}

watch(
  () => result.value?.id,
  () => {
    stopPlay()
    activeIndex.value = 0
  },
)

function openHistory(item: RunResult): void {
  stopPlay()
  result.value = item
  activeIndex.value = 0
  viewMode.value = 'result'
  if (item.kind === 'frames') startPlay()
}

/* -------------------------------------------------------------- 结果操作 */

function timestamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function extensionOf(dataUrl: string): string {
  if (dataUrl.startsWith('data:image/png')) return 'png'
  if (dataUrl.startsWith('data:image/webp')) return 'webp'
  return 'jpg'
}

function download(dataUrl: string, index: number): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = `${props.capability.key}-${Date.now()}-${index + 1}.${extensionOf(dataUrl)}`
  link.click()
}

async function save(dataUrl: string, index: number): Promise<void> {
  saving.value = true
  try {
    const asset = await assetApi.upload(
      dataUrl,
      `${props.capability.label}-${timestamp(Date.now())}-${index + 1}.${extensionOf(dataUrl)}`,
      'generate',
    )
    assets.value = [asset, ...assets.value]
    message.success('已存入我的素材')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function saveAll(): Promise<void> {
  if (!result.value) return
  saving.value = true
  try {
    for (let i = 0; i < result.value.images.length; i += 1) {
      const dataUrl = result.value.images[i]!
      await assetApi.upload(
        dataUrl,
        `${props.capability.label}-${timestamp(Date.now())}-${i + 1}.${extensionOf(dataUrl)}`,
        'generate',
      )
    }
    message.success(`已存入我的素材 ${result.value.images.length} 张`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="ai-workspace">
    <!-- 左：源图与结果 -->
    <div class="ai-workspace-main">
      <section v-if="requiresSource" class="ai-card">
        <header class="ai-card-head">
          <h3>源图</h3>
          <span class="ai-card-tag">{{ props.source ? `${props.source.width} × ${props.source.height}` : '未选择' }}</span>
        </header>

        <div
          v-if="!props.source"
          class="ai-drop"
          @dragover.prevent
          @drop="onDrop"
          @click="fileInput?.click()"
        >
          <CloudUploadOutlined style="font-size: 26px" />
          <b>拖入图片，或点击上传</b>
          <span>支持粘贴（Ctrl+V），单张不超过 8MB</span>
        </div>

        <div v-else-if="!showMask && !showRegion" class="ai-source">
          <img :src="props.source.url" :alt="props.source.name" />
        </div>

        <div class="ai-source-tools">
          <button type="button" class="ai-ghost-btn" @click="fileInput?.click()">
            <CloudUploadOutlined />
            本地上传
          </button>
          <button type="button" class="ai-ghost-btn" @click="openAssets">
            <FolderOpenOutlined />
            素材库
          </button>
          <button v-if="props.source" type="button" class="ai-ghost-btn danger" @click="clearSource">
            <DeleteOutlined />
            移除
          </button>
          <span v-if="props.source" class="ai-source-name">{{ props.source.name }}</span>
        </div>

        <AiMaskEditor
          v-if="showMask"
          :src="props.source!.url"
          mode="brush"
          :brush="brushSize"
          @update:mask="mask = $event"
        />
        <AiMaskEditor
          v-else-if="showRegion"
          :src="props.source!.url"
          mode="rect"
          :brush="brushSize"
          @update:region="region = $event"
        />

        <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="onPick" />
      </section>

      <section class="ai-card">
        <header class="ai-card-head">
          <h3>结果</h3>
          <span class="ai-card-tag">
            {{ result ? `${result.note} · ${result.elapsed}ms` : '等待生成' }}
          </span>
        </header>

        <div class="ai-view-toggle">
          <button type="button" :class="{ active: viewMode === 'result' }" @click="viewMode = 'result'">结果</button>
          <button type="button" :class="{ active: viewMode === 'source' }" @click="viewMode = 'source'">原图</button>
          <button
            type="button"
            :class="{ active: viewMode === 'compare' }"
            :disabled="!props.source || !result"
            @click="viewMode = 'compare'"
          >
            对比
          </button>
        </div>

        <a-spin :spinning="running">
          <AiImageCompare :source="props.source?.url ?? null" :result="currentImage" :mode="viewMode" />
        </a-spin>

        <div v-if="result && result.kind === 'frames'" class="ai-frames">
          <button type="button" class="ai-ghost-btn" @click="togglePlay">
            <PlayCircleOutlined v-if="!playing" />
            <PauseCircleOutlined v-else />
            {{ playing ? '暂停' : '播放' }}
          </button>
          <span class="ai-frame-progress">{{ activeIndex + 1 }} / {{ result.images.length }} 帧</span>
        </div>

        <div v-if="result && result.images.length > 1" class="ai-thumbs">
          <button
            v-for="(image, index) in result.images"
            :key="index"
            type="button"
            class="ai-thumb"
            :class="{ active: activeIndex === index }"
            @click="activeIndex = index"
          >
            <img :src="image" :alt="`结果 ${index + 1}`" loading="lazy" />
          </button>
        </div>

        <div v-if="result" class="ai-result-actions">
          <button type="button" class="ai-ghost-btn" :disabled="saving" @click="save(currentImage!, activeIndex)">
            <ThunderboltOutlined />
            存入我的素材
          </button>
          <button type="button" class="ai-ghost-btn" @click="download(currentImage!, activeIndex)">
            <DownloadOutlined />
            下载当前
          </button>
          <button v-if="result.images.length > 1" type="button" class="ai-ghost-btn" :disabled="saving" @click="saveAll">
            全部保存（{{ result.images.length }}）
          </button>
        </div>
      </section>

      <section v-if="history.length" class="ai-card">
        <header class="ai-card-head">
          <h3>本次会话记录</h3>
          <span class="ai-card-tag">{{ history.length }} 条</span>
        </header>
        <div class="ai-thumbs">
          <button
            v-for="item in history"
            :key="item.id"
            type="button"
            class="ai-thumb"
            :class="{ active: result?.id === item.id }"
            :title="`${item.label} · ${item.note} · ${timestamp(item.at)}`"
            @click="openHistory(item)"
          >
            <img :src="item.images[0]" :alt="item.label" loading="lazy" />
          </button>
        </div>
      </section>
    </div>

    <!-- 右：参数 -->
    <aside class="ai-card ai-side-card">
      <header class="ai-card-head">
        <h3>参数</h3>
        <button type="button" class="ai-text-btn" @click="resetValues">
          <ReloadOutlined />
          重置
        </button>
      </header>

      <AiParamFields :capability="props.capability" :values="values" @update:values="values = $event" />

      <button type="button" class="ai-submit" :disabled="running || !canRun" @click="generate">
        <ThunderboltOutlined />
        {{ running ? '生成中…' : `开始${props.capability.label}` }}
      </button>

      <p class="ai-side-note">
        {{ requiresSource ? '结果由本地图像处理链路产出，可直接存入素材库后在画布里使用。' : '无需源图，直接按描述生成。' }}
        接入 AI 服务后，这里会换成真实的模型推理结果。
      </p>
    </aside>

    <a-modal v-model:open="assetOpen" title="从素材库选择" :width="640" :footer="null">
      <div v-if="assetLoading" class="ai-asset-empty">正在读取素材…</div>
      <div v-else-if="!assets.length" class="ai-asset-empty">素材库还是空的，先去画布里导入或上传一张。</div>
      <div v-else class="ai-asset-grid">
        <button v-for="asset in assets" :key="asset.id" type="button" class="ai-asset-card" @click="chooseAsset(asset)">
          <img :src="asset.url" :alt="asset.name" loading="lazy" />
          <span>{{ asset.name }}</span>
        </button>
      </div>
    </a-modal>
  </div>
</template>
