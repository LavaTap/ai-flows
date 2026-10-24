<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import {
  AppstoreOutlined,
  BorderOutlined,
  DownOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  FontSizeOutlined,
  HighlightOutlined,
  LockOutlined,
  MoreOutlined,
  PictureOutlined,
  RightOutlined,
  UnlockOutlined,
} from '@ant-design/icons-vue'
import {
  canMoveNode,
  collectEffectiveStates,
  flattenTree,
  type FlatLayerRow,
} from '@/core/layers/tree'
import type { LayerInfo, LayerKind, LayerNode } from '@/types/board'

const props = defineProps<{
  tree: LayerNode[]
  layers: LayerInfo[]
  selectedIds: string[]
  maxDepth: number
}>()

const emit = defineEmits<{
  select: [id: string]
  'create-folder': [parentId: string | null]
  rename: [id: string, name: string]
  remove: [id: string]
  move: [id: string, targetFolderId: string | null]
  'toggle-visible': [id: string]
  'toggle-lock': [id: string]
  'toggle-collapse': [id: string]
}>()

const rows = computed(() => flattenTree(props.tree))
const layerMap = computed(() => new Map(props.layers.map((layer) => [layer.id, layer])))
const effective = computed(() => collectEffectiveStates(props.tree))
const layerCount = computed(() => rows.value.filter((row) => row.node.type === 'layer').length)

const icons: Record<LayerKind, Component> = {
  text: FontSizeOutlined,
  image: PictureOutlined,
  path: HighlightOutlined,
  group: AppstoreOutlined,
  shape: BorderOutlined,
  other: BorderOutlined,
}

const editingId = ref<string | null>(null)
const draftName = ref('')
const draggingId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)
const rootHover = ref(false)

const vFocus = {
  mounted(element: HTMLInputElement) {
    // 等双击的默认选词结束后再聚焦全选，避免光标落到末尾
    requestAnimationFrame(() => {
      element.focus()
      element.select()
    })
  },
}

function nameOf(row: FlatLayerRow): string {
  if (row.node.type === 'folder') return row.node.name
  return layerMap.value.get(row.node.id)?.name ?? '已删除对象'
}

function kindOf(row: FlatLayerRow): LayerKind {
  if (row.node.type === 'folder') return 'other'
  return layerMap.value.get(row.node.id)?.kind ?? 'other'
}

function iconOf(row: FlatLayerRow): Component {
  if (row.node.type === 'folder') return row.node.collapsed ? FolderOutlined : FolderOpenOutlined
  return icons[kindOf(row)] ?? BorderOutlined
}

function stateOf(node: LayerNode): { visible: boolean; locked: boolean } {
  return effective.value[node.id] ?? { visible: node.visible, locked: node.locked }
}

function onRowClick(row: FlatLayerRow): void {
  if (row.node.type === 'folder') {
    emit('toggle-collapse', row.node.id)
    return
  }
  emit('select', row.node.id)
}

function startRename(row: FlatLayerRow): void {
  editingId.value = row.node.id
  draftName.value = nameOf(row)
}

function commitRename(): void {
  const id = editingId.value
  if (!id) return
  editingId.value = null
  const name = draftName.value.trim()
  if (name) emit('rename', id, name)
}

function cancelRename(): void {
  editingId.value = null
}

function onRenameKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    ;(event.target as HTMLInputElement).blur()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}

function onMenu(info: { key: string | number }, row: FlatLayerRow): void {
  const key = String(info.key)
  if (key === 'rename') startRename(row)
  else if (key === 'child') emit('create-folder', row.node.id)
  else if (key === 'remove') emit('remove', row.node.id)
}

function canDrop(id: string, targetFolderId: string | null): boolean {
  return canMoveNode(props.tree, id, targetFolderId)
}

