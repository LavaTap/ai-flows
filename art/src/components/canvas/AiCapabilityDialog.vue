<script setup lang="ts">
import { ref, watch } from 'vue'
import type { AiCapability } from '@/core/ai/capabilities'

const props = defineProps<{
  open: boolean
  capability: AiCapability | null
}>()

const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const values = ref<Record<string, string | number>>({})

function stringValue(key: string): string {
  const value = values.value[key]
  return value === undefined ? '' : String(value)
}

function numberValue(key: string): number {
  const value = Number(values.value[key])
  return Number.isFinite(value) ? value : 0
}

function setValue(key: string, value: string | number): void {
  values.value = { ...values.value, [key]: value }
}

function resetValues(): void {
  const capability = props.capability
  if (!capability) {
    values.value = {}
    return
  }
  const next: Record<string, string | number> = {}
  capability.fields.forEach((field) => {
    next[field.key] = field.default
  })
  values.value = next
}

function close(): void {
  emit('update:open', false)
}

watch(
  () => [props.open, props.capability] as const,
  () => {
    if (props.open) resetValues()
  },
  { immediate: true },
)
</script>

<template>
  <a-modal
    :open="props.open"
    :title="props.capability?.label ?? 'AI 能力'"
    :width="460"
    :mask-closable="false"
    @cancel="close"
  >
    <div v-if="props.capability" class="ai-dialog">
      <p class="ai-dialog-desc">{{ props.capability.desc }}</p>
      <div class="ai-dialog-hint">该能力界面已就绪，接入 AI 服务后即可使用。</div>

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
          :maxlength="120"
          :value="stringValue(field.key)"
          :placeholder="field.placeholder"
          @update:value="(value: string) => setValue(field.key, value)"
        />
      </div>
    </div>

    <template #footer>
      <div class="ai-dialog-footer">
        <a-button @click="close">取消</a-button>
        <a-button type="primary" disabled>提交（AI 能力待接入）</a-button>
      </div>
    </template>
  </a-modal>
</template>
