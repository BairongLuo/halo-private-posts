<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import {
  fetchHaloPostHeadContent,
  getHaloPostBundleAnnotation,
  getHaloPostByName,
  listHaloPosts,
  persistPrivatePostBundleAnnotation,
} from '@/api/posts'
import {
  fetchSiteRecoveryPublicKey,
  waitForPrivatePostRemoval,
  waitForPrivatePostSync,
} from '@/api/private-posts'
import { resolveBundleFieldSyncState } from '@/annotation/bundle-field-sync'
import type { HaloPostContent, HaloPostSummary } from '@/api/posts'
import type {
  BundleMetadata,
  DecryptedPrivatePostDocument,
  EncryptedPrivatePostBundle,
} from '@/types/private-post'
import { encryptPrivatePost, parseBundleJson } from '@/utils/private-post-crypto'

type StatusTone = 'neutral' | 'valid' | 'invalid' | 'success'

const props = defineProps<{
  bundleFieldId: string
  standalone?: boolean
}>()

const password = ref('')
const confirmPassword = ref('')
const bundleText = ref('')
const currentPostName = ref('')
const actionTone = ref<StatusTone>('neutral')
const actionMessage = ref('')
const isWorking = ref(false)

let bundleField: HTMLInputElement | HTMLTextAreaElement | null = null
let cleanupBundleListener: (() => void) | null = null
let domObserver: MutationObserver | null = null
let domSyncFrame: number | null = null
let optimisticBundleText: string | null = null

const parsedBundle = computed<EncryptedPrivatePostBundle | null>(() => {
  const text = bundleText.value.trim()
  if (!text) {
    return null
  }

  try {
    return parseBundleJson(text)
  } catch {
    return null
  }
})

const hasBundle = computed(() => bundleText.value.trim().length > 0)

const bundleParseError = computed(() => {
  const text = bundleText.value.trim()
  if (!text) {
    return ''
  }

  try {
    parseBundleJson(text)
    return ''
  } catch (error) {
    return toMessage(error)
  }
})

const statusTone = computed<StatusTone>(() => {
  if (actionMessage.value) {
    return actionTone.value
  }

  if (!hasBundle.value) {
    return 'neutral'
  }

  return parsedBundle.value ? 'valid' : 'invalid'
})

const statusLabel = computed(() => {
  if (!hasBundle.value) {
    return '未加锁'
  }

  if (parsedBundle.value) {
    return '已加锁'
  }

  return '设置异常'
})

const statusMessage = computed(() => {
  if (actionMessage.value) {
    return actionMessage.value
  }

  if (!hasBundle.value) {
    return '当前文章未加锁。输入访问密码后，可直接基于当前已保存草稿正文生成密文，并立即保存加锁状态。'
  }

  if (parsedBundle.value) {
    return '当前文章已写入加密正文。修改正文后请先保存文章，再重新点击“根据当前正文加锁”。'
  }

  return bundleParseError.value || '当前加密正文无法解析'
})
const lockButtonText = computed(() => {
  if (isWorking.value) {
    return '正在加锁...'
  }

  return parsedBundle.value ? '根据当前正文重新加锁' : '根据当前正文加锁'
})

onMounted(() => {
  if (props.standalone) {
    void refreshStandaloneBundleState()
    return
  }

  void syncCurrentPostName()
  scheduleDomSync()
  startDomObserver()
})

onBeforeUnmount(() => {
  cleanupBundleListener?.()
  domObserver?.disconnect()
  if (domSyncFrame !== null) {
    window.cancelAnimationFrame(domSyncFrame)
  }
})

function bindBundleField(): void {
  const nextField = findBundleField()

  if (!nextField) {
    if (bundleField && !bundleField.isConnected) {
      cleanupBundleListener?.()
      cleanupBundleListener = null
      bundleField = null
    }
    return
  }

  if (nextField === bundleField) {
    hideBundleField(nextField)
    return
  }

  cleanupBundleListener?.()
  bundleField = nextField
  hideBundleField(bundleField)
  const attachedField = bundleField
  const listener = () => syncFromBundleField()
  attachedField.addEventListener('input', listener)
  attachedField.addEventListener('change', listener)
  cleanupBundleListener = () => {
    attachedField.removeEventListener('input', listener)
    attachedField.removeEventListener('change', listener)
  }
  syncFromBundleField()
}

