<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import {
  AppstoreOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons-vue'
import { boardApi } from '@/api/board'
import { fetchMe, type PlatformUser } from '@/api/client'
import type { BoardMeta } from '@/types/board'

type SortKey = 'updated' | 'name' | 'created'
type ViewMode = 'grid' | 'list'

const FAVORITES_KEY = 'art:board-favorites'

const router = useRouter()

const boards = ref<BoardMeta[]>([])
const keyword = ref('')
const loading = ref(true)
const usage = ref({ boards: 0, bytes: 0 })
const busy = ref(false)
const me = ref<PlatformUser | null>(null)
const sortKey = ref('updated')
const viewMode = ref<ViewMode>('grid')
const favorites = ref<string[]>(loadFavorites())
const renameTarget = ref<BoardMeta | null>(null)
const renameName = ref('')
const renaming = ref(false)

const sortOptions: { label: string; value: SortKey }[] = [
  { label: '最近更新', value: 'updated' },
  { label: '名称 A–Z', value: 'name' },
  { label: '创建时间', value: 'created' },
]

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  const list = query
    ? boards.value.filter((board) => board.name.toLowerCase().includes(query))
    : [...boards.value]
  if (sortKey.value === 'name') {
    return list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  }
  if (sortKey.value === 'created') {
    return list.sort((a, b) => b.createdAt - a.createdAt)
  }
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
})

/** 收藏画板 id 存 localStorage，仅影响星标展示，不改变排序 */
function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

function persistFavorites(): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.value))
  } catch {
    // 隐私模式等场景写入失败时忽略，不影响页面使用
  }
}

function isFavorite(id: string): boolean {
  return favorites.value.includes(id)
}

function toggleFavorite(id: string): void {
  favorites.value = isFavorite(id)
    ? favorites.value.filter((item) => item !== id)
    : [...favorites.value, id]
  persistFavorites()
}

