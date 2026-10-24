import { customAlphabet } from 'nanoid'
import type { LayerFolder, LayerNode } from '@/types/board'

/** 文件夹最多嵌套 5 层（顶层文件夹算第 1 层） */
export const MAX_FOLDER_DEPTH = 5

const createFolderSuffix = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8)

export const newFolderId = (): string => `f_${createFolderSuffix()}`

export interface FoundLayerNode {
  node: LayerNode
  parentId: string | null
  depth: number
  index: number
}

export interface FlatLayerRow {
  node: LayerNode
  depth: number
  parentId: string | null
}

export interface EffectiveLayerState {
  visible: boolean
  locked: boolean
}

export function findNode(nodes: LayerNode[], id: string): FoundLayerNode | null {
  const walk = (
    list: LayerNode[],
    parentId: string | null,
    depth: number,
  ): FoundLayerNode | null => {
    for (let index = 0; index < list.length; index += 1) {
      const node = list[index]
      if (!node) continue
      if (node.id === id) return { node, parentId, depth, index }
      if (node.type === 'folder') {
        const found = walk(node.children, node.id, depth + 1)
        if (found) return found
      }
    }
    return null
  }
  return walk(nodes, null, 0)
}

/** 按面板展示顺序扁平化，折叠的文件夹跳过其子节点 */
export function flattenTree(
  nodes: LayerNode[],
  depth = 0,
  parentId: string | null = null,
): FlatLayerRow[] {
  const rows: FlatLayerRow[] = []
  nodes.forEach((node) => {
    rows.push({ node, depth, parentId })
    if (node.type === 'folder' && !node.collapsed) {
      rows.push(...flattenTree(node.children, depth + 1, node.id))
    }
  })
  return rows
}

/** 文件夹子树的层数（仅统计文件夹），图层计 0 */
export function folderHeight(node: LayerNode): number {
  if (node.type !== 'folder') return 0
  const childHeight = node.children.reduce((max, child) => Math.max(max, folderHeight(child)), 0)
  return 1 + childHeight
}

export function canMoveNode(
  nodes: LayerNode[],
  id: string,
  targetFolderId: string | null,
): boolean {
  const source = findNode(nodes, id)
  if (!source) return false
  if (targetFolderId === id) return false

  let targetDepth = -1
  if (targetFolderId) {
    const target = findNode(nodes, targetFolderId)
    if (!target || target.node.type !== 'folder') return false
    // 不能把文件夹拖进自己的子孙文件夹（否则形成环）
    if (source.node.type === 'folder' && findNode(source.node.children, targetFolderId)) {
      return false
    }
    targetDepth = target.depth
  }

  if (source.node.type === 'folder') {
    // 目标层级 + 被移动文件夹子树高度 不能超过上限
    return targetDepth + folderHeight(source.node) <= MAX_FOLDER_DEPTH - 1
  }
  return true
}

export function collectEffectiveStates(nodes: LayerNode[]): Record<string, EffectiveLayerState> {
  const states: Record<string, EffectiveLayerState> = {}
  const walk = (list: LayerNode[], parentVisible: boolean, parentLocked: boolean): void => {
    list.forEach((node) => {
      const visible = parentVisible && node.visible
      const locked = parentLocked || node.locked
      states[node.id] = { visible, locked }
      if (node.type === 'folder') walk(node.children, visible, locked)
    })
  }
  walk(nodes, true, false)
  return states
}

export function collectLayerIds(nodes: LayerNode[]): Set<string> {
  const ids = new Set<string>()
  const walk = (list: LayerNode[]): void => {
    list.forEach((node) => {
      if (node.type === 'folder') walk(node.children)
      else ids.add(node.id)
    })
  }
  walk(nodes)
  return ids
}

export function normalizeTree(input: unknown, depth = 0, seen = new Set<string>()): LayerNode[] {
  if (!Array.isArray(input) || depth > MAX_FOLDER_DEPTH) return []

  const result: LayerNode[] = []
  input.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return
    const record = raw as Record<string, unknown>

    if (record.type === 'folder') {
      if (depth >= MAX_FOLDER_DEPTH) return
      let id = typeof record.id === 'string' ? record.id : ''
      if (!id || seen.has(id)) id = newFolderId()
      seen.add(id)
      const folder: LayerFolder = {
        type: 'folder',
        id,
        name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : '文件夹',
        visible: record.visible !== false,
        locked: record.locked === true,
        collapsed: record.collapsed === true,
        children: normalizeTree(record.children, depth + 1, seen),
      }
      result.push(folder)
      return
    }

    if (record.type === 'layer') {
      const id = typeof record.id === 'string' ? record.id : ''
      if (!id || seen.has(id)) return
      seen.add(id)
      result.push({
        type: 'layer',
        id,
        visible: record.visible !== false,
        locked: record.locked === true,
      })
    }
  })
  return result
}

export function nextFolderName(nodes: LayerNode[]): string {
  let max = 0
  const walk = (list: LayerNode[]): void => {
    list.forEach((node) => {
      if (node.type !== 'folder') return
      const match = /^文件夹\s*(\d+)$/.exec(node.name)
      if (match) max = Math.max(max, Number(match[1]))
      walk(node.children)
    })
  }
  walk(nodes)
  return `文件夹 ${max + 1}`
}

export interface LayerNodePatch {
  name?: string
  visible?: boolean
  locked?: boolean
  collapsed?: boolean
}

export function patchNode(nodes: LayerNode[], id: string, patch: LayerNodePatch): LayerNode[] {
  return nodes.map((node) => {
    if (node.id === id) return { ...node, ...patch } as LayerNode
    if (node.type === 'folder') {
      return { ...node, children: patchNode(node.children, id, patch) }
    }
    return node
  })
}

export function detachNode(
  nodes: LayerNode[],
  id: string,
): { nodes: LayerNode[]; node: LayerNode | null } {
  const state: { removed: LayerNode | null } = { removed: null }
  const walk = (list: LayerNode[]): LayerNode[] => {
    const result: LayerNode[] = []
    list.forEach((node) => {
      if (node.id === id) {
        state.removed = node
        return
      }
      if (node.type === 'folder') result.push({ ...node, children: walk(node.children) })
      else result.push(node)
    })
    return result
  }
  const next = walk(nodes)
  return { nodes: next, node: state.removed }
}

export function insertNode(
  nodes: LayerNode[],
  parentId: string | null,
  node: LayerNode,
): LayerNode[] {
  if (!parentId) return [node, ...nodes]
  return nodes.map((item) => {
    if (item.type !== 'folder') return item
    if (item.id === parentId) {
      return { ...item, collapsed: false, children: [node, ...item.children] }
    }
    return { ...item, children: insertNode(item.children, parentId, node) }
  })
}

/** 解散文件夹：子节点上移到文件夹原位置 */
export function dissolveFolder(nodes: LayerNode[], id: string): LayerNode[] {
  const walk = (list: LayerNode[]): LayerNode[] =>
    list.flatMap<LayerNode>((node) => {
      if (node.id === id && node.type === 'folder') return node.children
      if (node.type === 'folder') return [{ ...node, children: walk(node.children) }]
      return [node]
    })
  return walk(nodes)
}

/** 移除画布上已不存在的图层引用 */
export function pruneLayers(nodes: LayerNode[], alive: Set<string>): LayerNode[] {
  return nodes.flatMap<LayerNode>((node) => {
    if (node.type === 'layer') return alive.has(node.id) ? [node] : []
    return [{ ...node, children: pruneLayers(node.children, alive) }]
  })
}
