/** AI 能力的参数控件类型（仅描述表单，不涉及后端） */
export type CapabilityField =
  | {
      kind: 'select'
      key: string
      label: string
      options: { value: string; label: string }[]
      default: string
    }
  | {
      kind: 'range'
      key: string
      label: string
      min: number
      max: number
      step: number
      default: number
    }
  | { kind: 'chips'; key: string; label: string; options: string[]; default: string }
  | { kind: 'text'; key: string; label: string; placeholder: string; default: string }

/** 一项 AI 能力：图标为 @ant-design/icons-vue 的组件名，由工具条映射渲染 */
export interface AiCapability {
  key: string
  label: string
  desc: string
  icon: string
  fields: CapabilityField[]
}

/** AI 工具页上的能力清单：工具条与 /#/ai/<key> 工作台共用这一份定义 */
export const AI_CAPABILITIES: AiCapability[] = [
  {
    key: 'draft',
    label: '一键成稿',
    desc: '用一句描述直接生成完整画面，无需上传参考图。',
    icon: 'FormOutlined',
    fields: [
      {
        kind: 'text',
        key: 'prompt',
        label: '画面描述',
        placeholder: '例如：赛博朋克风格的猫，霓虹灯，雨夜街道',
        default: '',
      },
      {
        kind: 'select',
        key: 'style',
        label: '成稿风格',
        options: [
          { value: 'japanese', label: '日系插画' },
          { value: 'realistic', label: '写实' },
          { value: 'chinese', label: '国风' },
          { value: 'scifi', label: '科幻' },
        ],
        default: 'japanese',
      },
      {
        kind: 'chips',
        key: 'ratio',
        label: '画幅',
        options: ['16:9', '1:1', '4:3', '9:16'],
        default: '1:1',
      },
    ],
  },
  {
    key: 'render',
    label: '万能渲染',
    desc: '按选定模型与精致度重绘当前画面。',
    icon: 'PictureOutlined',
    fields: [
      {
        kind: 'select',
        key: 'model',
        label: '渲染模型',
        options: [
          { value: 'standard', label: '标准' },
          { value: 'detailed', label: '精绘' },
          { value: 'fast', label: '极速' },
        ],
        default: 'standard',
      },
      { kind: 'range', key: 'fidelity', label: '精致度', min: 1, max: 5, step: 1, default: 3 },
    ],
  },
  {
    key: 'style-adjust',
    label: '丰富细节',
    desc: '调整细节权重，在简化与丰富之间平衡。',
    icon: 'SlidersOutlined',
    fields: [
      { kind: 'range', key: 'detail', label: '细节权重', min: 1, max: 5, step: 1, default: 3 },
      { kind: 'range', key: 'strength', label: '重绘幅度', min: 0, max: 100, step: 5, default: 40 },
    ],
  },
  {
    key: 'matting',
    label: '一键抠图',
    desc: '自动识别主体并移除背景。',
    icon: 'ScissorOutlined',
    fields: [
      {
        kind: 'select',
        key: 'subject',
        label: '主体',
        options: [
          { value: 'auto', label: '自动' },
          { value: 'person', label: '人物' },
          { value: 'product', label: '商品' },
        ],
        default: 'auto',
      },
      { kind: 'range', key: 'feather', label: '边缘羽化', min: 0, max: 10, step: 1, default: 2 },
      { kind: 'chips', key: 'background', label: '输出背景', options: ['透明', '白底', '黑底'], default: '透明' },
    ],
  },
  {
    key: 'zoom',
    label: '超清放大',
    desc: '放大画面并补足清晰度与纹理。',
    icon: 'ZoomInOutlined',
    fields: [
      {
        kind: 'select',
        key: 'scale',
        label: '倍数',
        options: [
          { value: '2', label: '2x' },
          { value: '4', label: '4x' },
        ],
        default: '2',
      },
      {
        kind: 'select',
        key: 'mode',
        label: '放大模式',
        options: [
          { value: 'lossless', label: '无损放大' },
          { value: 'repaint', label: '重绘放大' },
        ],
        default: 'lossless',
      },
      { kind: 'chips', key: 'denoise', label: '降噪', options: ['开', '关'], default: '开' },
    ],
  },
  {
    key: 'fission',
    label: '相似图裂变',
    desc: '基于当前画面生成多张相似变体。',
    icon: 'ApartmentOutlined',
    fields: [
      { kind: 'chips', key: 'count', label: '数量', options: ['2', '4', '8'], default: '4' },
      { kind: 'range', key: 'similarity', label: '相似度', min: 0, max: 100, step: 5, default: 70 },
    ],
  },
  {
    key: 'expansion',
    label: '智能扩图',
    desc: '沿指定方向延展画面并补全内容。',
    icon: 'ExpandOutlined',
    fields: [
      { kind: 'chips', key: 'direction', label: '扩展方向', options: ['上', '下', '左', '右'], default: '右' },
      {
        kind: 'select',
        key: 'ratio',
        label: '扩展比例',
        options: [
          { value: '10', label: '10%' },
          { value: '25', label: '25%' },
          { value: '50', label: '50%' },
        ],
        default: '25',
      },
      {
        kind: 'text',
        key: 'prompt',
        label: '扩展提示词',
        placeholder: '描述扩展区域内容（留空自动补全）',
        default: '',
      },
      { kind: 'range', key: 'blend', label: '边缘融合', min: 0, max: 100, step: 5, default: 60 },
    ],
  },
  {
    key: 'free-perspective',
    label: '自由视角',
    desc: '调整水平与垂直角度，改变观察机位。',
    icon: 'CompassOutlined',
    fields: [
      { kind: 'range', key: 'horizontal', label: '水平角', min: -60, max: 60, step: 1, default: 0 },
      { kind: 'range', key: 'vertical', label: '垂直角', min: -30, max: 30, step: 1, default: 0 },
    ],
  },
  {
    key: 'replace',
    label: '涂抹替换',
    desc: '涂抹指定区域，用描述内容替换。',
    icon: 'FormatPainterOutlined',
    fields: [
      {
        kind: 'text',
        key: 'prompt',
        label: '替换描述',
        placeholder: '例如：换成木质桌面与暖色灯光',
        default: '',
      },
      { kind: 'range', key: 'brush', label: '笔刷大小', min: 1, max: 100, step: 1, default: 30 },
    ],
  },
  {
    key: 'refine',
    label: '局部细化',
    desc: '只重绘指定区域，提升局部完成度。',
    icon: 'AimOutlined',
    fields: [
      {
        kind: 'text',
        key: 'region',
        label: '细化区域',
        placeholder: '例如：画面左下角的角色面部',
        default: '',
      },
      { kind: 'range', key: 'strength', label: '强度', min: 1, max: 5, step: 1, default: 3 },
    ],
  },
  {
    key: 'video',
    label: '图生视频',
    desc: '把静态画面转成一段短视频。',
    icon: 'VideoCameraOutlined',
    fields: [
      {
        kind: 'select',
        key: 'duration',
        label: '时长',
        options: [
          { value: '3', label: '3s' },
          { value: '5', label: '5s' },
          { value: '8', label: '8s' },
        ],
        default: '5',
      },
      {
        kind: 'select',
        key: 'camera',
        label: '运镜',
        options: [
          { value: 'push', label: '推近' },
          { value: 'pull', label: '拉远' },
          { value: 'orbit', label: '环绕' },
          { value: 'static', label: '静止' },
        ],
        default: 'push',
      },
    ],
  },
  {
    key: 'game-ui-splitter',
    label: '游戏UI切图',
    desc: '把界面稿切分为可直接使用的素材。',
    icon: 'AppstoreOutlined',
    fields: [
      { kind: 'chips', key: 'count', label: '切图数量', options: ['4', '8', '16'], default: '8' },
      {
        kind: 'select',
        key: 'format',
        label: '输出格式',
        options: [
          { value: 'png', label: 'PNG' },
          { value: 'jpg', label: 'JPG' },
          { value: 'webp', label: 'WEBP' },
        ],
        default: 'png',
      },
    ],
  },
]
