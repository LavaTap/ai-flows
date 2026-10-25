<script setup lang="ts">
import { AI_CAPABILITIES, type AiCapability } from '@/core/ai/capabilities'
import { aiIconOf } from '@/core/ai/icons'

const emit = defineEmits<{ pick: [capability: AiCapability] }>()
</script>

<template>
  <div class="ai-toolbar">
    <span class="ai-toolbar-title">AI 工具</span>
    <div class="ai-toolbar-scroll">
      <a-tooltip v-for="capability in AI_CAPABILITIES" :key="capability.key" :title="capability.desc">
        <button type="button" class="ai-tool-chip" @click="emit('pick', capability)">
          <component :is="aiIconOf(capability.icon)" />
          <span>{{ capability.label }}</span>
        </button>
      </a-tooltip>
    </div>
  </div>
</template>
