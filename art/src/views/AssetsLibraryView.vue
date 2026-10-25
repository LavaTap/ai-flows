<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons-vue'
import { assetApi, type ArtAsset } from '@/api/asset'
import { boardApi } from '@/api/board'
import { fetchMe, type PlatformUser } from '@/api/client'
import type { BoardMeta } from '@/types/board'

const router = useRouter()

const me = ref<PlatformUser | null>(null)
const boards = ref<BoardMeta[]>([])
const assets = ref<ArtAsset[]>([])
const usage = ref({ boards: 0, bytes: 0 })
const keyword = ref('')
const activeTab = ref('boards')
const boardLoading = ref(true)
const assetLoading = ref(true)
const busy = ref(false)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const renameTarget = ref<BoardMeta | null>(null)
const renameName = ref('')
const renaming = ref(false)
const previewAsset = ref<ArtAsset | null>(null)

const MAX_ASSET_BYTES = 8 * 1024 * 1024

const sourceLabel: Record<string, string> = {
  upload: '上传',
  paste: '拖入',
  generate: '生成',
  asset: '复用',
}

const filteredBoards = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return boards.value
  return boards.value.filter((board) => board.name.toLowerCase().includes(query))
})

const assetBytes = computed(() => assets.value.reduce((total, asset) => total + asset.size, 0))

function formatTime(timestamp: number): string {
  const date = dayjs(timestamp)
  if (date.isSame(dayjs(), 'day')) return `今天 ${date.format('HH:mm')}`
  if (date.isSame(dayjs().subtract(1, 'day'), 'day')) return `昨天 ${date.format('HH:mm')}`
  return date.format('YYYY-MM-DD HH:mm')
}

function formatDateTime(iso: string): string {
  const date = dayjs(iso)
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm') : '未知'
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

async function loadBoards(): Promise<void> {
  boardLoading.value = true
  try {
    const [list, stats] = await Promise.all([boardApi.list(), boardApi.usage()])
    boards.value = list
    usage.value = stats
  } catch (error) {
    message.error(error instanceof Error ? error.message : '画板读取失败')
  } finally {
    boardLoading.value = false
  }
}

async function loadAssets(): Promise<void> {
  assetLoading.value = true
  try {
    assets.value = await assetApi.list()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '素材读取失败')
  } finally {
    assetLoading.value = false
  }
}

onMounted(async () => {
  const [user] = await Promise.all([fetchMe(), loadBoards(), loadAssets()])
  me.value = user
})

