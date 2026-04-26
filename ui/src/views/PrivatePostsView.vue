<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getHaloPostByName, persistPrivatePostBundleAnnotation } from '@/api/posts'
import { buildPrivatePostResource, listPrivatePosts, updatePrivatePost } from '@/api/private-posts'
import RecoveryMnemonicManager from '@/components/RecoveryMnemonicManager.vue'
import type { HaloPostSummary } from '@/api/posts'
import type { EncryptedPrivatePostBundle, PrivatePost } from '@/types/private-post'
import { syncPrivatePostRegistry } from '@/stores/private-post-registry'
import { hasLocalRecoverySecretState } from '@/utils/recovery-secret-store'
import {
  rewrapPrivatePostPasswordWithKnownPassword,
  rewrapPrivatePostPasswordWithRecoveryPhrase,
} from '@/utils/private-post-crypto'

const route = useRoute()
const router = useRouter()

const items = ref<PrivatePost[]>([])
const loading = ref(false)
const loadingSelectedPost = ref(false)
const rotatingPassword = ref(false)
const resettingWithMnemonic = ref(false)
const errorMessage = ref('')
const selectedPost = ref<HaloPostSummary | null>(null)
const currentPassword = ref('')
const nextPassword = ref('')
const confirmNextPassword = ref('')
const rotateMessage = ref('')
const rotateMessageTone = ref<'neutral' | 'success' | 'error'>('neutral')
const recoveryMnemonic = ref('')
const recoveryNextPassword = ref('')
const recoveryConfirmNextPassword = ref('')
const recoveryMessage = ref('')
const recoveryMessageTone = ref<'neutral' | 'success' | 'error'>('neutral')
const localRecoveryReady = ref(hasLocalRecoverySecretState())

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
const passwordRotationAvailability = computed(() => {
  if (!routePostName.value) {
    return '先从列表选中一篇文章。'
  }

  if (!selectedPostMapping.value) {
    return '当前文章还没有同步出私密正文。'
  }

  return '输入旧口令和新口令。'
})
const mnemonicResetAvailability = computed(() => {
  if (!routePostName.value) {
    return '先从列表选中一篇文章。'
  }

  if (!selectedPostMapping.value) {
    return '当前文章还没有同步出私密正文。'
  }

  if (localRecoveryReady.value) {
    return '输入助记词和新口令。'
  }

  return '当前浏览器未导入助记词，也可手动输入助记词重置。'
})
const canRotatePassword = computed(() => {
  return Boolean(
    selectedPostMapping.value
      && currentPassword.value.trim()
      && nextPassword.value.trim()
      && confirmNextPassword.value.trim()
  )
})
const canResetWithMnemonic = computed(() => {
  return Boolean(
    selectedPostMapping.value
      && recoveryMnemonic.value.trim()
      && recoveryNextPassword.value.trim()
      && recoveryConfirmNextPassword.value.trim()
  )
})

onMounted(() => {
  syncLocalRecoveryState()
  window.addEventListener('storage', handleStorageChange)
  void initializeView()
})

onBeforeUnmount(() => {
  window.removeEventListener('storage', handleStorageChange)
})

