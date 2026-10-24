<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { DeleteOutlined, InboxOutlined, PlusOutlined } from '@ant-design/icons-vue'
import { assetApi, type ArtAsset } from '@/api/asset'

const emit = defineEmits<{ insert: [url: string] }>()

const assets = ref<ArtAsset[]>([])
const loading = ref(true)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const sourceLabel: Record<string, string> = {
  upload: '上传',
  paste: '拖入',
  generate: '生成',
  asset: '复用',
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function refresh(): Promise<void> {
  try {
    assets.value = await assetApi.list()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '素材读取失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
})

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
}

async function handleFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? []).filter((file) => file.type.startsWith('image/'))
  input.value = ''
  if (!files.length) return
  uploading.value = true
  try {
    for (const file of files) {
      const dataUrl = await readAsDataUrl(file)
      const asset = await assetApi.upload(dataUrl, file.name, 'upload')
      assets.value = [asset, ...assets.value]
    }
    message.success(`已存入我的素材 ${files.length} 张`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '素材上传失败')
  } finally {
    uploading.value = false
  }
}

async function removeAsset(asset: ArtAsset): Promise<void> {
  try {
    await assetApi.remove(asset.id)
    assets.value = assets.value.filter((item) => item.id !== asset.id)
    message.success('素材已删除')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除失败')
  }
}

/** 重新拉取（外部导入 / 生成后父组件会调用） */
function reload(): Promise<void> {
  loading.value = true
  return refresh()
}

defineExpose({ reload })
</script>

<template>
  <div class="panel-scroll">
    <div class="panel-title">
      <span>我的素材</span>
      <span>{{ assets.length }} 张</span>
    </div>

    <button type="button" class="ai-submit" :disabled="uploading" @click="fileInput?.click()">
      <PlusOutlined />
      {{ uploading ? '上传中…' : '上传素材' }}
    </button>

    <div v-if="loading" class="asset-empty">正在读取素材…</div>

    <div v-else-if="!assets.length" class="asset-empty">
      <InboxOutlined style="font-size: 22px" />
      <span>画布中导入或生成的图片会自动存到这里</span>
    </div>

    <div v-else class="asset-grid">
      <div v-for="asset in assets" :key="asset.id" class="asset-card">
        <button type="button" class="asset-thumb" :title="`点击放入画布：${asset.name}`" @click="emit('insert', asset.url)">
          <img :src="asset.url" :alt="asset.name" loading="lazy" />
        </button>
        <div class="asset-meta">
          <span class="asset-name" :title="asset.name">{{ asset.name }}</span>
          <span class="asset-sub">
            {{ sourceLabel[asset.source] ?? '素材' }} · {{ formatBytes(asset.size) }}
          </span>
        </div>
        <a-popconfirm
          title="删除后无法恢复，画布中已插入的图片也会失效，确认删除？"
          ok-text="删除"
          cancel-text="取消"
          @confirm="removeAsset(asset)"
        >
          <button type="button" class="icon-btn danger asset-del" title="删除素材">
            <DeleteOutlined />
          </button>
        </a-popconfirm>
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      style="display: none"
      @change="handleFiles"
    />
  </div>
</template>
