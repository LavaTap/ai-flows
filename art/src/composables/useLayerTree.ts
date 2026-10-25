import { ref } from 'vue'
import type { CanvasEngine } from '@/core/canvas/CanvasEngine'
import type { LayerEntry, LayerNode } from '@/types/board'
import {
  MAX_FOLDER_DEPTH,
  canMoveNodes,
  collectEffectiveStates,
  detachNode,
  dissolveFolder,
  findNode,
  flattenLayerIds,
  insertNode,
  layerIdsOf,
  moveLayerNodes,
  type MoveTarget,
  newFolderId,
  nextFolderName,
  normalizeTree,
  patchNode,
  pruneLayers,
  reorderNode,
} from '@/core/layers/tree'

interface LayerTreeOptions {
  onChange?: () => void
}

/**
 * 图层面板中的文件夹树。
 *
 * 文件夹是纯组织层：画布对象仍然平铺在 fabric 中，树负责
 * 显隐/锁定的继承、命名、拖拽归类与持久化。最多 5 层文件夹。
 */
export function useLayerTree(getEngine: () => CanvasEngine | null, options: LayerTreeOptions = {}) {
  const tree = ref<LayerNode[]>([])

  function notify(): void {
    options.onChange?.()
  }

  function applyStates(): void {
    const engine = getEngine()
    if (!engine) return
    engine.applyLayerStates(collectEffectiveStates(tree.value))
  }

  /** 把面板顺序同步成画布堆叠顺序（面板顶部 = 最上层） */
  function syncOrder(): void {
    getEngine()?.applyLayerOrder(flattenLayerIds(tree.value))
  }

  /** 与画布对象对账：补上新建对象，清理已删除对象，保持文件夹与状态 */
  function reconcile(): void {
    const engine = getEngine()
    if (!engine) return

    const layers = engine.layers()
    const alive = new Set(layers.map((layer) => layer.id))
    const existing = new Set<string>()
    const walk = (nodes: LayerNode[]): void => {
      nodes.forEach((node) => {
        if (node.type === 'folder') walk(node.children)
        else existing.add(node.id)
      })
    }
    walk(tree.value)

    const created: LayerEntry[] = layers
      .filter((layer) => !existing.has(layer.id))
      .map((layer) => ({
        type: 'layer',
        id: layer.id,
        visible: layer.visible,
        locked: layer.locked,
      }))

    const pruned = pruneLayers(tree.value, alive)
    const next = created.length ? [...created, ...pruned] : pruned

    if (JSON.stringify(next) !== JSON.stringify(tree.value)) {
      tree.value = next
    }
    applyStates()
    syncOrder()
  }

  function hydrate(saved: LayerNode[] | null | undefined): void {
    tree.value = normalizeTree(saved ?? [])
    reconcile()
    applyStates()
    syncOrder()
  }

  function serialize(): LayerNode[] {
    return JSON.parse(JSON.stringify(tree.value)) as LayerNode[]
  }

  function createFolder(parentId: string | null): string | null {
    if (parentId) {
      const parent = findNode(tree.value, parentId)
      if (!parent || parent.node.type !== 'folder') return null
      if (parent.depth + 2 > MAX_FOLDER_DEPTH) return null
    }

    const folder: LayerNode = {
      type: 'folder',
      id: newFolderId(),
      name: nextFolderName(tree.value),
      visible: true,
      locked: false,
      collapsed: false,
      children: [],
    }
    tree.value = insertNode(tree.value, parentId, folder)
    applyStates()
    notify()
    return folder.id
  }

  function renameNode(id: string, name: string): void {
    const found = findNode(tree.value, id)
    if (!found) return
    const clean = name.trim().slice(0, 40)
    if (!clean) return

    if (found.node.type === 'folder') {
      tree.value = patchNode(tree.value, id, { name: clean })
      notify()
      return
    }
    getEngine()?.renameLayer(id, clean)
    notify()
  }

  function removeNode(id: string): void {
    const found = findNode(tree.value, id)
    if (!found) return

    if (found.node.type === 'folder') {
      // 解散文件夹，内容回到父级，不删除画布内容
      tree.value = dissolveFolder(tree.value, id)
      applyStates()
      syncOrder()
      notify()
      return
    }

    const { nodes } = detachNode(tree.value, id)
    tree.value = nodes
    getEngine()?.removeLayer(id)
    notify()
  }

  /** 批量移动图层/文件夹到目标位置；文件夹连同其内容整体移动 */
  function moveNodes(ids: string[], target: MoveTarget): boolean {
    const next = moveLayerNodes(tree.value, ids, target)
    if (!next) return false
    tree.value = next
    applyStates()
    syncOrder()
    notify()
    return true
  }

  /** 同级重排（属性面板的上移/下移/置顶/置底） */
  function reorder(id: string, direction: 'up' | 'down' | 'top' | 'bottom'): boolean {
    const next = reorderNode(tree.value, id, direction)
    if (!next) return false
    tree.value = next
    syncOrder()
    notify()
    return true
  }

  function toggleVisible(id: string): void {
    const found = findNode(tree.value, id)
    if (!found) return
    tree.value = patchNode(tree.value, id, { visible: !found.node.visible })
    applyStates()
    notify()
  }

  function toggleLocked(id: string): void {
    const found = findNode(tree.value, id)
    if (!found) return
    tree.value = patchNode(tree.value, id, { locked: !found.node.locked })
    applyStates()
    notify()
  }

  function toggleCollapse(id: string): void {
    const found = findNode(tree.value, id)
    if (!found || found.node.type !== 'folder') return
    tree.value = patchNode(tree.value, id, { collapsed: !found.node.collapsed })
    notify()
  }

  function canDrop(ids: string[], targetFolderId: string | null): boolean {
    return canMoveNodes(tree.value, ids, targetFolderId)
  }

  /** 面板选中节点（可含文件夹）→ 画布图层 id */
  function layerIdsFor(ids: string[]): string[] {
    return layerIdsOf(tree.value, ids)
  }

  /** 节点是否还在树里（删除/解散后用于清理面板选中态） */
  function hasNode(id: string): boolean {
    return findNode(tree.value, id) !== null
  }

  return {
    tree,
    hydrate,
    reconcile,
    serialize,
    createFolder,
    renameNode,
    removeNode,
    moveNodes,
    reorder,
    toggleVisible,
    toggleLocked,
    toggleCollapse,
    canDrop,
    layerIdsFor,
    hasNode,
  }
}
