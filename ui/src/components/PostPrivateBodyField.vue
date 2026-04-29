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
  return matchedPrivatePost.value ? '已加锁' : '未加锁'
})
</script>

<template>
  <div class="private-post-field">
    <VTag v-if="privatePostRegistryLoaded" :theme="statusTheme" rounded>
      {{ statusLabel }}
    </VTag>
  </div>
</template>

<style scoped>
.private-post-field {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
}
</style>
