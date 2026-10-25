<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowLeftOutlined,
  BorderOutlined,
  DownloadOutlined,
  FullscreenOutlined,
  RedoOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  UndoOutlined,
} from '@ant-design/icons-vue'
import type { SaveState } from '@/types/board'

const props = defineProps<{
  name: string
  saveState: SaveState
  canUndo: boolean
  canRedo: boolean
  hasArtboard: boolean
}>()

const emit = defineEmits<{
  back: []
  rename: [name: string]
  save: []
  undo: []
  redo: []
  export: [kind: 'png' | 'png-board' | 'json']
  artboard: []
  fit: []
}>()

const exportItems = computed(() => [
  { key: 'png', label: '导出 PNG（内容）', onClick: () => emit('export', 'png') },
  {
    key: 'png-board',
    label: '导出 PNG（画板区域）',
    disabled: !props.hasArtboard,
    onClick: () => emit('export', 'png-board'),
  },
  { key: 'json', label: '导出 JSON 源文件', onClick: () => emit('export', 'json') },
])

const draftName = ref(props.name)
const focused = ref(false)

watch(
  () => props.name,
  (value) => {
    if (!focused.value) draftName.value = value
  },
)

const saveText = computed(() => {
  switch (props.saveState) {
    case 'saving':
      return '保存中'
    case 'saved':
      return '已保存'
    case 'error':
      return '保存失败'
    default:
      return '本地草稿'
  }
})

function commitName(): void {
  focused.value = false
  const value = draftName.value.trim()
  if (!value) {
    draftName.value = props.name
    return
  }
  if (value !== props.name) emit('rename', value)
}

function onEnter(event: KeyboardEvent): void {
  ;(event.target as HTMLInputElement).blur()
}
</script>

<template>
  <header class="editor-header">
    <a-tooltip title="返回画板列表">
      <a-button type="text" size="small" @click="emit('back')">
        <template #icon><ArrowLeftOutlined /></template>
      </a-button>
    </a-tooltip>

    <div class="brand-mark" style="width: 30px; height: 30px; border-radius: 9px" />

    <a-input
      v-model:value="draftName"
      class="board-name-input"
      :maxlength="60"
      @focus="focused = true"
      @blur="commitName"
      @press-enter="onEnter"
    />

    <span class="save-badge">
      <i class="save-dot" :class="props.saveState" />
      {{ saveText }}
    </span>

    <div class="header-spacer" />

    <div class="header-actions">
      <a-tooltip title="AI 工作台">
        <router-link to="/ai/draft" class="icon-btn ai-entry">
          <ThunderboltOutlined />
        </router-link>
      </a-tooltip>

      <span class="header-divider" />

      <a-tooltip title="撤销 · Ctrl+Z">
        <a-button type="text" size="small" :disabled="!props.canUndo" @click="emit('undo')">
          <template #icon><UndoOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip title="重做 · Ctrl+Shift+Z">
        <a-button type="text" size="small" :disabled="!props.canRedo" @click="emit('redo')">
          <template #icon><RedoOutlined /></template>
        </a-button>
      </a-tooltip>

      <span class="header-divider" />

      <a-tooltip title="适应画布内容 · Ctrl+1">
        <a-button type="text" size="small" @click="emit('fit')">
          <template #icon><FullscreenOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-tooltip title="画板尺寸">
        <a-button type="text" size="small" @click="emit('artboard')">
          <template #icon><BorderOutlined /></template>
        </a-button>
      </a-tooltip>
      <a-dropdown :trigger="['click']" placement="bottomRight">
        <a-button type="text" size="small" title="导出">
          <template #icon><DownloadOutlined /></template>
        </a-button>
        <template #overlay>
          <a-menu :items="exportItems" />
        </template>
      </a-dropdown>
      <a-tooltip title="保存 · Ctrl+S">
        <a-button type="primary" size="small" @click="emit('save')">
          <template #icon><SaveOutlined /></template>
          保存
        </a-button>
      </a-tooltip>
    </div>
  </header>
</template>