function onDragStart(event: DragEvent, row: FlatLayerRow): void {
  if (editingId.value) {
    event.preventDefault()
    return
  }
  draggingId.value = row.node.id
  event.dataTransfer?.setData('text/plain', row.node.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragEnd(): void {
  draggingId.value = null
  dropTargetId.value = null
  rootHover.value = false
}

function onFolderDragOver(event: DragEvent, row: FlatLayerRow): void {
  if (row.node.type !== 'folder' || !draggingId.value) return
  if (!canDrop(draggingId.value, row.node.id)) return
  event.preventDefault()
  dropTargetId.value = row.node.id
}

function onFolderDragLeave(row: FlatLayerRow): void {
  if (dropTargetId.value === row.node.id) dropTargetId.value = null
}

function onFolderDrop(event: DragEvent, row: FlatLayerRow): void {
  if (row.node.type !== 'folder') return
  event.preventDefault()
  const id = draggingId.value
  if (id && canDrop(id, row.node.id)) emit('move', id, row.node.id)
  onDragEnd()
}

function onRootDragOver(event: DragEvent): void {
  if (!draggingId.value) return
  event.preventDefault()
  rootHover.value = true
  dropTargetId.value = null
}

function onRootDrop(event: DragEvent): void {
  event.preventDefault()
  const id = draggingId.value
  if (id) emit('move', id, null)
  onDragEnd()
}

function onRootDragLeave(): void {
  rootHover.value = false
}
</script>

<template>
  <div class="panel-scroll">
    <div
      class="panel-title layer-head"
      :class="{ 'drop-root': rootHover }"
      @dragover="onRootDragOver"
      @dragleave="onRootDragLeave"
      @drop="onRootDrop"
    >
      <span>{{ rootHover ? '移出到顶层' : '图层' }}</span>
      <span>{{ layerCount }}</span>
    </div>

    <button type="button" class="folder-create" @click="emit('create-folder', null)">
      <FolderAddOutlined />
      新建文件夹
    </button>

    <div v-if="rows.length" class="layer-list">
      <div
        v-for="row in rows"
        :key="row.node.id"
        class="layer-row"
        :class="{
          active: row.node.type === 'layer' && props.selectedIds.includes(row.node.id),
          'is-folder': row.node.type === 'folder',
          hidden: !stateOf(row.node).visible,
          locked: stateOf(row.node).locked,
          dragging: draggingId === row.node.id,
          'drop-target': dropTargetId === row.node.id,
        }"
        :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
        :data-node-id="row.node.id"
        :data-node-type="row.node.type"
        :draggable="editingId !== row.node.id"
        @dragstart="onDragStart($event, row)"
        @dragend="onDragEnd"
        @dragover="onFolderDragOver($event, row)"
        @dragleave="onFolderDragLeave(row)"
        @drop="onFolderDrop($event, row)"
        @click="onRowClick(row)"
      >
        <button
          v-if="row.node.type === 'folder'"
          type="button"
          class="layer-chevron"
          :title="row.node.collapsed ? '展开' : '折叠'"
          @click.stop="emit('toggle-collapse', row.node.id)"
        >
          <RightOutlined v-if="row.node.collapsed" />
          <DownOutlined v-else />
        </button>
        <span v-else class="layer-chevron placeholder" />

        <span class="layer-kind" :class="{ 'is-folder': row.node.type === 'folder' }">
          <component :is="iconOf(row)" />
        </span>

        <input
          v-if="editingId === row.node.id"
          v-focus
          v-model="draftName"
          class="layer-rename-input"
          maxlength="40"
          @click.stop
          @dblclick.stop
          @blur="commitRename"
          @keydown="onRenameKeydown"
        />
        <span
          v-else
          class="layer-name"
          :title="`${nameOf(row)}（双击重命名）`"
          @dblclick.stop="startRename(row)"
        >
          {{ nameOf(row) }}
        </span>

        <span class="layer-actions">
          <button
            type="button"
            class="layer-action"
            :title="row.node.visible ? '隐藏' : '显示'"
            @click.stop="emit('toggle-visible', row.node.id)"
          >
            <EyeOutlined v-if="row.node.visible" />
            <EyeInvisibleOutlined v-else />
          </button>
          <button
            type="button"
            class="layer-action"
            :title="row.node.locked ? '解锁' : '锁定'"
            @click.stop="emit('toggle-lock', row.node.id)"
          >
            <LockOutlined v-if="row.node.locked" />
            <UnlockOutlined v-else />
          </button>

          <a-dropdown :trigger="['click']" placement="bottomRight">
            <button type="button" class="layer-action" title="更多" @click.stop>
              <MoreOutlined />
            </button>
            <template #overlay>
              <a-menu @click="onMenu($event, row)">
                <a-menu-item key="rename">重命名</a-menu-item>
                <a-menu-item
                  v-if="row.node.type === 'folder'"
                  key="child"
                  :disabled="row.depth + 2 > props.maxDepth"
                >
                  新建子文件夹
                </a-menu-item>
                <a-menu-divider v-if="row.node.type === 'folder'" />
                <a-menu-item key="remove">
                  {{ row.node.type === 'folder' ? '解散文件夹' : '删除图层' }}
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </span>
      </div>
    </div>

    <div v-else class="panel-empty">
      画布还是空的<br />
      从左侧选择工具开始绘制，或先新建一个文件夹
    </div>

    <div v-if="draggingId" class="panel-note">
      拖到文件夹上可归类；拖到上方标题栏可移出文件夹。文件夹最多 {{ props.maxDepth }} 层。
    </div>
  </div>
</template>
