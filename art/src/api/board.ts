import type { BoardMeta, BoardRecord, LayerNode } from '@/types/board'
import { ApiError, http } from './client'

export interface SavePayload {
  name?: string
  canvas: unknown
  tree?: LayerNode[] | null
  objectCount: number
  thumbnail: string | null
}

/** 服务端返回的画板元信息（时间为 ISO 字符串，缩略图可能缺省） */
interface ServerBoardMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  objectCount: number
  thumbnail?: string
}

interface ServerBoardRecord {
  meta: ServerBoardMeta
  canvas: unknown
  tree?: LayerNode[] | null
}

interface BoardListResponse {
  boards: ServerBoardMeta[]
  stats: { boards: number; assets: number; bytes: number }
}

/** 服务端时间戳 → 毫秒（解析失败按 0，列表显示兜底） */
function toEpoch(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : 0
}

function toMeta(meta: ServerBoardMeta): BoardMeta {
  return {
    id: meta.id,
    name: meta.name,
    createdAt: toEpoch(meta.createdAt),
    updatedAt: toEpoch(meta.updatedAt),
    objectCount: meta.objectCount,
    thumbnail: meta.thumbnail ?? null,
  }
}

function boardPath(id: string): string {
  return `/api/art/boards/${encodeURIComponent(id)}`
}

/**
 * 画板接口：数据全部落在平台 SQLite（按登录账号隔离），
 * 不再使用浏览器本地存储，换设备 / 换浏览器都能接着画。
 */
export const boardApi = {
  async list(): Promise<BoardMeta[]> {
    const data = await http.get<BoardListResponse>('/api/art/boards')
    return data.boards.map(toMeta)
  },

  async detail(id: string): Promise<BoardRecord | null> {
    try {
      const data = await http.get<{ board: ServerBoardRecord }>(boardPath(id))
      return {
        meta: toMeta(data.board.meta),
        canvas: data.board.canvas,
        tree: data.board.tree ?? null,
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  },

  async create(name = '未命名画板'): Promise<BoardMeta> {
    const data = await http.post<{ board: ServerBoardMeta }>('/api/art/boards', { name })
    return toMeta(data.board)
  },

  async save(id: string, payload: SavePayload): Promise<BoardMeta> {
    const data = await http.put<{ board: ServerBoardMeta }>(boardPath(id), {
      name: payload.name,
      canvas: payload.canvas,
      tree: payload.tree ?? null,
      objectCount: payload.objectCount,
      thumbnail: payload.thumbnail,
    })
    return toMeta(data.board)
  },

  async rename(id: string, name: string): Promise<BoardMeta> {
    const data = await http.put<{ board: ServerBoardMeta }>(boardPath(id), { name })
    return toMeta(data.board)
  },

  async duplicate(id: string): Promise<BoardMeta> {
    const data = await http.post<{ board: ServerBoardMeta }>(`${boardPath(id)}/duplicate`)
    return toMeta(data.board)
  },

  async remove(id: string): Promise<void> {
    await http.del<{ ok: boolean }>(boardPath(id))
  },

  async usage(): Promise<{ boards: number; bytes: number }> {
    const data = await http.get<BoardListResponse>('/api/art/boards')
    return { boards: data.stats.boards, bytes: data.stats.bytes }
  },
}
