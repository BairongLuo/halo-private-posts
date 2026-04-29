<script setup lang="ts">
import { VTag } from '@halo-dev/components'
import { computed, onMounted } from 'vue'

import {
  ensurePrivatePostRegistryLoaded,
  findPrivatePostByPostName,
  privatePostRegistryLoaded,
} from '@/stores/private-post-registry'

const props = defineProps<{
  postName: string
}>()

onMounted(() => {
  void ensurePrivatePostRegistryLoaded()
})

const matchedPrivatePost = computed(() => findPrivatePostByPostName(props.postName))
const statusTheme = computed(() => {
  if (!privatePostRegistryLoaded.value) {
    return 'secondary'
  }

  return matchedPrivatePost.value ? 'primary' : 'default'
})

const statusLabel = computed(() => {
  if (!privatePostRegistryLoaded.value) {
    return '私密正文检查中'
  }

  return matchedPrivatePost.value ? '已配置私密正文' : '未配置私密正文'
})

const hintLabel = computed(() => {
  if (!privatePostRegistryLoaded.value) {
    return '请在文章编辑页操作'
  }

  return matchedPrivatePost.value ? '在文章编辑页管理' : '在文章编辑页设置'
})
</script>

<template>
  <div class="private-post-field">
    <VTag :theme="statusTheme" rounded>
      {{ statusLabel }}
    </VTag>
    <span class="private-post-hint">{{ hintLabel }}</span>
  </div>
</template>

<style scoped>
.private-post-field {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.private-post-hint {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}
</style>
