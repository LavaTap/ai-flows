import { renderArtwork } from '@/core/ai/mockGenerator'

export interface AiModelOption {
  id: string
  label: string
  hint: string
  width: number
  height: number
}

export const AI_MODELS: AiModelOption[] = [
  { id: 'canvas-seedream', label: '通用绘图', hint: '宽幅构图 · 1024×768', width: 1024, height: 768 },
  { id: 'canvas-comfy-single', label: '单图工作流', hint: '方形构图 · 768×768', width: 768, height: 768 },
  { id: 'canvas-poster', label: '海报模板', hint: '竖版构图 · 768×1024', width: 768, height: 1024 },
]

export const AI_STYLES = ['赛博', '国风', '水彩', '胶片', '极简'] as const

export interface GenerateParams {
  prompt: string
  style: string
  modelId: string
  count: number
}

export interface GenerateResult {
  taskId: string
  images: string[]
  elapsed: number
}

/**
 * 对应真实项目的 `POST /aiApi/api/chat/completions` + `/api/task/waitClientIds` 轮询。
 * 这里用本地渲染模拟异步任务：提交 -> 等待 -> 返回图片列表。
 */
export async function generateArtwork(params: GenerateParams): Promise<GenerateResult> {
  const startedAt = Date.now()
  const model = AI_MODELS.find((item) => item.id === params.modelId) ?? AI_MODELS[0]!
  const taskId = `task-${Date.now().toString(36)}`
  const prompt = params.prompt.trim() || '自由画布 · 无题'

  await new Promise<void>((resolve) => setTimeout(resolve, 600 + Math.random() * 500))

  const images: string[] = []
  for (let i = 0; i < params.count; i += 1) {
    images.push(
      renderArtwork({
        prompt,
        style: params.style,
        width: model.width,
        height: model.height,
        seed: Date.now() + i * 7919,
      }),
    )
  }

  return { taskId, images, elapsed: Date.now() - startedAt }
}
