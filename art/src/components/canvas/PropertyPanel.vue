<script setup lang="ts">
import { computed } from 'vue'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  DeleteOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons-vue'
import type { SelectionInfo, ShapeStyle } from '@/types/board'

const props = defineProps<{ selection: SelectionInfo | null }>()

const emit = defineEmits<{
  patch: [patch: Partial<ShapeStyle>]
  delete: []
  duplicate: []
  move: [direction: 'up' | 'down' | 'top' | 'bottom']
}>()

const style = computed(() => props.selection?.style)

function safeHex(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

const fillColor = computed(() => safeHex(style.value?.fill, '#7c8cff'))
const strokeColor = computed(() => safeHex(style.value?.stroke, '#dfe4ff'))

function onOpacity(value: number | number[]): void {
  const next = Array.isArray(value) ? value[0] : value
  emit('patch', { opacity: Number(next) / 100 })
}

function onFontSize(value: number | number[]): void {
  const next = Array.isArray(value) ? value[0] : value
  emit('patch', { fontSize: Number(next) })
}

function onStrokeWidth(value: number | number[]): void {
  const next = Array.isArray(value) ? value[0] : value
  emit('patch', { strokeWidth: Number(next) })
}
</script>

<template>
  <div class="panel-scroll">
    <template v-if="props.selection && style">
      <div class="panel-title">
        <span>{{ props.selection.typeLabel }}</span>
        <span>{{ props.selection.kind === 'image' ? '位图' : '矢量' }}</span>
      </div>

      <template v-if="props.selection.kind !== 'image'">
        <div class="field-label">
          <span>{{ props.selection.kind === 'text' ? '文字颜色' : '填充' }}</span>
          <span>{{ fillColor }}</span>
        </div>
        <div class="color-field">
          <input
            type="color"
            :value="fillColor"
            @input="emit('patch', { fill: ($event.target as HTMLInputElement).value })"
          />
          <input
            class="hex-input"
            :value="fillColor"
            @change="emit('patch', { fill: ($event.target as HTMLInputElement).value })"
          />
        </div>

        <template v-if="props.selection.kind !== 'text'">
          <div class="field-label">
            <span>描边</span>
            <span>{{ strokeColor }}</span>
          </div>
          <div class="color-field">
            <input
              type="color"
              :value="strokeColor"
              @input="emit('patch', { stroke: ($event.target as HTMLInputElement).value })"
            />
            <input
              class="hex-input"
              :value="strokeColor"
              @change="emit('patch', { stroke: ($event.target as HTMLInputElement).value })"
            />
          </div>

          <div class="field-label">
            <span>描边宽度</span>
            <span>{{ style.strokeWidth }} px</span>
          </div>
          <a-slider
            :value="style.strokeWidth"
            :min="0"
            :max="24"
            :step="1"
            @change="onStrokeWidth"
          />
        </template>

        <template v-if="props.selection.kind === 'text'">
          <div class="field-label">
            <span>字号</span>
            <span>{{ style.fontSize }} px</span>
          </div>
          <a-slider :value="style.fontSize" :min="12" :max="160" :step="2" @change="onFontSize" />
        </template>
      </template>

      <div class="field-label">
        <span>不透明度</span>
        <span>{{ Math.round(style.opacity * 100) }}%</span>
      </div>
      <a-slider :value="Math.round(style.opacity * 100)" :min="5" :max="100" @change="onOpacity" />

      <div class="prop-actions">
        <a-button size="small" @click="emit('duplicate')">
          <template #icon><CopyOutlined /></template>
          复制
        </a-button>
        <a-button size="small" danger @click="emit('delete')">
          <template #icon><DeleteOutlined /></template>
          删除
        </a-button>
        <a-button size="small" @click="emit('move', 'up')">
          <template #icon><ArrowUpOutlined /></template>
          上移
        </a-button>
        <a-button size="small" @click="emit('move', 'down')">
          <template #icon><ArrowDownOutlined /></template>
          下移
        </a-button>
        <a-button size="small" @click="emit('move', 'top')">
          <template #icon><VerticalAlignTopOutlined /></template>
          置顶
        </a-button>
        <a-button size="small" @click="emit('move', 'bottom')">
          <template #icon><VerticalAlignBottomOutlined /></template>
          置底
        </a-button>
      </div>

      <div class="panel-note">
        提示：按住 <b>Shift</b> 可等比例缩放；<b>Ctrl+D</b> 快速复制；双击文字进入编辑。
      </div>
    </template>

    <div v-else class="panel-empty">
      未选中对象<br />
      在画布中点选元素后可调整样式
    </div>
  </div>
</template>
