<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getHaloPostByName, persistPrivatePostBundleAnnotation } from '@/api/posts'
import { buildPrivatePostResource, listPrivatePosts, updatePrivatePost } from '@/api/private-posts'
import type { HaloPostSummary } from '@/api/posts'
import type { EncryptedPrivatePostBundle, PrivatePost } from '@/types/private-post'
import { syncPrivatePostRegistry } from '@/stores/private-post-registry'
import { listLocalAuthorKeys } from '@/utils/author-key-store'
import { ensureDefaultAuthorKey } from '@/utils/default-author-key'
import { rewrapPrivatePostPassword } from '@/utils/private-post-crypto'

const route = useRoute()
const router = useRouter()

const items = ref<PrivatePost[]>([])
const loading = ref(false)
const loadingSelectedPost = ref(false)
const resettingPassword = ref(false)
const errorMessage = ref('')
const selectedPost = ref<HaloPostSummary | null>(null)
const nextPassword = ref('')
const passwordMessage = ref('')
const passwordMessageTone = ref<'neutral' | 'success' | 'error'>('neutral')
const localAuthorKeys = ref(listLocalAuthorKeys())

const routePostName = computed(() => readQueryString(route.query.postName))
const selectedPostMapping = computed(() => {
  if (!routePostName.value) {
    return null
  }

  return items.value.find((item) => item.spec.postName === routePostName.value) ?? null
})
const displayItems = computed(() => {
  if (!routePostName.value) {
    return items.value
  }

  return items.value.filter((item) => item.spec.postName === routePostName.value)
})
const selectedArticleTitle = computed(() => {
  if (selectedPost.value?.title) {
    return selectedPost.value.title
  }

  return selectedPostMapping.value?.spec.title ?? ''
})
const selectedArticleSlug = computed(() => {
  if (selectedPost.value?.slug) {
    return selectedPost.value.slug
  }

  return selectedPostMapping.value?.spec.slug ?? ''
})
const matchingLocalAuthorKey = computed(() => {
  const mapping = selectedPostMapping.value
  if (!mapping) {
    return null
  }

  const authorSlotFingerprints = new Set(mapping.spec.bundle.author_slots.map((slot) => slot.key_id))
  if (authorSlotFingerprints.size === 0) {
    return null
  }

  return localAuthorKeys.value.find((item) => authorSlotFingerprints.has(item.fingerprint)) ?? null
})
const hasAnyLocalAuthorKey = computed(() => localAuthorKeys.value.length > 0)
const passwordResetAvailability = computed(() => {
  const mapping = selectedPostMapping.value
  if (!routePostName.value) {
    return '先从列表里选中一篇文章，再在这里重设访问口令。'
  }

  if (!mapping) {
    return '当前文章还没有同步出私密正文，暂时不能重设访问口令。'
  }

  if (mapping.spec.bundle.author_slots.length === 0) {
    return '这篇文章没有作者钥匙槽，当前版本不能在后台重设口令。'
  }

  if (!hasAnyLocalAuthorKey.value) {
    return '当前浏览器还没有可用的隐藏作者私钥。请先回文章设置页重新加锁一次，系统会补齐当前浏览器可用的默认钥匙。'
  }

  if (!matchingLocalAuthorKey.value) {
    return '当前浏览器已有隐藏作者私钥，但这篇文章仍绑定旧作者钥匙。回文章设置页重新加锁一次后，后台就可以直接覆盖口令。'
  }

  return '后台只会重写 password_slot，不会改动正文密文，也不会显示旧口令。'
})
const canResetPassword = computed(() => {
  return Boolean(
    selectedPostMapping.value
    && matchingLocalAuthorKey.value
    && selectedPostMapping.value.spec.bundle.author_slots.length > 0
  )
})

onMounted(async () => {
  await warmupHiddenAuthorKey()
  await refreshItems()
  await syncSelectionFromRoute()
})

watch(routePostName, () => {
  nextPassword.value = ''
  clearPasswordMessage()
  void syncSelectionFromRoute()
})

async function refreshItems() {
  loading.value = true
  errorMessage.value = ''
  try {
    items.value = await listPrivatePosts()
    syncPrivatePostRegistry(items.value)
  } catch (error) {
    errorMessage.value = `加载已加密文章失败：${toMessage(error)}`
  } finally {
    loading.value = false
  }
}

async function syncSelectionFromRoute() {
  if (!routePostName.value) {
    selectedPost.value = null
    return
  }

  loadingSelectedPost.value = true
  try {
    selectedPost.value = await getHaloPostByName(routePostName.value)
  } catch (error) {
    selectedPost.value = null
    errorMessage.value = `加载关联文章失败：${toMessage(error)}`
  } finally {
    loadingSelectedPost.value = false
  }
}

