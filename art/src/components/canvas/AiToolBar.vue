<script setup lang="ts">
import type { Component } from 'vue'
import {
  AimOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  CompassOutlined,
  ExpandOutlined,
  FormOutlined,
  FormatPainterOutlined,
  PictureOutlined,
  ScissorOutlined,
  SlidersOutlined,
  ThunderboltOutlined,
  VideoCameraOutlined,
  ZoomInOutlined,
} from '@ant-design/icons-vue'
import { AI_CAPABILITIES, type AiCapability } from '@/core/ai/capabilities'

const emit = defineEmits<{ pick: [capability: AiCapability] }>()

/** 能力清单里的 icon 是组件名，这里集中映射成真实的图标组件 */
const ICON_MAP: Record<string, Component> = {
  FormOutlined,
  PictureOutlined,
  SlidersOutlined,
  ScissorOutlined,
  ZoomInOutlined,
  ApartmentOutlined,
  ExpandOutlined,
  CompassOutlined,
  FormatPainterOutlined,
  AimOutlined,
  VideoCameraOutlined,
  AppstoreOutlined,
}

function iconOf(name: string): Component {
  return ICON_MAP[name] ?? ThunderboltOutlined
}
</script>

<template>
  <div class="ai-toolbar">
    <span class="ai-toolbar-title">AI 工具</span>
    <div class="ai-toolbar-scroll">
      <a-tooltip v-for="capability in AI_CAPABILITIES" :key="capability.key" :title="capability.desc">
        <button type="button" class="ai-tool-chip" @click="emit('pick', capability)">
          <component :is="iconOf(capability.icon)" />
          <span>{{ capability.label }}</span>
        </button>
      </a-tooltip>
    </div>
  </div>
</template>