function hideBundleField(field: HTMLInputElement | HTMLTextAreaElement): void {
  const wrapper = findBundleFieldWrapper(field)
  if (!wrapper) {
    return
  }

  wrapper.style.display = 'none'
  wrapper.setAttribute('aria-hidden', 'true')
}

function findBundleFieldWrapper(field: HTMLInputElement | HTMLTextAreaElement): HTMLElement | null {
  return field.closest('.formkit-outer')
    ?? field.closest('.formkit-wrapper')
    ?? field.parentElement
}

function findBundleField(): HTMLInputElement | HTMLTextAreaElement | null {
  const element = document.getElementById(props.bundleFieldId)
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element
  }

  if (!element) {
    return null
  }

  const nested = element.querySelector('textarea, input')
  if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement) {
    return nested
  }

  return null
}

function scheduleDomSync(): void {
  if (domSyncFrame !== null) {
    return
  }

  domSyncFrame = window.requestAnimationFrame(() => {
    domSyncFrame = null
    bindBundleField()
    syncFromBundleField()
  })
}

function startDomObserver(): void {
  if (typeof MutationObserver === 'undefined' || !document.body) {
    return
  }

  domObserver = new MutationObserver(() => {
    scheduleDomSync()
  })

  domObserver.observe(document.body, {
    childList: true,
    subtree: true,
  })
}

function syncFromBundleField(): void {
  if (!bundleField) {
    return
  }

  const nextState = resolveBundleFieldSyncState({
    bundleText: bundleText.value,
    domValue: bundleField.value ?? '',
    optimisticBundleText,
  })

  optimisticBundleText = nextState.optimisticBundleText
  if (!nextState.shouldUpdateBundleText) {
    return
  }

  bundleText.value = nextState.bundleText
}

function applyOptimisticBundleText(value: string): void {
  optimisticBundleText = value
  bundleText.value = value
}

function applyBundleSnapshot(value: string): void {
  optimisticBundleText = null
  bundleText.value = value
}

function readInputValue(selectors: string[]): string {
  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const value = element.value.trim()
      if (value) {
        return value
      }
    }
  }

  return ''
}

function buildMetadata(summary: HaloPostSummary): BundleMetadata {
  const normalizedTitle = readInputValue([
    'input[name="title"]',
    'input[id="title"]',
  ]) || summary.title.trim()
  if (!normalizedTitle) {
    throw new Error('请先填写并保存文章标题')
  }

  const normalizedSlug = readInputValue([
    'input[name="slug"]',
    'input[id="slug"]',
  ]) || summary.slug.trim()
  if (!normalizedSlug) {
    throw new Error('请先填写并保存文章 slug')
  }

  const normalizedExcerpt = summary.excerpt.trim()
  const normalizedPublishedAt = summary.publishTime?.trim() ?? ''

  return {
    title: normalizedTitle,
    slug: normalizedSlug,
    ...(normalizedExcerpt ? { excerpt: normalizedExcerpt } : {}),
    ...(normalizedPublishedAt ? { published_at: normalizedPublishedAt } : {}),
  }
}

function readPassword(): string {
  const normalized = password.value.trim()
  if (!normalized) {
    throw new Error('请先输入访问密码')
  }

  const normalizedConfirmation = confirmPassword.value.trim()
  if (!normalizedConfirmation) {
    throw new Error('请再次输入访问密码')
  }

  if (normalized !== normalizedConfirmation) {
    throw new Error('两次输入的访问密码不一致')
  }

  return normalized
}

function readDraftContent(
  content: HaloPostContent
): Pick<DecryptedPrivatePostDocument, 'payload_format' | 'content'> {
  const raw = content.raw.trim()
  const rendered = content.content.trim()
  const rawType = content.rawType?.trim().toLowerCase() ?? ''
  const nextContent = raw || rendered

  if (!nextContent) {
    throw new Error('当前文章还没有已保存的正文内容，请先保存文章再加锁')
  }

  if (!rawType || rawType === 'markdown' || rawType === 'md') {
    return {
      payload_format: 'markdown',
      content: raw || content.content,
    }
  }

  if (rawType === 'html' || rawType === 'htm' || rawType.includes('html')) {
    return {
      payload_format: 'html',
      content: raw || content.content,
    }
  }

  throw new Error(`当前正文类型为 ${content.rawType}，暂时只支持 Markdown 或 HTML 正文加锁`)
}

function setActionMessage(tone: StatusTone, message: string): void {
  actionTone.value = tone
  actionMessage.value = message
}

function clearActionMessage(): void {
  actionTone.value = 'neutral'
  actionMessage.value = ''
}

