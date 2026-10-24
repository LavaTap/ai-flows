<script setup lang="ts">
import { ref } from 'vue'
import { ThunderboltOutlined } from '@ant-design/icons-vue'
import { AI_MODELS, AI_STYLES, generateArtwork } from '@/api/ai'

const emit = defineEmits<{ generated: [images: string[]] }>()

const prompt = ref('')
const modelId = ref(AI_MODELS[0]!.id)
const style = ref<string>(AI_STYLES[0])
const count = ref(1)
const loading = ref(false)
const error = ref('')
const previews = ref<string[]>([])
const elapsed = ref(0)

async function run(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const result = await generateArtwork({
      prompt: prompt.value,
      style: style.value,
      modelId: modelId.value,
      count: count.value,
    })
    previews.value = result.images
    elapsed.value = result.elapsed
    emit('generated', result.images)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '生成失败，请重试'
  } finally {
    loading.value = false
  }
}

function selectStyle(value: string): void {
  style.value = value
}
</script>

<template>
  <div class="panel-scroll">
    <div class="panel-title">
      <span>智能生成</span>
      <span>离线模拟</span>
    </div>

    <div class="ai-field">
      <div class="field-label"><span>模型 / 工作流</span></div>
      <a-select
        v-model:value="modelId"
        size="small"
        :options="AI_MODELS.map((model) => ({ value: model.id, label: model.label }))"
        style="width: 100%"
      />
      <div class="panel-note" style="margin-top: 8px">
        {{ AI_MODELS.find((model) => model.id === modelId)?.hint }}
      </div>
    </div>

    <div class="ai-field">
      <div class="field-label"><span>画面风格</span></div>
      <div class="ai-chips">
        <button
          v-for="item in AI_STYLES"
          :key="item"
          type="button"
          class="ai-chip"
          :class="{ active: style === item }"
          @click="selectStyle(item)"
        >
          {{ item }}
        </button>
      </div>
    </div>

    <div class="ai-field">
      <div class="field-label"><span>描述词</span><span>{{ prompt.length }}/300</span></div>
      <a-textarea
        v-model:value="prompt"
        :rows="4"
        :maxlength="300"
        placeholder="例如：漂浮在星海中的玻璃城市，霓虹描边，超广角"
      />
    </div>

    <div class="ai-field">
      <div class="field-label"><span>数量</span></div>
      <div class="count-group">
        <button
          v-for="value in [1, 2, 4]"
          :key="value"
          type="button"
          class="count-btn"
          :class="{ active: count === value }"
          @click="count = value"
        >
          {{ value }} 张
        </button>
      </div>
    </div>

    <button type="button" class="ai-submit" :disabled="loading" @click="run">
      <ThunderboltOutlined />
      {{ loading ? '生成中…' : '生成并放入画布' }}
    </button>

    <div v-if="error" class="panel-note" style="color: #ff8a9a">{{ error }}</div>

    <div v-if="previews.length" class="ai-preview">
      <img v-for="(src, index) in previews" :key="index" :src="src" alt="生成结果" />
    </div>

    <div v-if="elapsed" class="panel-note">
      本次耗时 {{ (elapsed / 1000).toFixed(1) }}s。当前为本地程序化预览，接入真实模型后替换
      <code>src/api/ai.ts</code> 即可。
    </div>

    <div class="panel-note">
      演示版不请求云端。生成结果以图片对象插入画布，可继续移动、缩放、改透明度。
    </div>
  </div>
</template>
