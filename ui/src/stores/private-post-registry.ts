import { computed, ref } from 'vue'

import { listPrivatePosts } from '@/api/private-posts'
import type { PrivatePost } from '@/types/private-post'

const items = ref<PrivatePost[]>([])
const loaded = ref(false)

let pendingLoad: Promise<void> | null = null

export const privatePostRegistryItems = computed(() => items.value)
export const privatePostRegistryLoaded = computed(() => loaded.value)

export async function ensurePrivatePostRegistryLoaded(force = false): Promise<void> {
  if (loaded.value && !force) {
    return
  }

  if (pendingLoad) {
    return pendingLoad
  }

  pendingLoad = (async () => {
    items.value = await listPrivatePosts()
    loaded.value = true
  })()

  try {
    await pendingLoad
  } finally {
    pendingLoad = null
  }
}

export function syncPrivatePostRegistry(nextItems: PrivatePost[]): void {
  items.value = [...nextItems]
  loaded.value = true
}

export function findPrivatePostByPostName(postName: string): PrivatePost | undefined {
  return items.value.find((item) => item.spec.postName === postName)
}