async function clearSelectedPost() {
  const nextQuery = {
    ...route.query,
  }

  delete nextQuery.postName
  await router.replace({
    name: 'HaloPrivatePosts',
    query: nextQuery,
  })
}

async function selectPost(postName: string) {
  await router.replace({
    name: 'HaloPrivatePosts',
    query: {
      ...route.query,
      postName,
    },
  })
}

function clearPasswordMessage() {
  passwordMessage.value = ''
  passwordMessageTone.value = 'neutral'
}

function setPasswordMessage(tone: 'neutral' | 'success' | 'error', message: string) {
  passwordMessageTone.value = tone
  passwordMessage.value = message
}

async function resetPassword() {
  clearPasswordMessage()

  const mapping = selectedPostMapping.value
  const localAuthorKey = matchingLocalAuthorKey.value
  const normalizedPassword = nextPassword.value.trim()

  if (!mapping) {
    setPasswordMessage('error', '请先选择一篇已加密文章。')
    return
  }

  if (!normalizedPassword) {
    setPasswordMessage('error', '请输入新的访问口令。')
    return
  }

  if (!localAuthorKey) {
    setPasswordMessage(
      'error',
      hasAnyLocalAuthorKey.value
        ? '当前浏览器已有隐藏作者私钥，但这篇文章绑定的是旧钥匙。请回文章设置页重新加锁一次。'
        : '当前浏览器没有隐藏作者私钥，不能重设口令。请先回文章设置页重新加锁一次。'
    )
    return
  }

  resettingPassword.value = true

  try {
    const nextBundle = await rewrapPrivatePostPassword(
      mapping.spec.bundle,
      normalizedPassword,
      localAuthorKey.privateKey
    )
    const nextBundleText = JSON.stringify(nextBundle, null, 2)
    const nextPrivatePost = buildPrivatePostResource({
      bundle: nextBundle,
      postName: mapping.spec.postName,
      existing: mapping,
    })
    await persistPrivatePostBundleAnnotation(mapping.spec.postName, nextBundleText)
    const updatedPrivatePost = await updatePrivatePost(nextPrivatePost)
    applyOptimisticBundle(mapping.spec.postName, nextBundle)
    replaceItem(updatedPrivatePost)
    nextPassword.value = ''
    setPasswordMessage(
      'success',
      '访问口令已覆盖。正文密文和作者钥匙槽没有变化，阅读端会立即使用新的 password_slot。'
    )
  } catch (error) {
    setPasswordMessage('error', `重设访问口令失败：${toMessage(error)}`)
  } finally {
    resettingPassword.value = false
  }
}

function applyOptimisticBundle(postName: string, nextBundle: EncryptedPrivatePostBundle) {
  items.value = items.value.map((item) => {
    if (item.spec.postName !== postName) {
      return item
    }

    return {
      ...item,
      spec: {
        ...item.spec,
        bundle: nextBundle,
      },
    }
  })

  syncPrivatePostRegistry(items.value)
}

function replaceItem(nextItem: PrivatePost) {
  items.value = items.value.map((item) => {
    return item.metadata.name === nextItem.metadata.name ? nextItem : item
  })

  syncPrivatePostRegistry(items.value)
}

async function warmupHiddenAuthorKey() {
  syncLocalAuthorKeyFingerprints()

  try {
    await ensureDefaultAuthorKey()
  } catch (error) {
    console.warn('Failed to warm up hidden author key.', error)
  } finally {
    syncLocalAuthorKeyFingerprints()
  }
}

function syncLocalAuthorKeyFingerprints() {
  localAuthorKeys.value = listLocalAuthorKeys()
}

