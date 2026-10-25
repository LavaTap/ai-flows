<script setup lang="ts">
import type { AiCapability } from '@/core/ai/capabilities'

/** 参数表单：按 capability.fields 渲染控件，供 AI 工作台与画布内面板复用 */

const props = defineProps<{
  capability: AiCapability
  values: Record<string, string | number>
}>()

const emit = defineEmits<{ 'update:values': [values: Record<string, string | number>] }>()

function stringValue(key: string): string {
  const value = props.values[key]
  return value === undefined ? '' : String(value)
}

function numberValue(key: string): number {
  const value = Number(props.values[key])
  return Number.isFinite(value) ? value : 0
}

function setValue(key: string, value: string | number): void {
  emit('update:values', { ...props.values, [key]: value })
}
</script>

<template>
  <div class="ai-param-fields">
    <div v-for="field in props.capability.fields" :key="field.key" class="ai-field">
      <div class="field-label">
        <span>{{ field.label }}</span>
        <span v-if="field.kind === 'range'" class="ai-range-value">{{ numberValue(field.key) }}</span>
      </div>

      <a-select
        v-if="field.kind === 'select'"
        size="small"
        style="width: 100%"
        :value="stringValue(field.key)"
        :options="field.options"
        @update:value="(value: string) => setValue(field.key, value)"
      />

      <a-slider
        v-else-if="field.kind === 'range'"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        :value="numberValue(field.key)"
        @update:value="(value: number) => setValue(field.key, value)"
      />

      <div v-else-if="field.kind === 'chips'" class="ai-chips">
        <button
          v-for="option in field.options"
          :key="option"
          type="button"
          class="ai-chip"
          :class="{ active: stringValue(field.key) === option }"
          @click="setValue(field.key, option)"
        >
          {{ option }}
        </button>
      </div>

      <a-textarea
        v-else
        :rows="3"
        :maxlength="200"
        :value="stringValue(field.key)"
        :placeholder="field.placeholder"
        @update:value="(value: string) => setValue(field.key, value)"
      />
    </div>
  </div>
</template>
