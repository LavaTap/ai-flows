<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AI_CAPABILITIES } from '@/core/ai/capabilities'
import { aiIconOf } from '@/core/ai/icons'
import { needsSource, type SourceImage } from '@/core/ai/processors'
import AiToolWorkspace from '@/components/ai/AiToolWorkspace.vue'

/**
 * AI 工作台：左侧列出全部 AI 工具，右侧是单个工具的工作区。
 * 对应参考项目的 `/workspace/<feature>` 形态，每个工具一个独立路由 `#/ai/<key>`。
 */

const route = useRoute()
const router = useRouter()

const source = ref<SourceImage | null>(null)

const key = computed(() => String(route.params.key ?? ''))
const capability = computed(() => AI_CAPABILITIES.find((item) => item.key === key.value) ?? null)

watch(
  capability,
  (value) => {
    if (!value) void router.replace(`/ai/${AI_CAPABILITIES[0]!.key}`)
  },
  { immediate: true },
)
</script>

<template>
  <div class="ai-studio">
    <aside class="ai-studio-side">
      <div class="ai-studio-brand">
        <div class="brand-mark" />
        <div>
          <h2>AI 工作台</h2>
          <router-link to="/">← 返回自由画布</router-link>
        </div>
      </div>

      <nav class="ai-studio-nav">
        <router-link
          v-for="item in AI_CAPABILITIES"
          :key="item.key"
          :to="`/ai/${item.key}`"
          class="ai-nav-item"
          :class="{ active: item.key === key }"
        >
          <component :is="aiIconOf(item.icon)" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <p class="ai-studio-foot">
        共 {{ AI_CAPABILITIES.length }} 个工具，结果可直接存入「我的素材」，在画布里随时取用。
      </p>
    </aside>

    <main v-if="capability" class="ai-studio-main">
      <header class="ai-studio-topbar">
        <span class="ai-tool-icon"><component :is="aiIconOf(capability.icon)" /></span>
        <div class="ai-tool-title">
          <h1>{{ capability.label }}</h1>
          <p>{{ capability.desc }}</p>
        </div>
        <span class="ai-route">#/ai/{{ key }}</span>
        <span v-if="needsSource(key)" class="ai-badge">需要源图</span>
        <span v-else class="ai-badge alt">纯生成</span>
        <span class="ai-spacer" />
        <router-link to="/assets" class="ai-ghost-btn">素材库</router-link>
        <a href="/home" class="ai-ghost-btn">返回平台</a>
      </header>

      <AiToolWorkspace :capability="capability" :source="source" @update:source="source = $event" />
    </main>
  </div>
</template>