function formatTimestamp(value?: string) {
  if (!value) {
    return '未设置'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function readQueryString(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误'
}
</script>

<template>
  <section class="private-posts-view">
    <header class="hero">
      <div>
        <p class="eyebrow">Halo Private Posts</p>
        <h1>重设私密文章口令</h1>
        <p class="summary">
          文章端负责加锁，后台只负责一件事：对已加密文章重设或覆盖访问口令。
        </p>
      </div>
      <div class="hero-actions">
        <button class="hero-button" type="button" :disabled="loading" @click="refreshItems">
          {{ loading ? '刷新中…' : '刷新列表' }}
        </button>
        <button v-if="routePostName" class="hero-button secondary" type="button" @click="clearSelectedPost">
          清除筛选
        </button>
      </div>
    </header>

    <div class="banner error" v-if="errorMessage">{{ errorMessage }}</div>

    <section class="focus-card">
      <div class="focus-head">
        <div>
          <span class="state-pill" :class="{ active: selectedPostMapping }">
            {{ selectedPostMapping ? '当前文章可处理' : '当前未选中文章' }}
          </span>
          <span v-if="routePostName" class="state-pill subtle">{{ routePostName }}</span>
        </div>
        <span class="focus-loading" v-if="loadingSelectedPost">载入中…</span>
      </div>

      <template v-if="routePostName && (selectedPost || selectedPostMapping)">
        <h2>{{ selectedArticleTitle || routePostName }}</h2>
        <p v-if="selectedArticleSlug" class="focus-slug">{{ selectedArticleSlug }}</p>
        <p class="focus-excerpt" v-if="selectedPost?.excerpt">{{ selectedPost.excerpt }}</p>

        <section class="reset-panel">
          <div>
            <h3>重设/覆盖口令</h3>
            <p class="reset-copy">{{ passwordResetAvailability }}</p>
          </div>

          <label class="reset-field">
            <span>新访问口令</span>
            <input
              v-model="nextPassword"
              type="password"
              class="reset-input"
              autocomplete="new-password"
              placeholder="输入新的访问口令"
            />
          </label>

          <div class="focus-actions">
            <button
              class="action-button"
              type="button"
              :disabled="resettingPassword || !canResetPassword"
              @click="resetPassword"
            >
              {{ resettingPassword ? '覆盖中…' : '覆盖访问口令' }}
            </button>
            <button class="action-button secondary" type="button" @click="clearSelectedPost">
              返回列表
            </button>
          </div>

          <p v-if="passwordMessage" class="password-message" :data-tone="passwordMessageTone">
            {{ passwordMessage }}
          </p>
        </section>
      </template>

      <p v-else class="focus-excerpt">
        从下方列表选中一篇已加密文章，然后在这里覆盖访问口令。后台不会显示旧口令，也不会暴露作者钥匙。
      </p>
    </section>

    <div class="overview-grid">
      <section class="overview-card">
        <h2>当前状态</h2>
        <dl class="overview-stats">
          <div>
            <dt>已同步加密文章</dt>
            <dd>{{ items.length }}</dd>
          </div>
          <div>
            <dt>当前筛选结果</dt>
            <dd>{{ displayItems.length }}</dd>
          </div>
        </dl>
      </section>
    </div>

    <section class="list-card">
      <div class="card-header">
        <div>
          <h2>已加密文章</h2>
          <p>这里只列出已经由文章设置同步成功的条目。每篇文章在后台只有一个动作：修改口令。</p>
        </div>
      </div>

      <div class="empty-state" v-if="!loading && displayItems.length === 0">
        {{ routePostName ? '当前文章还没有同步出私密正文。' : '当前还没有已同步的加密文章。' }}
      </div>

      <ul class="post-list" v-else>
        <li
          v-for="item in displayItems"
          :key="item.metadata.name"
          class="post-item"
          :class="{ focused: item.spec.postName === routePostName }"
        >
          <div class="post-item-header">
            <div>
              <h3>{{ item.spec.title }}</h3>
              <p>{{ item.spec.slug }}</p>
            </div>
            <span class="pill">{{ item.spec.postName }}</span>
          </div>

          <dl class="post-item-meta">
            <div>
              <dt>发布时间</dt>
              <dd>{{ formatTimestamp(item.spec.publishedAt) }}</dd>
            </div>
            <div>
              <dt>资源名</dt>
              <dd>{{ item.metadata.name }}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{{ formatTimestamp(item.metadata.creationTimestamp) }}</dd>
            </div>
          </dl>

          <p class="post-item-excerpt">{{ item.spec.excerpt || '无公开摘要' }}</p>

          <div class="post-item-actions">
            <button class="action-button" type="button" @click="selectPost(item.spec.postName)">
              {{ item.spec.postName === routePostName ? '正在修改口令' : '修改口令' }}
            </button>
          </div>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.private-posts-view {
  min-height: 100vh;
  padding: 28px;
  background:
    radial-gradient(circle at top left, rgba(15, 118, 110, 0.18), transparent 32%),
    linear-gradient(180deg, #f7fafc 0%, #eef2f7 100%);
  color: #0f172a;
}

.hero {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 28px 32px;
  border-radius: 28px;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.96), rgba(21, 94, 117, 0.92)),
    #115e59;
  color: #f8fafc;
  box-shadow: 0 22px 60px rgba(15, 23, 42, 0.14);
}

.eyebrow {
  margin: 0 0 12px;
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  opacity: 0.78;
}

.hero h1 {
  margin: 0;
  font-size: 34px;
  line-height: 1.15;
}

.summary {
  max-width: 760px;
  margin: 14px 0 0;
  line-height: 1.65;
  color: rgba(248, 250, 252, 0.86);
}

.hero-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 220px;
}

