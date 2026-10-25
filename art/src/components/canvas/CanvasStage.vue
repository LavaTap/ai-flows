<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CanvasEngine, type ViewportState } from '@/core/canvas/CanvasEngine'
import { DEFAULT_STYLE, type EngineSnapshot, type ShapeStyle, type ToolName } from '@/types/board'

const props = withDefaults(
  defineProps<{
    style?: ShapeStyle
    empty?: boolean
  }>(),
  {
    style: () => ({ ...DEFAULT_STYLE }),
    empty: false,
  },
)

const emit = defineEmits<{
  ready: [engine: CanvasEngine]
  imageFile: [payload: { file: File; clientX?: number; clientY?: number }]
}>()

const host = ref<HTMLDivElement | null>(null)
const canvasElement = ref<HTMLCanvasElement | null>(null)
const viewport = ref<ViewportState>({
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  panning: false,
  spacePressed: false,
})
const tool = ref<ToolName>('select')

let engine: CanvasEngine | null = null

const gridStyle = computed(() => {
  const zoom = viewport.value.zoom
  const minor = (engine?.gridSize ?? 24) * zoom
  const major = minor * 4
  const position = `${viewport.value.offsetX}px ${viewport.value.offsetY}px`
  return {
    backgroundSize: `${minor}px ${minor}px, ${major}px ${major}px`,
    backgroundPosition: `${position}, ${position}`,
  }
})

const stageClass = computed(() => [
  `tool-${tool.value}`,
  {
    'is-panning': viewport.value.panning,
    'is-space': viewport.value.spacePressed && !viewport.value.panning,
  },
])

function handleWheel(event: WheelEvent): void {
  engine?.handleWheel(event)
}

function handleDrop(event: DragEvent): void {
  const file = event.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith('image/')) return
  // 插入前先交给父组件登记到「我的素材」，再由父组件放上画布
  emit('imageFile', { file, clientX: event.clientX, clientY: event.clientY })
}

function handlePaste(event: ClipboardEvent): void {
  const items = Array.from(event.clipboardData?.items ?? [])
  const imageItem = items.find((item) => item.type.startsWith('image/'))
  const file = imageItem?.getAsFile()
  if (!file) return
  event.preventDefault()
  emit('imageFile', { file })
}

onMounted(() => {
  if (!host.value || !canvasElement.value) return
  const instance = new CanvasEngine(host.value, canvasElement.value, { style: props.style })
  engine = instance

  instance.onViewport((next) => {
    viewport.value = next
  })
  instance.subscribe((snapshot: EngineSnapshot) => {
    tool.value = snapshot.tool
  })

  window.addEventListener('paste', handlePaste)
  emit('ready', instance)
})

onBeforeUnmount(() => {
  window.removeEventListener('paste', handlePaste)
  engine?.destroy()
  engine = null
})
</script>

<template>
  <div
    ref="host"
    class="stage"
    :class="stageClass"
    @wheel="handleWheel"
    @dragover.prevent
    @drop.prevent="handleDrop"
  >
    <div class="stage-grid" :style="gridStyle" />
    <canvas ref="canvasElement" />

    <div v-if="empty" class="stage-hint">
      <h3>开始你的第一笔</h3>
      <p>
        右键唤起 AI 工具 · 拖入或粘贴图片<br />
        左侧工具栏选「文字」添加文字 · 滚轮缩放 · <kbd>空格</kbd> 拖拽平移
      </p>
    </div>
  </div>
</template>
