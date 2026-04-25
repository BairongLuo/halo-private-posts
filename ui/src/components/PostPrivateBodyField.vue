<script setup lang="ts">
import { VTag } from '@halo-dev/components'
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import {
  ensurePrivatePostRegistryLoaded,
  findPrivatePostByPostName,
  privatePostRegistryLoaded,
} from '@/stores/private-post-registry'

const props = defineProps<{
  postName: string
}>()
const router = useRouter()

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

const actionLabel = computed(() => {
  if (!privatePostRegistryLoaded.value) {
    return '稍后进入配置页'
  }

  return matchedPrivatePost.value ? '查看配置' : '立即配置'
})

async function navigateToConfig() {
  await router.push({
    name: 'HaloPrivatePosts',
    query: {
      postName: props.postName,
    },
  })
}
</script>

<template>
  <div class="private-post-field">
    <VTag :theme="statusTheme" rounded>
      {{ statusLabel }}
    </VTag>
    <button class="private-post-action" type="button" @click="navigateToConfig">
      {{ actionLabel }}
    </button>
  </div>
</template>

<style scoped>
.private-post-field {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.private-post-action {
  border: 0;
  background: transparent;
  padding: 0;
  color: #2563eb;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.private-post-action:hover {
  color: #1d4ed8;
  text-decoration: underline;
}
</style>