async function createBoard(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const meta = await boardApi.create()
    await router.push(`/board/${meta.id}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '创建画板失败')
  } finally {
    busy.value = false
  }
}

function openBoard(id: string): void {
  void router.push(`/board/${id}`)
}

function startRename(board: BoardMeta): void {
  renameTarget.value = board
  renameName.value = board.name
}

function closeRename(): void {
  renameTarget.value = null
  renameName.value = ''
}

async function submitRename(): Promise<void> {
  const target = renameTarget.value
  const name = renameName.value.trim()
  if (!target) return
  if (!name) {
    message.warning('请输入画板名称')
    return
  }
  renaming.value = true
  try {
    const meta = await boardApi.rename(target.id, name)
    boards.value = boards.value.map((board) => (board.id === meta.id ? meta : board))
    closeRename()
    message.success('画板已重命名')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '重命名失败')
  } finally {
    renaming.value = false
  }
}

async function duplicateBoard(id: string): Promise<void> {
  try {
    const meta = await boardApi.duplicate(id)
    await loadBoards()
    message.success(`已创建「${meta.name}」`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '复制失败')
  }
}

async function removeBoard(id: string): Promise<void> {
  try {
    await boardApi.remove(id)
    await loadBoards()
    message.success('画板已删除')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除失败')
  }
}

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
  const picked = Array.from(input.files ?? []).filter((file) => file.type.startsWith('image/'))
  input.value = ''
  if (!picked.length) return

  const files = picked.filter((file) => file.size <= MAX_ASSET_BYTES)
  if (files.length < picked.length) {
    message.warning(`已跳过超过 8MB 的图片 ${picked.length - files.length} 张`)
  }
  if (!files.length) return

  uploading.value = true
  try {
    const created: ArtAsset[] = []
    for (const file of files) {
      const dataUrl = await readAsDataUrl(file)
      created.push(await assetApi.upload(dataUrl, file.name, 'upload'))
    }
    assets.value = [...created, ...assets.value]
    message.success(`已上传 ${created.length} 张素材`)
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
    if (previewAsset.value?.id === asset.id) previewAsset.value = null
    message.success('素材已删除')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除失败')
  }
}
</script>

<template>
  <div class="list-page">
    <div class="list-shell">
      <header class="brand">
        <div class="brand-mark" />
        <div>
          <h2 class="brand-title">AI 美术平台</h2>
          <p class="brand-sub">FREE CANVAS · AI-FLOWS WORKSPACE</p>
        </div>
        <div class="brand-right">
          <span v-if="me">{{ me.name || me.email }}</span>
          <a href="/home">返回平台</a>
        </div>
      </header>

      <nav class="page-nav">
        <router-link to="/" class="nav-pill">自由画布</router-link>
        <span class="nav-pill active">素材库</span>
      </nav>

      <div class="list-head library-head">
        <div>
          <h1>素材库</h1>
          <p>画布资产与我的素材统一存放，按账号隔离保存在平台，换设备也能接着用。</p>
        </div>
        <div class="list-tools">
          <template v-if="activeTab === 'boards'">
            <a-input v-model:value="keyword" allow-clear placeholder="搜索画板名称">
              <template #prefix><SearchOutlined /></template>
            </a-input>
            <a-button type="primary" :loading="busy" @click="createBoard">
              <template #icon><PlusOutlined /></template>
              新建画板
            </a-button>
          </template>
          <a-button v-else type="primary" :loading="uploading" @click="fileInput?.click()">
            <template #icon><PlusOutlined /></template>
            上传素材
          </a-button>
        </div>
      </div>

      <a-tabs v-model:activeKey="activeTab" class="library-tabs">
        <a-tab-pane key="boards" tab="画布资产">
          <div v-if="boardLoading" class="list-empty">正在读取我的画板…</div>

          <template v-else>
            <div v-if="!filteredBoards.length" class="list-empty">
              {{
                boards.length
                  ? '没有找到匹配的画板'
                  : '还没有画板，点击右上角「新建画板」开始创作'
              }}
            </div>

            <div v-else class="board-grid">
              <article
                v-for="board in filteredBoards"
                :key="board.id"
                class="board-card"
                @click="openBoard(board.id)"
              >
                <div class="board-thumb">
                  <img v-if="board.thumbnail" :src="board.thumbnail" :alt="board.name" />
                  <span v-else class="empty-glyph">EMPTY CANVAS</span>
                </div>
                <div class="board-card-body">
                  <div class="board-card-title">
                    <span class="board-card-name" :title="board.name">{{ board.name }}</span>
                  </div>
                  <div class="board-card-meta">
                    <span>{{ formatTime(board.updatedAt) }}</span>
                    <i />
                    <span>{{ board.objectCount }} 个对象</span>
                  </div>
                </div>

                <div class="board-card-actions" @click.stop>
                  <button class="icon-btn" title="打开画板" @click="openBoard(board.id)">
                    <FolderOpenOutlined />
                  </button>
                  <button class="icon-btn" title="重命名" @click="startRename(board)">
                    <EditOutlined />
                  </button>
                  <button
                    class="icon-btn"
                    title="复制画板"
                    @click="duplicateBoard(board.id)"
                  >
                    <CopyOutlined />
                  </button>
                  <a-popconfirm
                    title="删除后无法恢复，确认删除？"
                    ok-text="删除"
                    cancel-text="取消"
                    @confirm="removeBoard(board.id)"
                  >
                    <button class="icon-btn danger" title="删除画板"><DeleteOutlined /></button>
                  </a-popconfirm>
                </div>
              </article>
            </div>

            <footer class="list-footer">
              <span>共 {{ boards.length }} 个画板 · 已用 {{ formatBytes(usage.bytes) }}</span>
              <span>登录账号隔离 · Vue 3 · fabric.js</span>
            </footer>
          </template>
        </a-tab-pane>

        <a-tab-pane key="assets" tab="我的素材">
          <div v-if="assetLoading" class="list-empty">正在读取素材…</div>

          <template v-else>
            <div v-if="!assets.length" class="asset-empty library-asset-empty">
              <InboxOutlined style="font-size: 22px" />
              <span>还没有素材，点击右上角「上传素材」添加图片</span>
            </div>

            <div v-else class="asset-grid library-asset-grid">
              <div v-for="asset in assets" :key="asset.id" class="asset-card">
                <button
                  type="button"
                  class="asset-thumb"
                  :title="`查看大图：${asset.name}`"
                  @click="previewAsset = asset"
                >
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

            <footer class="list-footer">
              <span>共 {{ assets.length }} 张 · 合计 {{ formatBytes(assetBytes) }}</span>
              <span>登录账号隔离 · Vue 3 · fabric.js</span>
            </footer>
          </template>
        </a-tab-pane>
      </a-tabs>

      <a-modal
        :open="renameTarget !== null"
        title="重命名画板"
        ok-text="保存"
        cancel-text="取消"
        :confirm-loading="renaming"
        @ok="submitRename"
        @cancel="closeRename"
      >
        <a-input
          v-model:value="renameName"
          maxlength="60"
          placeholder="输入画板名称"
          @press-enter="submitRename"
        />
      </a-modal>

      <a-modal
        :open="previewAsset !== null"
        :footer="null"
        :title="previewAsset?.name ?? '素材预览'"
        width="720px"
        centered
        @cancel="previewAsset = null"
      >
        <div v-if="previewAsset" class="preview-body">
          <img :src="previewAsset.url" :alt="previewAsset.name" />
          <dl class="preview-facts">
            <div>
              <dt>来源</dt>
              <dd>{{ sourceLabel[previewAsset.source] ?? '素材' }}</dd>
            </div>
            <div>
              <dt>大小</dt>
              <dd>{{ formatBytes(previewAsset.size) }}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{{ formatDateTime(previewAsset.createdAt) }}</dd>
            </div>
          </dl>
        </div>
      </a-modal>

      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        style="display: none"
        @change="handleFiles"
      />
    </div>
  </div>
</template>

<style scoped>
.page-nav {
  display: flex;
  gap: 8px;
  margin-top: 30px;
}

.nav-pill {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--text-dim);
  font-size: 12.5px;
  text-decoration: none;
  transition: all 0.14s ease;
}

.nav-pill:hover {
  color: var(--text);
  border-color: rgba(124, 140, 255, 0.55);
}

.nav-pill.active {
  color: #fff;
  background: linear-gradient(140deg, rgba(124, 140, 255, 0.28), rgba(180, 139, 255, 0.18));
  border-color: rgba(124, 140, 255, 0.45);
}

.library-head {
  margin: 26px 0 6px;
}

.list-tools {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.library-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 20px;
}

.library-tabs :deep(.ant-tabs-nav::before) {
  border-bottom-color: var(--line-soft);
}

.library-tabs :deep(.ant-tabs-tab) {
  font-size: 13px;
}

.library-tabs :deep(.ant-tabs-tab-active .ant-tabs-tab-btn) {
  color: var(--accent);
}

.board-card-actions {
  right: 48px;
}

.library-asset-grid {
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
  margin-top: 0;
}

.library-asset-grid .asset-thumb img {
  aspect-ratio: 4 / 3;
}

.library-asset-empty {
  margin-top: 0;
}

.asset-del {
  width: 28px;
  height: 28px;
}

.preview-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preview-body img {
  width: 100%;
  max-height: 58vh;
  object-fit: contain;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: #0e1119;
  display: block;
}

.preview-facts {
  display: flex;
  gap: 30px;
  flex-wrap: wrap;
  margin: 0;
}

.preview-facts div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preview-facts dt {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.preview-facts dd {
  margin: 0;
  font-size: 12.5px;
  color: var(--text);
}

@media (max-width: 640px) {
  .library-asset-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }
}
</style>