function writeBundleToField(value: string): void {
  bindBundleField()
  if (!bundleField) {
    throw new Error('当前页面尚未加载密文字段，请稍后重试')
  }

  setNativeFieldValue(bundleField, value)
  bundleField.dispatchEvent(new Event('input', { bubbles: true }))
  bundleField.dispatchEvent(new Event('change', { bubbles: true }))
  bundleField.dispatchEvent(new Event('blur', { bubbles: true }))
  applyOptimisticBundleText(value)
}

function setNativeFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')

  if (descriptor?.set) {
    descriptor.set.call(field, value)
    return
  }

  field.value = value
}

async function lockCurrentPost(): Promise<void> {
  clearActionMessage()

  const postName = currentPostName.value || await resolveCurrentPostName()
  if (!postName) {
    setActionMessage('invalid', '当前文章还没有名称，请先保存文章后再加锁')
    return
  }

  isWorking.value = true

  const previousBundleText = bundleText.value
  let annotationPersisted = false

  try {
    const [summary, content, siteRecoveryPublicKey] = await Promise.all([
      getHaloPostByName(postName),
      fetchHaloPostHeadContent(postName),
      fetchSiteRecoveryPublicKey(),
    ])

    const bundle = await encryptPrivatePost(
      {
        metadata: buildMetadata(summary),
        ...readDraftContent(content),
      },
      readPassword(),
      siteRecoveryPublicKey
    )

    const nextBundleText = JSON.stringify(bundle, null, 2)
    await persistPrivatePostBundleAnnotation(postName, nextBundleText)
    annotationPersisted = true
    const syncedPrivatePost = await waitForPrivatePostSync({
      expectedBundle: bundle,
      postName,
    })
    const syncMessage = syncedPrivatePost
      ? ''
      : '加锁结果已经保存，但私密映射仍在后台同步，稍后刷新页面即可看到最新状态。'

    if (props.standalone) {
      applyOptimisticBundleText(nextBundleText)
      currentPostName.value = postName
      password.value = ''
      confirmPassword.value = ''
      setActionMessage(
        'success',
        syncMessage || '已基于当前已保存草稿正文加锁，并立即保存文章加密状态，同时写入平台恢复槽。后续修改正文后请先保存文章，再重新加锁。'
      )
      return
    }

    try {
      writeBundleToField(nextBundleText)
    } catch {
      applyOptimisticBundleText(nextBundleText)
      const pageSyncMessage = '已完成加锁并保存，但当前编辑页未同步显示，刷新页面后可见最新状态。'
      setActionMessage(
        'success',
        syncMessage ? `${syncMessage} ${pageSyncMessage}` : pageSyncMessage
      )
      currentPostName.value = postName
      password.value = ''
      confirmPassword.value = ''
      return
    }

    currentPostName.value = postName
    password.value = ''
    confirmPassword.value = ''
    setActionMessage(
      'success',
      syncMessage || '已基于当前已保存草稿正文加锁，并立即保存文章加密状态，同时写入平台恢复槽。后续修改正文后请先保存文章，再重新加锁。'
    )
  } catch (error) {
    if (annotationPersisted) {
      try {
        await persistPrivatePostBundleAnnotation(postName, previousBundleText)
      } catch {
        setActionMessage('invalid', `加锁失败，且回滚文章加锁状态失败：${toMessage(error)}`)
        isWorking.value = false
        return
      }
    }

    setActionMessage('invalid', toMessage(error))
  } finally {
    isWorking.value = false
  }
}

async function clearBundle(): Promise<void> {
  clearActionMessage()

  const postName = currentPostName.value || await resolveCurrentPostName()
  if (!postName) {
    setActionMessage('invalid', '当前文章还没有名称，请先保存文章后再取消加锁')
    return
  }

  isWorking.value = true

  try {
    await persistPrivatePostBundleAnnotation(postName, '')
    const removed = await waitForPrivatePostRemoval({
      postName,
    })
    const syncMessage = removed
      ? ''
      : '文章已取消加锁并保存，但私密映射仍在后台清理，稍后刷新页面即可确认最新状态。'

    if (props.standalone) {
      applyOptimisticBundleText('')
      setActionMessage(
        'neutral',
        syncMessage || '已取消当前文章加锁，并立即保存文章加密状态。'
      )
      return
    }

    try {
      writeBundleToField('')
    } catch {
      applyOptimisticBundleText('')
      const pageSyncMessage = '文章已取消加锁并保存，但当前编辑页未同步显示，刷新页面后可见最新状态。'
      setActionMessage(
        'neutral',
        syncMessage ? `${syncMessage} ${pageSyncMessage}` : pageSyncMessage
      )
      return
    }

    setActionMessage(
      'neutral',
      syncMessage || '已取消当前文章加锁，并立即保存文章加密状态。'
    )
  } catch (error) {
    setActionMessage('invalid', toMessage(error))
  } finally {
    isWorking.value = false
  }
}

