<script setup lang="ts">
import { computed } from 'vue'
import { CloseOutlined } from '@ant-design/icons-vue'
import { AI_CAPABILITIES } from '@/core/ai/capabilities'
import { aiIconOf } from '@/core/ai/icons'
import type { AiToolCard } from '@/types/board'

const props = defineProps<{
  card: AiToolCard
  /** 屏幕上左上角锚点（由场景坐标经视口换算） */
  x: number
  y: number
  zoom: number
}>()

const emit = defineEmits<{
  move: [x: number, y: number]
  values: [values: Record<string, string | number>]
  close: []
}>()

const capability = computed(
  () => AI_CAPABILITIES.find((item) => item.key === props.card.capability) ?? null,
)

/** 面板作为画布内容随视口缩放：以左上角为锚点，尺寸与位置同步跟随 zoom */
const panelStyle = computed(() => ({
  left: `${props.x}px`,
  top: `${props.y}px`,
  transform: `scale(${props.zoom || 1})`,
  transformOrigin: '0 0',
}))

function stringValue(key: string): string {
  const value = props.card.values[key]
  return value === undefined ? '' : String(value)
}

function numberValue(key: string): number {
  const value = Number(props.card.values[key])
  return Number.isFinite(value) ? value : 0
}

function setValue(key: string, value: string | number): void {
  emit('values', { ...props.card.values, [key]: value })
}

let dragStart = { x: 0, y: 0, left: 0, top: 0 }

function startDrag(event: PointerEvent): void {
  dragStart = { x: event.clientX, y: event.clientY, left: props.card.x, top: props.card.y }
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', endDrag, { once: true })
}

function onDrag(event: PointerEvent): void {
  const zoom = props.zoom || 1
  emit(
    'move',
    dragStart.left + (event.clientX - dragStart.x) / zoom,
    dragStart.top + (event.clientY - dragStart.y) / zoom,
  )
}

function endDrag(): void {
  window.removeEventListener('pointermove', onDrag)
}
</script>

<template>
  <div
    class="ai-canvas-panel"
    :style="panelStyle"
    @pointerdown.stop
  >
    <div class="ai-canvas-panel-head" @pointerdown="startDrag">
      <span class="ai-canvas-panel-icon">
        <component :is="aiIconOf(capability?.icon ?? '')" />
      </span>
      <span class="ai-canvas-panel-title">{{ capability?.label ?? 'AI 工具' }}</span>
      <button
        type="button"
        class="ai-canvas-panel-close"
        title="关闭"
        @pointerdown.stop
        @click="emit('close')"
      >
        <CloseOutlined />
      </button>
    </div>

    <div v-if="capability" class="ai-canvas-panel-body">
      <p class="ai-dialog-desc">{{ capability.desc }}</p>
      <div class="ai-dialog-hint">该能力界面已就绪，接入 AI 服务后即可使用。</div>

      <div v-for="field in capability.fields" :key="field.key" class="ai-field">
        <div class="field-label">
          <span>{{ field.label }}</span>
          <span v-if="field.kind === 'range'" class="ai-range-value">{{ numberValue(field.key) }}</span>
        </div>

        <a-select
          v-if="field.kind === 'select'"
          size="small"
          style="width: 100%"
          :value="stringValue(field.key)"
          :options="field.options"
          @update:value="(value: string) => setValue(field.key, value)"
        />

        <a-slider
          v-else-if="field.kind === 'range'"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :value="numberValue(field.key)"
          @update:value="(value: number) => setValue(field.key, value)"
        />

        <div v-else-if="field.kind === 'chips'" class="ai-chips">
          <button
            v-for="option in field.options"
            :key="option"
            type="button"
            class="ai-chip"
            :class="{ active: stringValue(field.key) === option }"
            @click="setValue(field.key, option)"
          >
            {{ option }}
          </button>
        </div>

        <a-textarea
          v-else
          :rows="3"
          :maxlength="120"
          :value="stringValue(field.key)"
          :placeholder="field.placeholder"
          @update:value="(value: string) => setValue(field.key, value)"
        />
      </div>
    </div>

    <div class="ai-canvas-panel-foot">
      <a-button size="small" type="primary" disabled>提交（AI 能力待接入）</a-button>
    </div>
  </div>
</template>
