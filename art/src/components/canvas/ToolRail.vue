<script setup lang="ts">
import type { Component } from 'vue'
import {
  AimOutlined,
  ArrowRightOutlined,
  BorderOutlined,
  ClearOutlined,
  DragOutlined,
  FontSizeOutlined,
  HighlightOutlined,
  MinusOutlined,
  PictureOutlined,
  RadiusSettingOutlined,
} from '@ant-design/icons-vue'
import type { ToolName } from '@/types/board'

interface RailItem {
  tool: ToolName | 'image'
  label: string
  shortcut: string
  icon: Component
  upload?: boolean
}

const props = defineProps<{ tool: ToolName }>()
const emit = defineEmits<{ 'update:tool': [tool: ToolName]; upload: [] }>()

const items: RailItem[] = [
  { tool: 'select', label: '选择', shortcut: 'V', icon: AimOutlined },
  { tool: 'hand', label: '抓手（平移）', shortcut: 'H', icon: DragOutlined },
  { tool: 'rect', label: '矩形', shortcut: 'R', icon: BorderOutlined },
  { tool: 'ellipse', label: '椭圆', shortcut: 'O', icon: RadiusSettingOutlined },
  { tool: 'line', label: '直线', shortcut: 'L', icon: MinusOutlined },
  { tool: 'arrow', label: '箭头', shortcut: 'A', icon: ArrowRightOutlined },
  { tool: 'text', label: '文字', shortcut: 'T', icon: FontSizeOutlined },
  { tool: 'pen', label: '画笔', shortcut: 'P', icon: HighlightOutlined },
  { tool: 'eraser', label: '橡皮（对象擦除）', shortcut: 'E', icon: ClearOutlined },
  { tool: 'image', label: '插入图片', shortcut: '拖入 / 粘贴', icon: PictureOutlined, upload: true },
]

function activate(item: RailItem): void {
  if (item.upload || item.tool === 'image') {
    emit('upload')
    return
  }
  emit('update:tool', item.tool)
}
</script>

<template>
  <div class="tool-rail">
    <a-tooltip
      v-for="item in items"
      :key="item.tool"
      placement="right"
      :title="`${item.label} · ${item.shortcut}`"
    >
      <button
        type="button"
        class="rail-btn"
        :class="{ active: !item.upload && props.tool === item.tool }"
        @click="activate(item)"
      >
        <component :is="item.icon" />
      </button>
    </a-tooltip>
  </div>
</template>