function readCurrentPostName(): string {
  const directMatch = readPostNameFromLocation()
  if (directMatch) {
    return directMatch
  }

  return readPostNameFromDom()
}

function readPostNameFromLocation(): string {
  const search = new URLSearchParams(window.location.search)
  const directMatch = search.get('name') || search.get('postName')
  if (directMatch) {
    return directMatch
  }

  const hash = window.location.hash || ''
  const hashQueryIndex = hash.indexOf('?')
  if (hashQueryIndex >= 0) {
    const hashSearch = new URLSearchParams(hash.slice(hashQueryIndex + 1))
    const hashMatch = hashSearch.get('name') || hashSearch.get('postName')
    if (hashMatch) {
      return hashMatch
    }
  }

  const hrefMatch = window.location.href.match(/[?&#](?:name|postName)=([^&#]+)/)
  if (hrefMatch?.[1]) {
    return decodeURIComponent(hrefMatch[1])
  }

  const segments = window.location.pathname.split('/').filter(Boolean)
  const postSegmentIndex = segments.findIndex((segment) => segment === 'posts' || segment === 'post')
  if (postSegmentIndex >= 0 && segments[postSegmentIndex + 1]) {
    return decodeURIComponent(segments[postSegmentIndex + 1])
  }

  const hashPath = hash.startsWith('#') ? hash.slice(1) : hash
  const hashPathSegments = hashPath.split('?')[0]?.split('/').filter(Boolean) ?? []
  const hashPostSegmentIndex = hashPathSegments.findIndex((segment) => segment === 'posts' || segment === 'post')
  if (hashPostSegmentIndex >= 0 && hashPathSegments[hashPostSegmentIndex + 1]) {
    return decodeURIComponent(hashPathSegments[hashPostSegmentIndex + 1])
  }

  return ''
}

function readPostNameFromDom(): string {
  return readInputValue([
    'input[name="metadata.name"]',
    'input[id="metadata.name"]',
    'input[name="post.metadata.name"]',
    'input[id="post.metadata.name"]',
    'input[name="name"]',
    'input[id="name"]',
    '[data-name="metadata.name"] input',
    '[data-field-name="metadata.name"] input',
  ])
}

async function resolveCurrentPostName(): Promise<string> {
  const directMatch = readCurrentPostName()
  if (directMatch) {
    currentPostName.value = directMatch
    return directMatch
  }

  const slugCandidates = [
    readInputValue([
      'input[name="slug"]',
      'input[id="slug"]',
    ]),
    parsedBundle.value?.metadata.slug ?? '',
  ].filter((value) => value.length > 0)

  for (const slug of slugCandidates) {
    const slugMatch = await findSavedPostNameBySlug(slug)
    if (slugMatch) {
      currentPostName.value = slugMatch
      return slugMatch
    }
  }

  const titleCandidates = [
    readInputValue([
      'input[name="title"]',
      'input[id="title"]',
    ]),
    parsedBundle.value?.metadata.title ?? '',
  ].filter((value) => value.length > 0)

  for (const title of titleCandidates) {
    const titleMatch = await findSavedPostNameByTitle(title)
    if (titleMatch) {
      currentPostName.value = titleMatch
      return titleMatch
    }
  }

  return ''
}

async function findSavedPostNameBySlug(slug: string): Promise<string> {
  try {
    const items = await listHaloPosts(slug)
    const exactMatches = items.filter((item) => item.slug.trim() === slug.trim())
    return exactMatches.length === 1 ? exactMatches[0].name : ''
  } catch {
    return ''
  }
}

async function findSavedPostNameByTitle(title: string): Promise<string> {
  try {
    const items = await listHaloPosts(title)
    const exactMatches = items.filter((item) => item.title.trim() === title.trim())
    return exactMatches.length === 1 ? exactMatches[0].name : ''
  } catch {
    return ''
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

async function syncCurrentPostName(): Promise<void> {
  currentPostName.value = await resolveCurrentPostName()
}

async function refreshStandaloneBundleState(): Promise<void> {
  const postName = await resolveCurrentPostName()
  currentPostName.value = postName

  if (!postName) {
    applyBundleSnapshot('')
    return
  }

  try {
    applyBundleSnapshot(await getHaloPostBundleAnnotation(postName))
  } catch {
    applyBundleSnapshot('')
  }
}
</script>

<template>
  <section class="hpp-annotation-tool" data-hpp-annotation-panel="true">
    <div class="hpp-annotation-head">
      <div>
        <p class="hpp-annotation-label">文章加密</p>
        <p class="hpp-annotation-help">
          这里不会再维护第二份正文。插件会直接读取当前文章已保存的草稿正文，在浏览器本地加密后写回文章加密字段。
        </p>
      </div>
      <span class="hpp-annotation-badge" :data-tone="statusTone">
        {{ statusLabel }}
      </span>
    </div>

    <p class="hpp-annotation-state" :data-tone="statusTone">
      {{ statusMessage }}
    </p>

    <p class="hpp-annotation-note">
      说明：先保存正文，再点击“根据当前正文加锁”。加锁和取消加锁都会立即保存状态。
    </p>

    <label class="hpp-annotation-field">
      <span>访问密码</span>
      <input
        v-model="password"
        type="password"
        autocomplete="new-password"
        class="hpp-annotation-input"
        placeholder="密码只在当前浏览器里参与加密，不会写入 Halo"
      />
    </label>

    <label class="hpp-annotation-field">
      <span>确认访问密码</span>
      <input
        v-model="confirmPassword"
        type="password"
        autocomplete="new-password"
        class="hpp-annotation-input"
        placeholder="再次输入访问密码"
      />
    </label>

    <div class="hpp-annotation-actions">
      <button
        type="button"
        class="hpp-annotation-button hpp-annotation-button-primary"
        :disabled="isWorking"
        @click="lockCurrentPost"
      >
        {{ lockButtonText }}
      </button>
      <button
        type="button"
        class="hpp-annotation-button hpp-annotation-button-danger"
        :disabled="isWorking || !hasBundle"
        @click="clearBundle"
      >
        取消加锁
      </button>
    </div>
  </section>
</template>

<style scoped>
.hpp-annotation-tool {
  display: grid;
  gap: 14px;
  border: 1px solid #dbe4f0;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
  padding: 16px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
  transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
}

.hpp-annotation-tool[data-hpp-attention='true'] {
  border-color: #0f766e;
  box-shadow: 0 18px 40px rgba(15, 118, 110, 0.18);
  transform: translateY(-1px);
}

.hpp-annotation-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.hpp-annotation-label {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #111827;
}

.hpp-annotation-help {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: #4b5563;
}

.hpp-annotation-badge {
  flex-shrink: 0;
  border-radius: 999px;
  background: #e2e8f0;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  padding: 8px 12px;
}

.hpp-annotation-badge[data-tone='valid'],
.hpp-annotation-badge[data-tone='success'] {
  background: #dcfce7;
  color: #166534;
}

.hpp-annotation-badge[data-tone='invalid'] {
  background: #fee2e2;
  color: #b91c1c;
}

.hpp-annotation-state,
.hpp-annotation-note {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}

.hpp-annotation-state[data-tone='neutral'] {
  color: #4b5563;
}

.hpp-annotation-state[data-tone='valid'] {
  color: #0369a1;
}

.hpp-annotation-state[data-tone='invalid'] {
  color: #b91c1c;
}

.hpp-annotation-state[data-tone='success'] {
  color: #047857;
}

.hpp-annotation-note {
  color: #64748b;
}

.hpp-annotation-warning {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 13px;
  line-height: 1.6;
}

.hpp-annotation-field {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: #334155;
}

.hpp-annotation-input {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: #fff;
  color: #0f172a;
  font: inherit;
  padding: 10px 12px;
}

.hpp-annotation-input:focus {
  outline: none;
  border-color: #60a5fa;
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.16);
}

.hpp-annotation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hpp-annotation-button {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  background: #fff;
  color: #0f172a;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 8px 14px;
}

.hpp-annotation-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.hpp-annotation-button-primary {
  border-color: #1d4ed8;
  background: #1d4ed8;
  color: #fff;
}

.hpp-annotation-button-danger {
  border-color: #fecaca;
  color: #b91c1c;
}

@media (max-width: 768px) {
  .hpp-annotation-head {
    display: grid;
  }
}
</style>
