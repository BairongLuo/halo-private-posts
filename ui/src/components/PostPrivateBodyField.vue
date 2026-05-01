<script setup lang="ts">
import { VTag } from '@halo-dev/components'
import { computed, onMounted } from 'vue'

import {
  ensurePrivatePostRegistryLoaded,
  findPrivatePostByPostName,
  privatePostRegistryLoaded,
} from '@/stores/private-post-registry'
import { resolvePrivatePostListLockState } from '@/components/private-post-list-lock-state'
import { openPostEncryptionEditor } from '@/utils/open-post-encryption-editor'

const props = defineProps<{
  postName: string
  sourceAnnotationsPresent: boolean
  sourceBundleText?: string
}>()

onMounted(() => {
  void ensurePrivatePostRegistryLoaded(true)
})

const matchedPrivatePost = computed(() => findPrivatePostByPostName(props.postName))
const lockState = computed(() => resolvePrivatePostListLockState({
  sourceAnnotationsPresent: props.sourceAnnotationsPresent,
  sourceBundleText: props.sourceBundleText,
  registryLoaded: privatePostRegistryLoaded.value,
  registryHasPrivatePost: Boolean(matchedPrivatePost.value),
}))
const statusTheme = computed(() => {
  if (!lockState.value.resolved) {
    return 'secondary'
  }

  return lockState.value.locked ? 'primary' : 'default'
})

const statusLabel = computed(() => {
  return lockState.value.locked ? '已加锁' : '未加锁'
})

function handleClick(): void {
  openPostEncryptionEditor(props.postName)
}
</script>

<template>
  <div class="private-post-field">
    <button
      v-if="lockState.resolved"
      type="button"
      class="private-post-field-button"
      :title="`打开${statusLabel}文章的设置页`"
      @click.stop="handleClick"
    >
      <VTag :theme="statusTheme" rounded>
        {{ statusLabel }}
      </VTag>
    </button>
  </div>
</template>

<style scoped>
.private-post-field {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
}

.private-post-field-button {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.private-post-field-button:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
  border-radius: 999px;
}
</style>