watch(routePostName, () => {
  currentPassword.value = ''
  nextPassword.value = ''
  confirmNextPassword.value = ''
  recoveryMnemonic.value = ''
  recoveryNextPassword.value = ''
  recoveryConfirmNextPassword.value = ''
  clearRotateMessage()
  clearRecoveryMessage()
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

function clearRotateMessage() {
  rotateMessage.value = ''
  rotateMessageTone.value = 'neutral'
}

function clearRecoveryMessage() {
  recoveryMessage.value = ''
  recoveryMessageTone.value = 'neutral'
}

function setRotateMessage(tone: 'neutral' | 'success' | 'error', message: string) {
  rotateMessageTone.value = tone
  rotateMessage.value = message
}

function setRecoveryMessage(tone: 'neutral' | 'success' | 'error', message: string) {
  recoveryMessageTone.value = tone
  recoveryMessage.value = message
}

async function rotatePasswordWithCurrentPassword() {
  clearRotateMessage()

  const mapping = selectedPostMapping.value
  const normalizedCurrentPassword = currentPassword.value.trim()
  const normalizedNextPassword = nextPassword.value.trim()
  const normalizedConfirmNextPassword = confirmNextPassword.value.trim()

  if (!mapping) {
    setRotateMessage('error', '请先选择一篇已加密文章。')
    return
  }

  if (!normalizedCurrentPassword) {
    setRotateMessage('error', '请输入当前访问口令。')
    return
  }

  if (!normalizedNextPassword) {
    setRotateMessage('error', '请输入新的访问口令。')
    return
  }

  if (!normalizedConfirmNextPassword) {
    setRotateMessage('error', '请再次输入新的访问口令。')
    return
  }

  if (normalizedNextPassword !== normalizedConfirmNextPassword) {
    setRotateMessage('error', '两次输入的新访问口令不一致。')
    return
  }

  rotatingPassword.value = true

  try {
    const nextBundle = await rewrapPrivatePostPasswordWithKnownPassword(
      mapping.spec.bundle,
      normalizedCurrentPassword,
      normalizedNextPassword
    )
    await persistBundle(mapping, nextBundle)
    currentPassword.value = ''
    nextPassword.value = ''
    confirmNextPassword.value = ''
    setRotateMessage('success', '访问口令已更新。')
  } catch (error) {
    setRotateMessage('error', `修改访问口令失败：${toMessage(error)}`)
  } finally {
    rotatingPassword.value = false
  }
}

async function resetPasswordWithMnemonic() {
  clearRecoveryMessage()

  const mapping = selectedPostMapping.value
  const normalizedMnemonic = recoveryMnemonic.value.trim()
  const normalizedNextPassword = recoveryNextPassword.value.trim()
  const normalizedConfirmNextPassword = recoveryConfirmNextPassword.value.trim()

  if (!mapping) {
    setRecoveryMessage('error', '请先选择一篇已加密文章。')
    return
  }

  if (!normalizedMnemonic) {
    setRecoveryMessage('error', '请输入恢复助记词。')
    return
  }

  if (!normalizedNextPassword) {
    setRecoveryMessage('error', '请输入新的访问口令。')
    return
  }

  if (!normalizedConfirmNextPassword) {
    setRecoveryMessage('error', '请再次输入新的访问口令。')
    return
  }

  if (normalizedNextPassword !== normalizedConfirmNextPassword) {
    setRecoveryMessage('error', '两次输入的新访问口令不一致。')
    return
  }

  resettingWithMnemonic.value = true

  try {
    const nextBundle = await rewrapPrivatePostPasswordWithRecoveryPhrase(
      mapping.spec.bundle,
      normalizedMnemonic,
      normalizedNextPassword
    )
    await persistBundle(mapping, nextBundle)
    recoveryMnemonic.value = ''
    recoveryNextPassword.value = ''
    recoveryConfirmNextPassword.value = ''
    setRecoveryMessage('success', '访问口令已重置。')
  } catch (error) {
    setRecoveryMessage('error', `使用恢复助记词重置口令失败：${toMessage(error)}`)
  } finally {
    resettingWithMnemonic.value = false
  }
}

async function persistBundle(mapping: PrivatePost, nextBundle: EncryptedPrivatePostBundle) {
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

function handleRecoveryStateChanged(nextState: unknown) {
  localRecoveryReady.value = Boolean(nextState)
}

async function initializeView() {
  await refreshItems()
  await syncSelectionFromRoute()
}

function syncLocalRecoveryState() {
  localRecoveryReady.value = hasLocalRecoverySecretState()
}

function handleStorageChange() {
  syncLocalRecoveryState()
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
    <div class="page-shell">
      <header class="hero">
        <div>
          <p class="eyebrow">Halo Private Posts</p>
          <h1>私密文章口令维护</h1>
          <p class="summary">
            正常阅读始终靠访问口令。知道旧口令时可直接修改；忘记旧口令时，可用恢复助记词重置。
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
          </div>
          <span class="focus-loading" v-if="loadingSelectedPost">载入中…</span>
        </div>

        <template v-if="routePostName && (selectedPost || selectedPostMapping)">
          <h2>{{ selectedArticleTitle || routePostName }}</h2>
          <p v-if="selectedArticleSlug" class="focus-slug">{{ selectedArticleSlug }}</p>
          <p class="focus-excerpt" v-if="selectedPost?.excerpt">{{ selectedPost.excerpt }}</p>

          <div class="focus-panels">
            <section class="action-panel">
              <div>
                <h3>知道旧口令时直接修改</h3>
                <p class="panel-copy">{{ passwordRotationAvailability }}</p>
              </div>

              <label class="panel-field">
                <span>当前访问口令</span>
                <input
                  v-model="currentPassword"
                  type="password"
                  class="panel-input"
                  autocomplete="current-password"
                  placeholder="输入当前访问口令"
                />
              </label>

              <label class="panel-field">
                <span>新的访问口令</span>
                <input
                  v-model="nextPassword"
                  type="password"
                  class="panel-input"
                  autocomplete="new-password"
                  placeholder="输入新的访问口令"
                />
              </label>

              <label class="panel-field">
                <span>确认新的访问口令</span>
                <input
                  v-model="confirmNextPassword"
                  type="password"
                  class="panel-input"
                  autocomplete="new-password"
                  placeholder="再次输入新的访问口令"
                />
              </label>

              <div class="focus-actions">
                <button
                  class="action-button"
                  type="button"
                  :disabled="rotatingPassword || !canRotatePassword"
                  @click="rotatePasswordWithCurrentPassword"
                >
                  {{ rotatingPassword ? '修改中…' : '修改访问口令' }}
                </button>
              </div>

              <p v-if="rotateMessage" class="password-message" :data-tone="rotateMessageTone">
                {{ rotateMessage }}
              </p>
            </section>

            <section class="action-panel">
              <div>
                <h3>忘记旧口令时用助记词重置</h3>
                <p class="panel-copy">{{ mnemonicResetAvailability }}</p>
              </div>

              <label class="panel-field">
                <span>恢复助记词</span>
                <textarea
                  v-model="recoveryMnemonic"
                  class="panel-textarea"
                  spellcheck="false"
                  placeholder="输入 12 个英文单词"
                />
              </label>

              <label class="panel-field">
                <span>新的访问口令</span>
                <input
                  v-model="recoveryNextPassword"
                  type="password"
                  class="panel-input"
                  autocomplete="new-password"
                  placeholder="输入新的访问口令"
                />
              </label>

              <label class="panel-field">
                <span>确认新的访问口令</span>
                <input
                  v-model="recoveryConfirmNextPassword"
                  type="password"
                  class="panel-input"
                  autocomplete="new-password"
                  placeholder="再次输入新的访问口令"
                />
              </label>

              <div class="focus-actions">
                <button
                  class="action-button"
                  type="button"
                  :disabled="resettingWithMnemonic || !canResetWithMnemonic"
                  @click="resetPasswordWithMnemonic"
                >
                  {{ resettingWithMnemonic ? '重置中…' : '使用助记词重置口令' }}
                </button>
              </div>

              <p v-if="recoveryMessage" class="password-message" :data-tone="recoveryMessageTone">
                {{ recoveryMessage }}
              </p>
            </section>
          </div>
        </template>

        <p v-else class="focus-excerpt">
          从下方列表选中一篇已加密文章，然后在这里修改或重置访问口令。
        </p>
      </section>

      <section class="overview-card overview-card-compact">
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
          <div>
            <dt>恢复助记词</dt>
            <dd>{{ localRecoveryReady ? '已导入' : '未导入' }}</dd>
          </div>
        </dl>
      </section>

      <section class="manager-card">
        <RecoveryMnemonicManager @changed="handleRecoveryStateChanged" />
      </section>

      <section class="list-card">
        <div class="card-header">
          <div>
            <h2>已加密文章</h2>
            <p>选中后即可处理口令。</p>
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
            <div class="post-item-main">
              <div>
                <button class="post-link" type="button" @click="selectPost(item.spec.postName)">
                  {{ item.spec.title }}
                </button>
                <p class="post-slug">{{ item.spec.slug }}</p>
              </div>

              <dl class="post-item-meta">
                <div>
                  <dt>发布时间</dt>
                  <dd>{{ formatTimestamp(item.spec.publishedAt) }}</dd>
                </div>
                <div>
                  <dt>创建时间</dt>
                  <dd>{{ formatTimestamp(item.metadata.creationTimestamp) }}</dd>
                </div>
              </dl>

              <p class="post-item-excerpt">{{ item.spec.excerpt || '无公开摘要' }}</p>
            </div>

            <span v-if="item.spec.postName === routePostName" class="post-current">
              正在处理
            </span>
          </li>
        </ul>
      </section>
    </div>
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

.page-shell {
  max-width: 1040px;
  margin: 0 auto;
}

.hero {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 28px;
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
  max-width: 620px;
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
.manager-card,
.list-card {
  margin-top: 22px;
  padding: 20px;
  border-radius: 22px;
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

.overview-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin: 16px 0 0;
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
  font-size: 24px;
  font-weight: 700;
}

.overview-card-compact {
  background: rgba(248, 250, 252, 0.88);
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
  display: grid;
  gap: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

.post-item {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
  padding: 16px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}

.post-item.focused {
  background: rgba(15, 118, 110, 0.04);
}

.post-item-main {
  min-width: 0;
}

.post-link {
  border: 0;
  padding: 0;
  background: transparent;
  color: #0f172a;
  cursor: pointer;
  font: inherit;
  font-size: 18px;
  font-weight: 700;
  text-align: left;
}

.post-link:hover,
.post-link:focus-visible,
.post-item.focused .post-link {
  color: #0f766e;
  text-decoration: underline;
}

.post-link:focus-visible {
  outline: none;
}

.post-slug {
  margin: 6px 0 0;
  color: #475569;
  word-break: break-all;
  font-size: 13px;
}

.post-item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin: 12px 0 10px;
}

.post-item-meta div {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
}

.post-item-meta dt {
  margin: 0;
  letter-spacing: 0;
  text-transform: none;
}

.post-item-meta dd {
  word-break: break-word;
}

.post-current {
  flex-shrink: 0;
  align-self: flex-start;
  color: #0f766e;
  font-size: 12px;
  font-weight: 700;
}

.focus-panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
  margin-top: 22px;
}

.action-panel {
  display: grid;
  gap: 14px;
  padding: 18px;
  border-radius: 20px;
  background: rgba(15, 23, 42, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.18);
  align-content: start;
}

.action-panel h3 {
  margin: 0;
  font-size: 18px;
}

.panel-copy {
  margin: 8px 0 0;
  color: #475569;
  line-height: 1.6;
}

.panel-field {
  display: grid;
  gap: 8px;
}

.panel-field span {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}

.panel-input,
.panel-textarea {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 14px;
  padding: 12px 14px;
  font: inherit;
  color: #0f172a;
  background: #fff;
}

.panel-input {
  min-height: 46px;
}

.panel-textarea {
  min-height: 120px;
  resize: vertical;
}

.panel-input:focus,
.panel-textarea:focus {
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
  .manager-card,
  .list-card {
    padding: 18px;
    border-radius: 20px;
  }

  .overview-stats,
  .focus-panels {
    grid-template-columns: 1fr;
  }

  .focus-head,
  .post-item {
    flex-direction: column;
  }

  .post-current {
    align-self: flex-start;
  }
}
</style>
