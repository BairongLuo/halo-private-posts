<script setup lang="ts">
import { IconLockPasswordLine, VDropdownItem } from '@halo-dev/components'

defineProps<{
  onSelect: () => void
}>()
</script>

<template>
  <VDropdownItem @click="onSelect">
    <template #prefix-icon>
      <IconLockPasswordLine />
    </template>
    文章加密
  </VDropdownItem>
</template>
