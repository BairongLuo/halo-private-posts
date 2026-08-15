<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  postName: string
  sourceAnnotations?: Record<string, string> | undefined
}>()

const configured = ref(false)

watch(
  () => props.sourceAnnotations,
  (annotations) => {
    configured.value = Boolean(annotations?.['privateposts.halo.run/hide-password']?.trim())
  },
  { immediate: true },
)
</script>

<template>
  <span v-if="configured" class="hpp-list-state" :title="`文章 ${postName} 已设置内容隐藏密码`">
    🔒 已设密码
  </span>
</template>

<style scoped>
.hpp-list-state {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-warning, #d97706);
  background: var(--color-warning-soft, #fef3c7);
}
</style>
