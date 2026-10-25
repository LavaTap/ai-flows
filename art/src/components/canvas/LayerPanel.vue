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
  canMoveNodes,
  collectEffectiveStates,
  flattenTree,
  sanitizeMoveIds,
  type FlatLayerRow,
  type MoveTarget,
} from '@/core/layers/tree'
import type { LayerInfo, LayerKind, LayerNode } from '@/types/board'

const props = defineProps<{
  tree: LayerNode[]
  layers: LayerInfo[]
  selectedIds: string[]
  maxDepth: number
}>()

const emit = defineEmits<{
  select: [payload: { id: string; additive: boolean }]
  'create-folder': [parentId: string | null]
  rename: [id: string, name: string]
  remove: [id: string]
  move: [payload: { ids: string[] } & MoveTarget]
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
const dragIds = ref<string[]>([])
const dropZone = ref<{ id: string; mode: 'before' | 'after' | 'inside' } | null>(null)
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

function onRowClick(row: FlatLayerRow, event: MouseEvent): void {
  emit('select', { id: row.node.id, additive: event.shiftKey })
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

function canDrop(ids: string[], parentId: string | null): boolean {
  return canMoveNodes(props.tree, ids, parentId)
}

function clearDrop(): void {
  dropZone.value = null
  rootHover.value = false
}

/** 同一父级里排在该行后面那一个兄弟节点；没有则落到该层末尾 */
function nextSiblingId(row: FlatLayerRow): string | null {
  const index = rows.value.findIndex((item) => item.node.id === row.node.id)
  for (let i = index + 1; i < rows.value.length; i += 1) {
    const candidate = rows.value[i]
    if (!candidate) continue
    if (candidate.depth === row.depth) return candidate.node.id
    if (candidate.depth < row.depth) return null
  }
  return null
}

/** 命中位置：文件夹上/下 1/3 为同级前后，中间为放入文件夹内部 */
function resolveDrop(
  row: FlatLayerRow,
  ratio: number,
): { target: MoveTarget; mode: 'before' | 'after' | 'inside' } | null {
  if (row.node.type === 'folder') {
    if (ratio >= 0.3 && ratio <= 0.7) {
      const first = row.node.children[0]
      return {
        target: { parentId: row.node.id, beforeId: first ? first.id : null },
        mode: 'inside',
      }
    }
    return ratio < 0.3
      ? { target: { parentId: row.parentId, beforeId: row.node.id }, mode: 'before' }
      : { target: { parentId: row.parentId, beforeId: nextSiblingId(row) }, mode: 'after' }
  }
  return ratio < 0.5
    ? { target: { parentId: row.parentId, beforeId: row.node.id }, mode: 'before' }
    : { target: { parentId: row.parentId, beforeId: nextSiblingId(row) }, mode: 'after' }
}

function onDragStart(event: DragEvent, row: FlatLayerRow): void {
  if (editingId.value) {
    event.preventDefault()
    return
  }
  const selected = props.selectedIds.includes(row.node.id)
    ? props.selectedIds
    : [row.node.id]
  dragIds.value = sanitizeMoveIds(props.tree, selected)
  event.dataTransfer?.setData('text/plain', dragIds.value.join(','))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragEnd(): void {
  dragIds.value = []
  dropZone.value = null
  rootHover.value = false
}

function onRowDragOver(event: DragEvent, row: FlatLayerRow): void {
  if (!dragIds.value.length) return
  const element = event.currentTarget as HTMLElement
  const rect = element.getBoundingClientRect()
  const ratio = (event.clientY - rect.top) / Math.max(1, rect.height)
  const hit = resolveDrop(row, ratio)

  const invalid =
    !hit ||
    dragIds.value.includes(row.node.id) ||
    (hit.target.beforeId ? dragIds.value.includes(hit.target.beforeId) : false) ||
    !canDrop(dragIds.value, hit.target.parentId)
  if (invalid) {
    clearDrop()
    return
  }

  event.preventDefault()
  event.stopPropagation()
  dropZone.value = { id: row.node.id, mode: hit.mode }
  rootHover.value = false
}

function onRowDragLeave(row: FlatLayerRow): void {
  if (dropZone.value?.id === row.node.id) dropZone.value = null
}

function onRowDrop(event: DragEvent, row: FlatLayerRow): void {
  event.preventDefault()
  event.stopPropagation()
  const zone = dropZone.value
  if (zone?.id === row.node.id && dragIds.value.length) {
    const element = event.currentTarget as HTMLElement
    const rect = element.getBoundingClientRect()
    const ratio = (event.clientY - rect.top) / Math.max(1, rect.height)
    const hit = resolveDrop(row, ratio)
    if (hit && canDrop(dragIds.value, hit.target.parentId)) {
      emit('move', { ids: dragIds.value, ...hit.target })
    }
  }
  onDragEnd()
}

function onRootDragOver(event: DragEvent): void {
  if (!dragIds.value.length) return
  if (!canDrop(dragIds.value, null)) return
  event.preventDefault()
  rootHover.value = true
  dropZone.value = null
}

function onRootDrop(event: DragEvent): void {
  event.preventDefault()
  if (dragIds.value.length && canDrop(dragIds.value, null)) {
    const first = props.tree[0]
    emit('move', {
      ids: dragIds.value,
      parentId: null,
      beforeId: first ? first.id : null,
    })
  }
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
          active: props.selectedIds.includes(row.node.id),
          'is-folder': row.node.type === 'folder',
          hidden: !stateOf(row.node).visible,
          locked: stateOf(row.node).locked,
          dragging: dragIds.includes(row.node.id),
          'drop-target': dropZone?.id === row.node.id && dropZone.mode === 'inside',
          'drop-before': dropZone?.id === row.node.id && dropZone.mode === 'before',
          'drop-after': dropZone?.id === row.node.id && dropZone.mode === 'after',
        }"
        :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
        :data-node-id="row.node.id"
        :data-node-type="row.node.type"
        :draggable="editingId !== row.node.id"
        @dragstart="onDragStart($event, row)"
        @dragend="onDragEnd"
        @dragover="onRowDragOver($event, row)"
        @dragleave="onRowDragLeave(row)"
        @drop="onRowDrop($event, row)"
        @click="onRowClick(row, $event)"
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

    <div v-if="dragIds.length" class="panel-note">
      拖到行上半区插到前面、下半区插到后面；拖到文件夹中间放入该文件夹；拖到标题栏移出到顶层。
      按住 Shift 点选可多选，多个图层/文件夹会一起移动。文件夹最多 {{ props.maxDepth }} 层。
    </div>
  </div>
</template>
