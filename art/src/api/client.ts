/**
 * 请求层：直接对接 ai-flows 平台（同源，复用平台的登录 cookie）。
 *
 * - 不携带任何自定义 token，浏览器自动带 HttpOnly 会话 cookie
 * - 未登录（401）直接跳平台登录页，保证与员工系统同一套登录方式
 * - 平台接口成功返回业务 JSON，失败返回 `{ error }`
 */

const API_BASE = ''

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const text = (payload as { error?: unknown }).error
    if (typeof text === 'string' && text) return text
  }
  return `请求失败（HTTP ${status}）`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: 'same-origin',
    })
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : '网络请求失败')
  }

  if (res.status === 401) {
    window.location.href = '/login'
    throw new ApiError('登录状态已失效，请重新登录', 401)
  }

  const text = await res.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new ApiError(`响应不是合法 JSON（HTTP ${res.status}）`, res.status)
    }
  }

  if (!res.ok) throw new ApiError(errorMessage(payload, res.status), res.status)
  return payload as T
}

export const http = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

/** 平台登录账号（与员工系统同一套账号） */
export interface PlatformUser {
  email: string
  name?: string
  department?: string
  role?: string
  avatar?: string
}

/** 当前登录用户（拿不到时返回 null，不抛错） */
export async function fetchMe(): Promise<PlatformUser | null> {
  try {
    const data = await http.get<{ user?: PlatformUser }>('/api/me')
    return data.user ?? null
  } catch {
    return null
  }
}
