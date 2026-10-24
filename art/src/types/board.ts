export type ToolName =
  | 'select'
  | 'hand'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text'
  | 'pen'
  | 'eraser'

export type LayerKind = 'text' | 'image' | 'shape' | 'path' | 'group' | 'other'

export interface ShapeStyle {
  fill: string
  stroke: string
  strokeWidth: number
  opacity: number
  fontSize: number
}

export const DEFAULT_STYLE: ShapeStyle = {
  fill: '#7c8cff',
  stroke: '#dfe4ff',
  strokeWidth: 2,
  opacity: 1,
  fontSize: 32,
}

export interface LayerInfo {
  id: string
  name: string
  kind: LayerKind
  typeLabel: string
  visible: boolean
  locked: boolean
}

/** 文件夹节点（仅存在于图层面板，不改变 fabric 对象层级） */
export interface LayerFolder {
  type: 'folder'
  id: string
  name: string
  visible: boolean
  locked: boolean
  collapsed: boolean
  children: LayerNode[]
}

/** 指向画布对象的图层节点 */
export interface LayerEntry {
  type: 'layer'
  id: string
  visible: boolean
  locked: boolean
}

export type LayerNode = LayerFolder | LayerEntry

export interface SelectionInfo {
  kind: LayerKind
  typeLabel: string
  style: ShapeStyle
}

export interface EngineSnapshot {
  tool: ToolName
  zoom: number
  offsetX: number
  offsetY: number
  layers: LayerInfo[]
  selectedIds: string[]
  selection: SelectionInfo | null
  objectCount: number
  canUndo: boolean
  canRedo: boolean
}

export interface BoardMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  objectCount: number
  thumbnail: string | null
}

export interface BoardRecord {
  meta: BoardMeta
  canvas: unknown
  tree?: LayerNode[] | null
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