.hero-button {
  border: 0;
  border-radius: 14px;
  padding: 12px 16px;
  background: rgba(248, 250, 252, 0.16);
  color: #f8fafc;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.hero-button.secondary {
  background: rgba(15, 23, 42, 0.18);
}

.hero-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.banner {
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: 16px;
  font-weight: 500;
}

.banner.error {
  background: #fee2e2;
  color: #991b1b;
}

.focus-card,
.overview-card,
.list-card {
  margin-top: 22px;
  padding: 24px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(12px);
}

.focus-head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  margin-bottom: 12px;
}

.state-pill {
  display: inline-flex;
  align-items: center;
  margin-right: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
  color: #334155;
  font-size: 12px;
  font-weight: 700;
}

.state-pill.active {
  background: rgba(15, 118, 110, 0.12);
  color: #0f766e;
}

.state-pill.subtle {
  color: #475569;
}

.focus-card h2,
.overview-card h2,
.list-card h2 {
  margin: 0;
  font-size: 22px;
}

.focus-slug {
  margin: 8px 0 0;
  color: #0f766e;
  font-weight: 700;
}

.focus-excerpt,
.overview-card p,
.card-header p,
.post-item-excerpt {
  margin: 12px 0 0;
  color: #475569;
  line-height: 1.6;
}

.focus-actions {
  display: flex;
  gap: 14px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.focus-loading {
  color: #64748b;
  font-size: 13px;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.25fr);
  gap: 22px;
}

.overview-card.muted {
  background: rgba(248, 250, 252, 0.88);
}

.overview-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin: 18px 0 0;
}

.overview-stats dt,
.post-item-meta dt {
  margin: 0 0 4px;
  font-size: 12px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.overview-stats dd,
.post-item-meta dd {
  margin: 0;
  color: #0f172a;
}

.overview-stats dd {
  font-size: 28px;
  font-weight: 700;
}

.card-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 20px;
}

.empty-state {
  padding: 24px;
  border-radius: 20px;
  background: #f8fafc;
  color: #475569;
  text-align: center;
}

.post-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.post-item {
  padding: 18px;
  border-radius: 20px;
  background: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.post-item.focused {
  border-color: rgba(15, 118, 110, 0.36);
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.08);
}

.post-item-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.post-item-header h3 {
  margin: 0;
  font-size: 18px;
}

.post-item-header p {
  margin: 6px 0 0;
  color: #475569;
}

.pill {
  display: inline-flex;
  align-items: center;
  height: fit-content;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(15, 118, 110, 0.12);
  color: #0f766e;
  font-size: 12px;
  font-weight: 700;
}

.post-item-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 16px 0 12px;
}

.post-item-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  align-items: center;
}

.reset-panel {
  display: grid;
  gap: 14px;
  margin-top: 22px;
  padding: 18px;
  border-radius: 20px;
  background: rgba(15, 23, 42, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.reset-panel h3 {
  margin: 0;
  font-size: 18px;
}

.reset-copy {
  margin: 8px 0 0;
  color: #475569;
  line-height: 1.6;
}

.reset-field {
  display: grid;
  gap: 8px;
}

.reset-field span {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}

.reset-input {
  width: 100%;
  min-height: 46px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 14px;
  padding: 0 14px;
  font: inherit;
  color: #0f172a;
  background: #fff;
}

.reset-input:focus {
  outline: 0;
  border-color: rgba(15, 118, 110, 0.6);
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
}

.action-button {
  border: 0;
  border-radius: 14px;
  padding: 12px 16px;
  background: #0f766e;
  color: #f8fafc;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.action-button.secondary {
  background: rgba(15, 23, 42, 0.08);
  color: #0f172a;
}

.action-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.password-message {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  font-weight: 500;
}

.password-message[data-tone='success'] {
  background: #dcfce7;
  color: #166534;
}

.password-message[data-tone='error'] {
  background: #fee2e2;
  color: #991b1b;
}

@media (max-width: 1080px) {
  .hero,
  .overview-grid {
    grid-template-columns: 1fr;
  }

  .hero {
    flex-direction: column;
  }

  .hero-actions {
    min-width: unset;
    width: 100%;
  }
}

@media (max-width: 720px) {
  .private-posts-view {
    padding: 16px;
  }

  .hero,
  .focus-card,
  .overview-card,
  .list-card {
    padding: 20px;
    border-radius: 22px;
  }

  .overview-stats,
  .post-item-meta {
    grid-template-columns: 1fr;
  }

  .focus-head,
  .post-item-header {
    flex-direction: column;
  }
}
</style>
