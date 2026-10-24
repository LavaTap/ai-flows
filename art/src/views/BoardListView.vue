<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import {
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons-vue'
import { boardApi } from '@/api/board'
import { fetchMe, type PlatformUser } from '@/api/client'
import type { BoardMeta } from '@/types/board'

const router = useRouter()

const boards = ref<BoardMeta[]>([])
const keyword = ref('')
const loading = ref(true)
const usage = ref({ boards: 0, bytes: 0 })
const busy = ref(false)
const me = ref<PlatformUser | null>(null)

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (!query) return boards.value
  return boards.value.filter((board) => board.name.toLowerCase().includes(query))
})

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

      <div class="list-head">
        <div>
          <h1>我的无限画板</h1>
          <p>图形、文字、图片与智能生成，按账号隔离保存在平台，换设备也能接着画。</p>
        </div>
        <div class="list-tools">
          <a-input v-model:value="keyword" allow-clear placeholder="搜索画板名称">
            <template #prefix><SearchOutlined /></template>
          </a-input>
          <a-button type="primary" :loading="busy" @click="createBoard">
            <template #icon><PlusOutlined /></template>
            新建画板
          </a-button>
        </div>
      </div>

      <div v-if="loading" class="list-empty">正在读取我的画板…</div>

      <div v-else class="board-grid">
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

          <div class="board-card-actions" @click.stop>
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

      <div v-if="!loading && !filtered.length && boards.length" class="list-empty">
        没有找到匹配的画板
      </div>

      <footer class="list-footer">
        <span>共 {{ boards.length }} 个画板 · 已用 {{ formatBytes(usage.bytes) }}</span>
        <span>登录账号隔离 · Vue 3 · fabric.js</span>
      </footer>
    </div>
  </div>
</template>
