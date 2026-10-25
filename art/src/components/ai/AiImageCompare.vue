<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

/** 结果预览：结果 / 原图 / 左右滑块对比三种视图 */

type ViewMode = 'result' | 'source' | 'compare'

const props = defineProps<{
  source: string | null
  result: string | null
  mode: ViewMode
}>()

const stage = ref<HTMLElement | null>(null)
const position = ref(50)
const dragging = ref(false)

const showCompare = computed(() => props.mode === 'compare' && Boolean(props.source && props.result))
const current = computed(() => (props.mode === 'source' ? props.source : props.result))

function updateFromEvent(event: PointerEvent): void {
  const box = stage.value?.getBoundingClientRect()
  if (!box || box.width === 0) return
  const ratio = ((event.clientX - box.left) / box.width) * 100
  position.value = Math.min(100, Math.max(0, ratio))
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  updateFromEvent(event)
}

function stopDrag(): void {
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', stopDrag)
}

function startDrag(event: PointerEvent): void {
  dragging.value = true
  updateFromEvent(event)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stopDrag)
}

onBeforeUnmount(stopDrag)
</script>

<template>
  <div ref="stage" class="cmp-stage" @pointerdown="showCompare ? startDrag($event) : undefined">
    <template v-if="showCompare">
      <img class="cmp-img" :src="props.source ?? undefined" alt="原图" draggable="false" />
      <div class="cmp-over" :style="{ clipPath: `inset(0 0 0 ${position}%)` }">
        <img class="cmp-img" :src="props.result ?? undefined" alt="结果" draggable="false" />
      </div>
      <span class="cmp-tag cmp-tag-left">原图</span>
      <span class="cmp-tag cmp-tag-right">结果</span>
      <div class="cmp-handle" :style="{ left: `${position}%` }">
        <span class="cmp-grip" />
      </div>
    </template>

    <img v-else-if="current" class="cmp-img" :src="current" alt="预览" draggable="false" />

    <div v-else class="cmp-empty">
      <span>{{ props.mode === 'source' ? '还没有原图，先在左侧上传或选择一张图片' : '设置好参数后点击「开始生成」，结果会显示在这里' }}</span>
    </div>
  </div>
</template>