function formatTime(timestamp: number): string {
  const date = dayjs(timestamp)
  if (date.isSame(dayjs(), 'day')) return `今天 ${date.format('HH:mm')}`
  if (date.isSame(dayjs().subtract(1, 'day'), 'day')) return `昨天 ${date.format('HH:mm')}`
  return date.format('YYYY-MM-DD HH:mm')
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

async function refresh(): Promise<void> {
  boards.value = await boardApi.list()
  usage.value = await boardApi.usage()
}

onMounted(async () => {
  me.value = await fetchMe()
  await refresh()
  loading.value = false
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
    await refresh()
    message.success(`已创建「${meta.name}」`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '复制失败')
  }
}

async function removeBoard(id: string): Promise<void> {
  try {
    await boardApi.remove(id)
    if (isFavorite(id)) toggleFavorite(id)
    await refresh()
    message.success('画板已删除')
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
        <span class="nav-pill active">自由画布</span>
        <router-link to="/assets" class="nav-pill">素材库</router-link>
      </nav>

      <div class="list-head">
        <div>
          <h1>我的无限画板</h1>
          <p>图形、文字、图片与智能生成，按账号隔离保存在平台，换设备也能接着画。</p>
        </div>
        <div class="list-tools">
          <a-input v-model:value="keyword" allow-clear placeholder="搜索画板名称">
            <template #prefix><SearchOutlined /></template>
          </a-input>
          <a-select v-model:value="sortKey" class="sort-select" :options="sortOptions" />
          <div class="view-toggle">
            <button
              type="button"
              class="icon-btn"
              :class="{ active: viewMode === 'grid' }"
              title="网格视图"
              @click="viewMode = 'grid'"
            >
              <AppstoreOutlined />
            </button>
            <button
              type="button"
              class="icon-btn"
              :class="{ active: viewMode === 'list' }"
              title="列表视图"
              @click="viewMode = 'list'"
            >
              <UnorderedListOutlined />
            </button>
          </div>
          <a-button type="primary" :loading="busy" @click="createBoard">
            <template #icon><PlusOutlined /></template>
            新建画板
          </a-button>
        </div>
      </div>

      <div v-if="loading" class="list-empty">正在读取我的画板…</div>

      <template v-else>
        <div v-if="viewMode === 'grid'" class="board-grid">
          <article
            v-for="board in filtered"
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

            <button
              type="button"
              class="icon-btn board-star"
              :class="{ on: isFavorite(board.id) }"
              :title="isFavorite(board.id) ? '取消收藏' : '收藏画板'"
              @click.stop="toggleFavorite(board.id)"
            >
              <StarFilled v-if="isFavorite(board.id)" />
              <StarOutlined v-else />
            </button>

            <div class="board-card-actions" @click.stop>
              <button class="icon-btn" title="打开画板" @click="openBoard(board.id)">
                <FolderOpenOutlined />
              </button>
              <button class="icon-btn" title="重命名" @click="startRename(board)">
                <EditOutlined />
              </button>
              <button class="icon-btn" title="复制画板" @click="duplicateBoard(board.id)">
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

          <button type="button" class="new-card" @click="createBoard">
            <span class="plus"><PlusOutlined /></span>
            <span>新建空白画板</span>
          </button>
        </div>

        <div v-else class="board-list">
          <article
            v-for="board in filtered"
            :key="board.id"
            class="board-row"
            @click="openBoard(board.id)"
          >
            <div class="row-thumb">
              <img v-if="board.thumbnail" :src="board.thumbnail" :alt="board.name" />
              <span v-else class="empty-glyph">EMPTY</span>
            </div>
            <div class="row-main">
              <span class="row-name" :title="board.name">{{ board.name }}</span>
              <span class="row-sub">
                {{ formatTime(board.updatedAt) }} · {{ board.objectCount }} 个对象
              </span>
            </div>
            <div class="row-actions" @click.stop>
              <button
                type="button"
                class="icon-btn"
                :class="{ on: isFavorite(board.id) }"
                :title="isFavorite(board.id) ? '取消收藏' : '收藏画板'"
                @click="toggleFavorite(board.id)"
              >
                <StarFilled v-if="isFavorite(board.id)" />
                <StarOutlined v-else />
              </button>
              <button class="icon-btn" title="打开画板" @click="openBoard(board.id)">
                <FolderOpenOutlined />
              </button>
              <button class="icon-btn" title="重命名" @click="startRename(board)">
                <EditOutlined />
              </button>
              <button class="icon-btn" title="复制画板" @click="duplicateBoard(board.id)">
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

        <div v-if="!filtered.length" class="list-empty">
          {{ boards.length ? '没有找到匹配的画板' : '还没有画板，点击「新建画板」开始创作' }}
        </div>
      </template>

      <footer class="list-footer">
        <span>共 {{ boards.length }} 个画板 · 已用 {{ formatBytes(usage.bytes) }}</span>
        <span>登录账号隔离 · Vue 3 · fabric.js</span>
      </footer>
    </div>

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

.list-tools {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.sort-select {
  width: 128px;
}

.view-toggle {
  display: flex;
  gap: 4px;
}

.view-toggle .icon-btn.active {
  color: #fff;
  border-color: rgba(124, 140, 255, 0.6);
  background: rgba(124, 140, 255, 0.2);
}

.board-card-actions {
  right: 48px;
}

.board-star {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
}

.board-star.on,
.row-actions .icon-btn.on {
  color: #f3c46b;
  border-color: rgba(243, 196, 107, 0.55);
  background: rgba(243, 196, 107, 0.16);
}

.board-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.board-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: linear-gradient(180deg, #141824, #10131c);
  cursor: pointer;
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.board-row:hover {
  transform: translateY(-1px);
  border-color: #343d59;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.32);
}

.row-thumb {
  width: 72px;
  height: 45px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: #0e1119;
}

.row-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.row-thumb .empty-glyph {
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--text-faint);
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.row-name {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-sub {
  font-size: 11.5px;
  color: var(--text-faint);
}

.row-actions {
  display: flex;
  gap: 4px;
  flex: none;
}

.row-actions .icon-btn {
  width: 28px;
  height: 28px;
}

@media (max-width: 640px) {
  .sort-select {
    width: 108px;
  }

  .board-row {
    gap: 10px;
  }
}
</style>
