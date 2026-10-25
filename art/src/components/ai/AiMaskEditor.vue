<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DeleteOutlined, UndoOutlined } from '@ant-design/icons-vue'
import type { RegionBox } from '@/core/ai/processors'

/**
 * 源图上的区域编辑器。
 * brush=涂抹（涂抹替换用，输出黑底白笔的遮罩），rect=框选（局部细化用，输出归一化选区）。
 */

const props = defineProps<{
  src: string
  mode: 'brush' | 'rect'
  /** 笔刷大小（1~100），由能力的 brush 参数给出 */
  brush: number
}>()

const emit = defineEmits<{
  'update:mask': [mask: string | null]
  'update:region': [region: RegionBox | null]
}>()

const wrap = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const drawing = ref(false)
const erasing = ref(false)
const hasDrawing = ref(false)
const rect = ref<{ x: number; y: number; w: number; h: number } | null>(null)
let startPoint: { x: number; y: number } | null = null

function pointOf(event: PointerEvent): { x: number; y: number } {
  const box = wrap.value?.getBoundingClientRect()
  if (!box) return { x: 0, y: 0 }
  return {
    x: Math.min(box.width, Math.max(0, event.clientX - box.left)),
    y: Math.min(box.height, Math.max(0, event.clientY - box.top)),
  }
}

function geometry(): { width: number; height: number } {
  const box = wrap.value?.getBoundingClientRect()
  return { width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) }
}

function context(): CanvasRenderingContext2D | null {
  return canvas.value?.getContext('2d') ?? null
}

/** 让 canvas 位图尺寸跟随显示尺寸；缩放时保留已有笔迹 */
function syncSize(): void {
  const node = canvas.value
  const ctx = context()
  if (!node || !ctx) return
  const { width, height } = geometry()
  if (!width || !height) return
  const previous = hasDrawing.value ? node.toDataURL('image/png') : null
  node.width = width
  node.height = height
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)
  if (previous) {
    const image = new Image()
    image.onload = () => ctx.drawImage(image, 0, 0, width, height)
    image.src = previous
  }
}

function stroke(point: { x: number; y: number }, move: boolean): void {
  const ctx = context()
  if (!ctx) return
  ctx.lineWidth = 4 + props.brush * 0.6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = erasing.value ? '#000000' : '#ffffff'
  if (move) {
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
  }
}

function emitMask(): void {
  if (props.mode !== 'brush') return
  hasDrawing.value = true
  emit('update:mask', canvas.value?.toDataURL('image/png') ?? null)
}

function emitRect(): void {
  if (props.mode !== 'rect' || !rect.value) return
  const { width, height } = geometry()
  if (!width || !height) return
  emit('update:region', {
    x: rect.value.x / width,
    y: rect.value.y / height,
    w: rect.value.w / width,
    h: rect.value.h / height,
  })
}

function onDown(event: PointerEvent): void {
  startPoint = pointOf(event)
  if (props.mode === 'brush') {
    drawing.value = true
    stroke(startPoint, false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  } else {
    rect.value = { x: startPoint.x, y: startPoint.y, w: 0, h: 0 }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
}

function onMove(event: PointerEvent): void {
  const point = pointOf(event)
  if (props.mode === 'brush') {
    if (!drawing.value) return
    stroke(point, true)
    return
  }
  if (!startPoint) return
  rect.value = {
    x: Math.min(startPoint.x, point.x),
    y: Math.min(startPoint.y, point.y),
    w: Math.abs(point.x - startPoint.x),
    h: Math.abs(point.y - startPoint.y),
  }
}

function onUp(): void {
  startPoint = null
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  if (props.mode === 'brush') {
    drawing.value = false
    emitMask()
  } else {
    emitRect()
  }
}

function clear(): void {
  const ctx = context()
  const { width, height } = geometry()
  if (ctx && width && height) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)
  }
  hasDrawing.value = false
  rect.value = null
  emit('update:mask', null)
  emit('update:region', null)
}

let observer: ResizeObserver | null = null

onMounted(() => {
  syncSize()
  if (typeof ResizeObserver !== 'undefined' && wrap.value) {
    observer = new ResizeObserver(() => syncSize())
    observer.observe(wrap.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
})

watch(
  () => props.src,
  () => {
    requestAnimationFrame(() => {
      clear()
      syncSize()
    })
  },
)
</script>

<template>
  <div class="mask-editor">
    <div ref="wrap" class="mask-stage" @pointerdown="onDown">
      <img :src="props.src" alt="源图" draggable="false" @load="syncSize" />
      <canvas v-show="props.mode === 'brush'" ref="canvas" class="mask-canvas" />
      <div
        v-if="props.mode === 'rect' && rect"
        class="mask-rect"
        :style="{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` }"
      />
    </div>

    <div class="mask-tools">
      <template v-if="props.mode === 'brush'">
        <button type="button" class="mask-tool" :class="{ active: !erasing }" @click="erasing = false">画笔</button>
        <button type="button" class="mask-tool" :class="{ active: erasing }" @click="erasing = true">
          <UndoOutlined />
          橡皮
        </button>
      </template>
      <span v-else class="mask-hint">在图上拖拽框选要细化的区域</span>
      <button type="button" class="mask-tool" @click="clear">
        <DeleteOutlined />
        清空
      </button>
    </div>
  </div>
</template>
