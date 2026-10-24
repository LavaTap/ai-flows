import { http } from './client'

/** 我的素材（服务端按登录账号隔离；图片二进制存 db/art-assets/） */
export interface ArtAsset {
  id: string
  name: string
  /** 取图地址（/api/art/assets/<id>，带登录与归属校验） */
  url: string
  mime: string
  size: number
  /** upload=上传 / paste=拖入粘贴 / generate=智能生成 / asset=素材库复用 */
  source: string
  createdAt: string
}

export type AssetSource = 'upload' | 'paste' | 'generate' | 'asset'

interface AssetListResponse {
  assets: ArtAsset[]
}

/**
 * 素材接口：画布里导入的图片、智能生成的结果，插入前都先登记到这里，
 * 画布 JSON 只存 `/api/art/assets/<id>` 地址，避免整块画布被 base64 撑大。
 */
export const assetApi = {
  async list(): Promise<ArtAsset[]> {
    const data = await http.get<AssetListResponse>('/api/art/assets')
    return data.assets
  },

  async upload(dataUrl: string, name: string, source: AssetSource): Promise<ArtAsset> {
    const data = await http.post<{ asset: ArtAsset }>('/api/art/assets', {
      data: dataUrl,
      name,
      source,
    })
    return data.asset
  },

  async remove(id: string): Promise<void> {
    await http.del<{ ok: boolean }>(`/api/art/assets/${encodeURIComponent(id)}`)
  },
}
