<script setup lang="ts">
import { CloseOutlined } from '@ant-design/icons-vue'
import { AI_CAPABILITIES, type AiCapability } from '@/core/ai/capabilities'
import { aiIconOf } from '@/core/ai/icons'

const props = defineProps<{ x: number; y: number }>()
const emit = defineEmits<{ pick: [capability: AiCapability]; close: [] }>()
</script>

<template>
  <div
    class="ai-tool-menu"
    :style="{ left: `${props.x}px`, top: `${props.y}px` }"
    @pointerdown.stop
  >
    <div class="ai-tool-menu-head">
      <span>AI 工具</span>
      <button type="button" class="ai-tool-menu-close" title="关闭" @click="emit('close')">
        <CloseOutlined />
      </button>
    </div>
    <div class="ai-tool-menu-grid">
      <button
        v-for="capability in AI_CAPABILITIES"
        :key="capability.key"
        type="button"
        class="ai-tool-chip"
        :title="capability.desc"
        @click="emit('pick', capability)"
      >
        <component :is="aiIconOf(capability.icon)" />
        <span>{{ capability.label }}</span>
      </button>
    </div>
  </div>
</template>
