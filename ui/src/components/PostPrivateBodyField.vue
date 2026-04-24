<script setup lang="ts">
import { VButton, VTag } from '@halo-dev/components'
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

const manageRoute = computed(() => ({
  name: 'HaloPrivatePosts',
  query: {
    postName: props.postName,
  },
}))
</script>

<template>
  <div class="private-post-field">
    <VTag :theme="statusTheme" rounded>
      {{ statusLabel }}
    </VTag>
    <VButton size="xs" type="secondary" ghost :route="manageRoute">
      {{ matchedPrivatePost ? '编辑私密正文' : '配置私密正文' }}
    </VButton>
  </div>
</template>

<style scoped>
.private-post-field {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
</style>
