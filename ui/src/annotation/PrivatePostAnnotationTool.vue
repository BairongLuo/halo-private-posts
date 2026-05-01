<script setup lang="ts">
import type { Content, Post, PostRequest } from '@halo-dev/api-client'
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
  refreshPrivatePostBundleWithSiteRecovery,
  waitForPrivatePostRemoval,
  waitForPrivatePostSync,
} from '@/api/private-posts'
import { resolveBundleFieldSyncState } from '@/annotation/bundle-field-sync'
import type { HaloPostContent, HaloPostSummary } from '@/api/posts'
import type {
  BundleMetadata,
  DecryptedPrivatePostDocument,
  EncryptedPrivatePostBundle,
  SiteRecoveryPublicKey,
} from '@/types/private-post'
import { encryptPrivatePost, parseBundleJson } from '@/utils/private-post-crypto'
import { findEditorSaveButton } from './editor-dom'

type PendingSaveAction = 'none' | 'lock' | 'unlock' | 'refresh'
type SaveAction = PendingSaveAction | 'metadata-sync'
type StatusTone = 'neutral' | 'valid' | 'invalid' | 'success'

const props = defineProps<{
  bundleFieldId: string
  mountSelector: string
}>()

const password = ref('')
const showPassword = ref(false)
const bundleText = ref('')
const encryptionEnabled = ref(false)
const currentPostName = ref('')
const actionTone = ref<StatusTone>('neutral')
const actionMessage = ref('')
const encryptionDirty = ref(false)
const slotAvailable = ref(false)

let bundleField: HTMLInputElement | HTMLTextAreaElement | null = null
let cleanupBundleListener: (() => void) | null = null
let saveButton: HTMLElement | null = null
let cleanupSaveButtonListener: (() => void) | null = null
let domObserver: MutationObserver | null = null
let domSyncFrame: number | null = null
let optimisticBundleText: string | null = null
let saveInterceptorCleanup: (() => void) | null = null
let lastPersistedSignature = ''
let lastPersistedAt = 0
let standaloneSyncTimer: number | null = null
let latestStandaloneSyncToken = 0
let latestHandledStandaloneSyncToken = 0
let lastInterceptedSaveAt = 0
let lastHydratedBundlePostName = ''

let siteRecoveryPublicKey: SiteRecoveryPublicKey | null = null
let siteRecoveryPublicKeyPromise: Promise<SiteRecoveryPublicKey | null> | null = null

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

const pendingSaveAction = computed<PendingSaveAction>(() => {
  if (!encryptionEnabled.value && hasBundle.value) {
    return 'unlock'
  }

  if (encryptionEnabled.value && !hasBundle.value) {
    return 'lock'
  }

  if (encryptionEnabled.value && hasBundle.value) {
    return 'refresh'
  }

  return 'none'
})

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

  if (hasBundle.value && !parsedBundle.value) {
    return 'invalid'
  }

  if (pendingSaveAction.value === 'lock' || pendingSaveAction.value === 'refresh') {
    return 'valid'
  }

  if (parsedBundle.value) {
    return 'valid'
  }

  return 'neutral'
})

const statusLabel = computed(() => {
  if (pendingSaveAction.value === 'lock') {
    return '保存后加锁'
  }

  if (pendingSaveAction.value === 'unlock') {
    return '保存后解锁'
  }

  if (pendingSaveAction.value === 'refresh') {
    return '保存后更新密文'
  }

  if (hasBundle.value && !parsedBundle.value) {
    return '设置异常'
  }

  return parsedBundle.value ? '已加锁' : '未加锁'
})

const statusMessage = computed(() => {
  if (actionMessage.value) {
    return actionMessage.value
  }

  if (hasBundle.value && !parsedBundle.value) {
    return bundleParseError.value || '当前密文结构异常'
  }

  if (pendingSaveAction.value === 'lock') {
    return '保存后将启用文章加密。'
  }

  if (pendingSaveAction.value === 'unlock') {
    return '保存后将取消文章加密。'
  }

  if (pendingSaveAction.value === 'refresh') {
    return '保存后将同步更新加密内容。'
  }

  if (parsedBundle.value) {
    return '当前文章已加锁。'
  }

  return '当前文章未加锁。'
})

const passwordPlaceholder = computed(() => {
  if (parsedBundle.value) {
    return '如需更换密码，请重新输入'
  }

  return '请输入访问密码'
})

const passwordHelp = computed(() => {
  return '请输入文章访问密码。'
})

onMounted(() => {
  scheduleDomSync()
  startDomObserver()
  saveInterceptorCleanup = createEditorDraftSaveInterceptor()
  void initializeEditorContext()
})

onBeforeUnmount(() => {
  cleanupBundleListener?.()
  cleanupSaveButtonListener?.()
  domObserver?.disconnect()
  saveInterceptorCleanup?.()
  if (domSyncFrame !== null) {
    window.cancelAnimationFrame(domSyncFrame)
  }
  if (standaloneSyncTimer !== null) {
    window.clearTimeout(standaloneSyncTimer)
  }
})

async function initializeEditorContext(): Promise<void> {
  await syncCurrentPostName()
  await hydrateBundleFromSourcePost()
  syncUiStateFromBundle(true)
  void ensureSiteRecoveryPublicKeyLoaded()
}

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

function bindSaveButton(): void {
  const nextButton = findEditorSaveButton()
  if (!nextButton) {
    cleanupSaveButtonListener?.()
    cleanupSaveButtonListener = null
    saveButton = null
    return
  }

  if (nextButton === saveButton) {
    return
  }

  cleanupSaveButtonListener?.()
  saveButton = nextButton
  const attachedButton = saveButton
  const listener = () => {
    scheduleStandaloneEncryptionSync()
  }
  attachedButton.addEventListener('click', listener)
  cleanupSaveButtonListener = () => {
    attachedButton.removeEventListener('click', listener)
  }
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
  if (field instanceof HTMLInputElement && field.type === 'hidden') {
    return null
  }

  return field.closest('.formkit-outer')
    ?? field.closest('.formkit-wrapper')
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
    slotAvailable.value = Boolean(document.querySelector(props.mountSelector))
    bindSaveButton()
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

  const previousBundleText = bundleText.value
  optimisticBundleText = nextState.optimisticBundleText
  if (!nextState.shouldUpdateBundleText) {
    return
  }

  bundleText.value = nextState.bundleText
  if (previousBundleText !== nextState.bundleText) {
    syncUiStateFromBundle(false)
  }
}

async function hydrateBundleFromSourcePost(force = false): Promise<void> {
  const postName = currentPostName.value || await resolveCurrentPostName()
  if (!postName) {
    return
  }

  if (!force && encryptionDirty.value) {
    return
  }

  if (!force && password.value.trim().length > 0) {
    return
  }

  const domBundleText = bundleField?.value?.trim() ?? ''
  if (!force && domBundleText.length > 0) {
    return
  }

  if (!force && lastHydratedBundlePostName === postName) {
    return
  }

  const nextBundleText = await getHaloPostBundleAnnotation(postName)
  lastHydratedBundlePostName = postName
  optimisticBundleText = nextBundleText

  if (bundleText.value === nextBundleText) {
    return
  }

  bundleText.value = nextBundleText
  syncUiStateFromBundle(true)
}

function applyOptimisticBundleText(value: string): void {
  optimisticBundleText = value
  bundleText.value = value
}

function syncUiStateFromBundle(force: boolean): void {
  if (!force && (encryptionDirty.value || password.value.trim().length > 0)) {
    return
  }

  encryptionEnabled.value = hasBundle.value
  encryptionDirty.value = false
}

function handleEncryptionToggle(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) {
    return
  }

  encryptionEnabled.value = target.checked
  encryptionDirty.value = true
  if (!target.checked) {
    password.value = ''
    showPassword.value = false
  }

  updateEncryptionDirtyState()
  clearActionMessage()
  if (target.checked) {
    void ensureSiteRecoveryPublicKeyLoaded()
  }
}

function handlePasswordInput(): void {
  clearActionMessage()
  updateEncryptionDirtyState()
}

function updateEncryptionDirtyState(): void {
  if (password.value.trim().length === 0 && encryptionEnabled.value === hasBundle.value) {
    encryptionDirty.value = false
  }
}

function setActionMessage(tone: StatusTone, message: string): void {
  actionTone.value = tone
  actionMessage.value = message
}

function clearActionMessage(): void {
  actionTone.value = 'neutral'
  actionMessage.value = ''
}

function scheduleStandaloneEncryptionSync(): void {
  if (!shouldScheduleStandaloneEncryptionSync()) {
    return
  }

  latestStandaloneSyncToken += 1
  const syncToken = latestStandaloneSyncToken

  if (standaloneSyncTimer !== null) {
    window.clearTimeout(standaloneSyncTimer)
  }

  standaloneSyncTimer = window.setTimeout(() => {
    standaloneSyncTimer = null
    if (latestHandledStandaloneSyncToken >= syncToken) {
      return
    }

    void performStandaloneEncryptionSync(syncToken)
  }, 700)
}

function shouldScheduleStandaloneEncryptionSync(): boolean {
  return pendingSaveAction.value === 'lock'
    || pendingSaveAction.value === 'unlock'
    || pendingSaveAction.value === 'refresh'
}

async function performStandaloneEncryptionSync(syncToken: number): Promise<void> {
  if (latestHandledStandaloneSyncToken >= syncToken) {
    return
  }

  if (Date.now() - lastInterceptedSaveAt < 1200) {
    return
  }

  try {
    const input = await resolveStandaloneSaveInput()
    if (!input) {
      return
    }

    latestHandledStandaloneSyncToken = Math.max(latestHandledStandaloneSyncToken, syncToken)
    const result = await prepareManagedSaveResult(input)
    await commitPreparedDraftSave(result, {
      metadata: {
        name: input.postNameHint,
      },
    })
  } catch (error) {
    setActionMessage('invalid', toMessage(error))
  }
}

async function resolveStandaloneSaveInput(): Promise<PreparedSaveInput | null> {
  const postName = currentPostName.value || await resolveCurrentPostName()
  if (!postName) {
    throw new Error('当前文章尚未保存，请先完成文章保存后再启用加密')
  }

  return {
    content: {
      raw: '',
      content: '',
      rawType: '',
    } as Content,
    metadata: await resolveCurrentMetadata(postName),
    postNameHint: postName,
  }
}

function createEditorDraftSaveInterceptor(): () => void {
  const originalFetch = globalThis.fetch?.bind(globalThis)
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  const xhrRequests = new WeakMap<XMLHttpRequest, {
    method: string
    url: string
  }>()

  if (originalFetch) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = readFetchMethod(input, init)
      const url = readFetchUrl(input)
      const prepared = await prepareFetchDraftSave({
        input,
        init,
        method,
        url,
      })

      if (!prepared) {
        return originalFetch(input, init)
      }

      try {
        const response = await originalFetch(prepared.input, prepared.init)
        if (response.status >= 400) {
          throw new Error(`文章保存失败，接口返回 ${response.status}`)
        }

        void commitPreparedDraftSave(prepared.result, await readFetchJsonBody(response))
        return response
      } catch (error) {
        setActionMessage('invalid', toMessage(error))
        throw error
      }
    }
  }

  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    passwordValue?: string | null
  ): void {
    xhrRequests.set(this, {
      method: typeof method === 'string' ? method.toUpperCase() : 'GET',
      url: String(url),
    })
    originalOpen.call(
      this,
      method,
      url,
      async ?? true,
      username ?? undefined,
      passwordValue ?? undefined
    )
  }

  XMLHttpRequest.prototype.send = function patchedSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null
  ): void {
    const request = xhrRequests.get(this)

    if (!request) {
      originalSend.call(this, body)
      return
    }

    void (async () => {
      try {
        const prepared = await prepareXhrDraftSave({
          body,
          method: request.method,
          url: request.url,
        })

        if (!prepared) {
          originalSend.call(this, body)
          return
        }

        const finalize = () => {
          if (this.status >= 400) {
            setActionMessage('invalid', `文章保存失败，接口返回 ${this.status}`)
            return
          }

          void commitPreparedDraftSave(prepared.result, parseJson(this.responseText))
        }
        const fail = () => {
          setActionMessage('invalid', '文章保存请求失败')
        }

        this.addEventListener('loadend', finalize, { once: true })
        this.addEventListener('error', fail, { once: true })
        this.addEventListener('abort', fail, { once: true })
        originalSend.call(this, prepared.body)
      } catch (error) {
        setActionMessage('invalid', toMessage(error))
        rejectPendingXhr(this)
      }
    })()
  }

  return () => {
    if (globalThis.fetch !== originalFetch && originalFetch) {
      globalThis.fetch = originalFetch
    }
    XMLHttpRequest.prototype.open = originalOpen
    XMLHttpRequest.prototype.send = originalSend
  }
}

function rejectPendingXhr(xhr: XMLHttpRequest): void {
  const errorEvent = new ProgressEvent('error')
  if (typeof xhr.onerror === 'function') {
    xhr.onerror(errorEvent)
    return
  }

  xhr.dispatchEvent(errorEvent)
}

async function prepareFetchDraftSave(args: {
  input: RequestInfo | URL
  init?: RequestInit
  method: string
  url: string
}): Promise<{
  input: RequestInfo | URL
  init?: RequestInit
  result: PreparedDraftSaveResult
} | null> {
  const bodyText = await readFetchBodyText(args.input, args.init)
  if (bodyText === null) {
    return null
  }

  const result = await prepareDraftSaveRequest({
    bodyText,
    method: args.method,
    url: args.url,
  })
  if (!result) {
    return null
  }

  if (typeof Request !== 'undefined' && args.input instanceof Request && !args.init) {
    return {
      input: new Request(args.input, {
        body: result.bodyText,
      }),
      init: undefined,
      result,
    }
  }

  return {
    input: args.input,
    init: {
      ...(args.init ?? {}),
      body: result.bodyText,
      method: args.method,
    },
    result,
  }
}

async function prepareXhrDraftSave(args: {
  body?: Document | XMLHttpRequestBodyInit | null
  method: string
  url: string
}): Promise<{
  body?: Document | XMLHttpRequestBodyInit | null
  result: PreparedDraftSaveResult
} | null> {
  if (typeof args.body !== 'string') {
    return null
  }

  const result = await prepareDraftSaveRequest({
    bodyText: args.body,
    method: args.method,
    url: args.url,
  })
  if (!result) {
    return null
  }

  return {
    body: result.bodyText,
    result,
  }
}

async function prepareDraftSaveRequest(args: {
  bodyText: string
  method: string
  url: string
}): Promise<PreparedDraftSaveResult | null> {
  if (!shouldManageEncryptionOnSave(args.method, args.url)) {
    return null
  }

  lastInterceptedSaveAt = Date.now()
  clearActionMessage()

  const saveInput = await resolveSaveInputFromRequest(args)
  if (!saveInput) {
    return null
  }

  return prepareManagedSaveResult(saveInput, args.bodyText)
}

async function resolveSaveInputFromRequest(args: {
  bodyText: string
  method: string
  url: string
}): Promise<PreparedSaveInput | null> {
  const postRequest = parsePostRequestBody(args.bodyText)
  if (postRequest) {
    return {
      content: postRequest.content,
      metadata: buildMetadataFromPost(postRequest.post),
      postNameHint: currentPostName.value || extractPostNameFromSaveUrl(args.url, args.method),
    }
  }

  const metadataPost = parseMetadataPostBody(args.bodyText)
  if (metadataPost) {
    return {
      content: createEmptyContent(),
      metadata: buildMetadataFromPost(metadataPost),
      postNameHint: metadataPost.metadata.name
        || currentPostName.value
        || extractPostNameFromSaveUrl(args.url, args.method),
    }
  }

  if (!isPostContentSaveRequest(args.method, args.url)) {
    return null
  }

  const content = parseContentBody(args.bodyText)
  if (!content) {
    return null
  }

  const postNameHint = await resolvePostNameForSave(args.url)
  if (!postNameHint) {
    throw new Error('当前文章名称尚未解析完成，请稍后重试')
  }

  return {
    content,
    metadata: await resolveCurrentMetadata(postNameHint),
    postNameHint,
  }
}

async function prepareManagedSaveResult(
  input: PreparedSaveInput,
  bodyText = ''
): Promise<PreparedDraftSaveResult> {
  const nextSavedContent = toHaloPostContent(input.content)
  const currentBundle = parsedBundle.value
  const nextPassword = password.value.trim()
  let nextBundleText = ''
  let action: SaveAction = 'none'
  let refreshPayloadFormat: string | undefined
  let refreshContent: string | undefined

  if (!encryptionEnabled.value) {
    nextBundleText = ''
    action = hasBundle.value ? 'unlock' : 'none'
  } else if (!hasBundle.value) {
    if (!nextPassword) {
      throw new Error('启用文章加密时，请先输入访问密码再保存')
    }
    const recoveryKey = await ensureSiteRecoveryPublicKeyLoaded()
    if (!recoveryKey) {
      throw new Error('站点恢复公钥加载失败，请刷新编辑页后重试')
    }

    const nextDraftContent = readDraftContent(await resolveContentForEncryption(input))
    const nextBundle = await encryptPrivatePost(
      {
        metadata: input.metadata,
        ...nextDraftContent,
      },
      nextPassword,
      recoveryKey
    )

    nextBundleText = JSON.stringify(nextBundle, null, 2)
    action = 'lock'
  } else if (currentBundle) {
    nextBundleText = JSON.stringify({
      ...currentBundle,
      metadata: input.metadata,
    }, null, 2)
    action = 'refresh'
    if (hasContentPayload(input.content)) {
      const nextDraftContent = readDraftContent(input.content)
      refreshPayloadFormat = nextDraftContent.payload_format
      refreshContent = nextDraftContent.content
    }
  } else {
    throw new Error('当前密文异常，请输入访问密码后重新保存')
  }

  return {
    action,
    bodyText,
    bundleText: nextBundleText,
    postNameHint: input.postNameHint,
    savedContent: nextSavedContent,
    refreshPayloadFormat,
    refreshContent,
    refreshMetadata: action === 'refresh' ? input.metadata : undefined,
  }
}

async function resolvePostNameForSave(url: string): Promise<string> {
  const postNameFromUrl = extractPostNameFromSaveUrl(url, 'PUT')
  if (postNameFromUrl) {
    currentPostName.value = postNameFromUrl
    return postNameFromUrl
  }

  if (currentPostName.value) {
    return currentPostName.value
  }

  const resolvedPostName = await resolveCurrentPostName()
  if (resolvedPostName) {
    currentPostName.value = resolvedPostName
  }

  return resolvedPostName
}

function shouldManageEncryptionOnSave(method: string, url: string): boolean {
  if (!encryptionEnabled.value && !hasBundle.value && password.value.trim().length === 0) {
    return false
  }

  const pathname = parseRequestPathname(url)
  if (!pathname) {
    return false
  }

  const normalizedMethod = method.toUpperCase()
  if (normalizedMethod === 'POST') {
    return pathname === '/apis/api.console.halo.run/v1alpha1/posts'
      || pathname === '/apis/content.halo.run/v1alpha1/posts'
  }

  if (normalizedMethod !== 'PUT') {
    return false
  }

  if (isPostContentSavePath(pathname)) {
    return true
  }

  const segments = pathname.split('/').filter(Boolean)
  return segments.length === 5
    && segments[0] === 'apis'
    && (
      (
        segments[1] === 'api.console.halo.run'
        && segments[2] === 'v1alpha1'
        && segments[3] === 'posts'
      )
      || (
        segments[1] === 'content.halo.run'
        && segments[2] === 'v1alpha1'
        && segments[3] === 'posts'
      )
    )
}

function isPostContentSaveRequest(method: string, url: string): boolean {
  return method.toUpperCase() === 'PUT' && isPostContentSavePath(parseRequestPathname(url))
}

function isPostContentSavePath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean)
  return segments.length === 6
    && segments[0] === 'apis'
    && segments[1] === 'api.console.halo.run'
    && segments[2] === 'v1alpha1'
    && segments[3] === 'posts'
    && segments[5] === 'content'
}

function parsePostRequestBody(bodyText: string): PostRequest | null {
  const parsed = parseJson(bodyText)
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const postRequest = parsed as Partial<PostRequest>
  if (!postRequest.post || !postRequest.content) {
    return null
  }

  return postRequest as PostRequest
}

function parseMetadataPostBody(bodyText: string): Post | null {
  const parsed = parseJson(bodyText)
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const post = parsed as Partial<Post>
  if (!post.spec || !post.metadata) {
    return null
  }

  if ('content' in (parsed as Record<string, unknown>)) {
    return null
  }

  return post as Post
}

function parseContentBody(bodyText: string): Content | null {
  const parsed = parseJson(bodyText)
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const content = parsed as Partial<Content>
  if (typeof content.raw !== 'string' && typeof content.content !== 'string') {
    return null
  }

  return {
    raw: typeof content.raw === 'string' ? content.raw : '',
    content: typeof content.content === 'string' ? content.content : '',
    rawType: typeof content.rawType === 'string' ? content.rawType : '',
  } as Content
}

function buildMetadataFromPost(post: Post): BundleMetadata {
  return buildBundleMetadata({
    title: post.spec.title,
    slug: post.spec.slug,
    excerpt: post.spec.excerpt?.raw ?? '',
    publishedAt: post.spec.publishTime ?? '',
  })
}

async function resolveCurrentMetadata(postName: string): Promise<BundleMetadata> {
  const currentBundleMetadata = parsedBundle.value?.metadata
  let savedPostSummary: HaloPostSummary | null = null

  const getSavedPostSummary = async (): Promise<HaloPostSummary | null> => {
    if (savedPostSummary) {
      return savedPostSummary
    }

    try {
      savedPostSummary = await getHaloPostByName(postName)
      return savedPostSummary
    } catch {
      return null
    }
  }

  const title = readInputValue([
    'input[name="title"]',
    'input[id="title"]',
    'input[name="post.spec.title"]',
    'input[id="post.spec.title"]',
    'input[name="spec.title"]',
    'input[id="spec.title"]',
  ])
    || currentBundleMetadata?.title
    || (await getSavedPostSummary())?.title
    || ''

  const slug = readInputValue([
    'input[name="slug"]',
    'input[id="slug"]',
    'input[name="post.spec.slug"]',
    'input[id="post.spec.slug"]',
    'input[name="spec.slug"]',
    'input[id="spec.slug"]',
  ])
    || currentBundleMetadata?.slug
    || (await getSavedPostSummary())?.slug
    || ''

  const excerpt = readInputValue([
    'textarea[name="excerpt"]',
    'textarea[id="excerpt"]',
    'textarea[name="post.spec.excerpt.raw"]',
    'textarea[id="post.spec.excerpt.raw"]',
    'textarea[name="spec.excerpt.raw"]',
    'textarea[id="spec.excerpt.raw"]',
  ])
    || currentBundleMetadata?.excerpt
    || (await getSavedPostSummary())?.excerpt
    || ''

  const publishedAt = readInputValue([
    'input[name="publishTime"]',
    'input[id="publishTime"]',
    'input[name="post.spec.publishTime"]',
    'input[id="post.spec.publishTime"]',
    'input[name="spec.publishTime"]',
    'input[id="spec.publishTime"]',
  ])
    || currentBundleMetadata?.published_at
    || (await getSavedPostSummary())?.publishTime
    || ''

  return buildBundleMetadata({
    title,
    slug,
    excerpt,
    publishedAt,
  })
}

async function resolveContentForEncryption(input: PreparedSaveInput): Promise<Content> {
  if (hasContentPayload(input.content)) {
    return input.content
  }

  if (!input.postNameHint) {
    throw new Error('当前文章尚未保存，请先保存正文后再启用加密')
  }

  try {
    const savedContent = await fetchHaloPostHeadContent(input.postNameHint)
    return {
      raw: savedContent.raw ?? '',
      content: savedContent.content ?? '',
      rawType: savedContent.rawType ?? '',
    } as Content
  } catch {
    throw new Error('当前文章还没有已保存正文，请先保存正文后再启用加密')
  }
}

function buildBundleMetadata(args: {
  title: string
  slug: string
  excerpt?: string
  publishedAt?: string
}): BundleMetadata {
  const normalizedTitle = args.title.trim()
  if (!normalizedTitle) {
    throw new Error('请先填写文章标题后再保存')
  }

  const normalizedSlug = args.slug.trim()
  if (!normalizedSlug) {
    throw new Error('请先填写文章 slug 后再保存')
  }

  const normalizedExcerpt = args.excerpt?.trim() ?? ''
  const normalizedPublishedAt = args.publishedAt?.trim() ?? ''

  return {
    title: normalizedTitle,
    slug: normalizedSlug,
    ...(normalizedExcerpt ? { excerpt: normalizedExcerpt } : {}),
    ...(normalizedPublishedAt ? { published_at: normalizedPublishedAt } : {}),
  }
}

function readDraftContent(
  content: Content
): Pick<DecryptedPrivatePostDocument, 'payload_format' | 'content'> {
  const raw = content.raw.trim()
  const rendered = content.content.trim()
  const rawType = content.rawType.trim().toLowerCase()
  const nextContent = raw || rendered

  if (!nextContent) {
    throw new Error('当前文章还没有正文内容，请先输入正文后再保存')
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

function toHaloPostContent(content: Content): HaloPostContent {
  return {
    content: content.content,
    raw: content.raw,
    rawType: content.rawType,
  }
}

function hasContentPayload(content: Content): boolean {
  return Boolean(content.raw?.trim() || content.content?.trim())
}

function hasDraftContentChanged(saved: HaloPostContent, next: Content): boolean {
  const savedRaw = saved.raw ?? ''
  const nextRaw = next.raw ?? ''
  if (savedRaw !== nextRaw) {
    return true
  }

  const savedContentValue = saved.content ?? ''
  if (!savedRaw && savedContentValue !== (next.content ?? '')) {
    return true
  }

  return normalizeRawType(saved.rawType) !== normalizeRawType(next.rawType)
}

function normalizeRawType(value?: string): string {
  return value?.trim().toLowerCase() ?? ''
}

async function ensureSiteRecoveryPublicKeyLoaded(): Promise<SiteRecoveryPublicKey | null> {
  if (siteRecoveryPublicKey) {
    return siteRecoveryPublicKey
  }

  if (siteRecoveryPublicKeyPromise) {
    return siteRecoveryPublicKeyPromise
  }

  siteRecoveryPublicKeyPromise = fetchSiteRecoveryPublicKey()
    .then((publicKey) => {
      siteRecoveryPublicKey = publicKey
      return publicKey
    })
    .catch(() => null)
    .finally(() => {
      siteRecoveryPublicKeyPromise = null
    })

  return siteRecoveryPublicKeyPromise
}

async function commitPreparedDraftSave(
  result: PreparedDraftSaveResult,
  responseData: unknown
): Promise<void> {
  const resolvedPostName = extractPostNameFromResponse(responseData)
    || result.postNameHint
    || currentPostName.value

  if (resolvedPostName) {
    currentPostName.value = resolvedPostName
  }

  if (requiresBundlePersistence(result.action)) {
    if (!resolvedPostName) {
      setActionMessage(
        'invalid',
        '文章正文已保存，但未能解析文章名称，请刷新编辑页后重试加密状态同步。'
      )
      return
    }

    const persistSignature = [
      resolvedPostName,
      result.action,
      result.bundleText.trim(),
    ].join('::')
    if (
      persistSignature === lastPersistedSignature
      && Date.now() - lastPersistedAt < 1500
    ) {
      writeBundleFieldValue(result.bundleText)
      applyOptimisticBundleText(result.bundleText)
      encryptionEnabled.value = result.bundleText.trim().length > 0
      encryptionDirty.value = false
      password.value = ''
      if (!result.bundleText.trim()) {
        showPassword.value = false
      }
      setActionMessage(resultTone(result.action), resultMessage(result.action))
      return
    }

    lastPersistedSignature = persistSignature
    lastPersistedAt = Date.now()
    try {
      if (result.action === 'refresh') {
        const refreshedBundle = await refreshPrivatePostBundleWithSiteRecovery({
          postName: resolvedPostName,
          payloadFormat: result.refreshPayloadFormat,
          content: result.refreshContent,
          metadata: result.refreshMetadata,
        })
        result.bundleText = JSON.stringify(refreshedBundle, null, 2)
      } else {
        await persistPrivatePostBundleAnnotation(resolvedPostName, result.bundleText)
      }
      void waitForBundlePersistence(result.action, resolvedPostName, result.bundleText)
    } catch (error) {
      lastPersistedSignature = ''
      lastPersistedAt = 0
      setActionMessage('invalid', buildBundlePersistenceFailureMessage(result.action, error))
    }
  }

  writeBundleFieldValue(result.bundleText)
  applyOptimisticBundleText(result.bundleText)
  encryptionEnabled.value = result.bundleText.trim().length > 0
  encryptionDirty.value = false
  password.value = ''
  if (!result.bundleText.trim()) {
    showPassword.value = false
  }

  setActionMessage(resultTone(result.action), resultMessage(result.action))
}

function requiresBundlePersistence(action: SaveAction): boolean {
  return action === 'lock'
    || action === 'unlock'
    || action === 'refresh'
    || action === 'metadata-sync'
}

async function waitForBundlePersistence(
  action: SaveAction,
  postName: string,
  nextBundleText: string
): Promise<void> {
  if (action === 'unlock') {
    await waitForPrivatePostRemoval({ postName })
    return
  }

  if (action === 'refresh') {
    await waitForPrivatePostSync({
      postName,
    })
    return
  }

  const nextBundle = parseExpectedBundle(nextBundleText)
  if (!nextBundle) {
    return
  }

  await waitForPrivatePostSync({
    postName,
    expectedBundle: nextBundle,
  })
}

function parseExpectedBundle(bundleText: string): EncryptedPrivatePostBundle | null {
  const normalizedBundleText = bundleText.trim()
  if (!normalizedBundleText) {
    return null
  }

  try {
    return parseBundleJson(normalizedBundleText)
  } catch {
    return null
  }
}

function buildBundlePersistenceFailureMessage(action: SaveAction, error: unknown): string {
  const actionLabel = action === 'unlock' ? '取消加锁' : '加锁状态'
  return `文章正文已保存，但${actionLabel}同步失败：${toMessage(error)}`
}

function writeBundleFieldValue(value: string): void {
  if (!bundleField) {
    return
  }

  bundleField.value = value
}

function resultTone(action: SaveAction): StatusTone {
  if (action === 'unlock' || action === 'none') {
    return 'neutral'
  }

  return 'success'
}

function resultMessage(action: SaveAction): string {
  if (action === 'lock') {
    return '已保存，当前文章已加锁。'
  }

  if (action === 'unlock') {
    return '已保存，当前文章已取消加锁。'
  }

  if (action === 'refresh') {
    return '已保存，当前加密内容已更新。'
  }

  if (action === 'metadata-sync') {
    return '已保存，当前加密文章的公开元数据已同步。'
  }

  if (encryptionEnabled.value) {
    return '已保存，当前文章仍保持加锁。'
  }

  return '已保存。'
}

async function readFetchBodyText(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<string | null> {
  if (typeof init?.body === 'string') {
    return init.body
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      return await input.clone().text()
    } catch {
      return null
    }
  }

  return null
}

async function readFetchJsonBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!/json/i.test(contentType)) {
    return null
  }

  try {
    return await response.clone().json()
  } catch {
    return null
  }
}

function extractPostNameFromSaveUrl(url: string, method: string): string {
  if (method.toUpperCase() === 'POST') {
    return ''
  }

  const pathname = parseRequestPathname(url)
  const segments = pathname.split('/').filter(Boolean)
  if (
    segments.length === 5
    && segments[0] === 'apis'
    && segments[2] === 'v1alpha1'
    && segments[3] === 'posts'
    && (
      segments[1] === 'api.console.halo.run'
      || segments[1] === 'content.halo.run'
    )
  ) {
    return decodeURIComponent(segments[4] ?? '')
  }

  if (isPostContentSavePath(pathname)) {
    return decodeURIComponent(segments[4] ?? '')
  }

  return ''
}

function extractPostNameFromResponse(responseData: unknown): string {
  if (!responseData || typeof responseData !== 'object') {
    return ''
  }

  const metadata = (responseData as { metadata?: { name?: unknown } }).metadata
  return typeof metadata?.name === 'string' ? metadata.name : ''
}

function parseRequestPathname(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname
  } catch {
    return ''
  }
}

function readFetchMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) {
    return init.method.toUpperCase()
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.method.toUpperCase()
  }

  return 'GET'
}

function readFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}

function parseJson(value: string): unknown {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
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

async function syncCurrentPostName(): Promise<void> {
  currentPostName.value = await resolveCurrentPostName()
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

function createEmptyContent(): Content {
  return {
    raw: '',
    content: '',
    rawType: '',
  } as Content
}

interface PreparedSaveInput {
  content: Content
  metadata: BundleMetadata
  postNameHint: string
}

interface PreparedDraftSaveResult {
  action: SaveAction
  bodyText: string
  bundleText: string
  postNameHint: string
  savedContent: HaloPostContent
  refreshPayloadFormat?: string
  refreshContent?: string
  refreshMetadata?: BundleMetadata
}
</script>

<template>
  <Teleport v-if="slotAvailable" :to="mountSelector">
    <section class="hpp-annotation-tool" data-hpp-annotation-panel="true">
      <div class="hpp-annotation-head">
        <div>
          <p class="hpp-annotation-label">文章加密</p>
        </div>
        <span class="hpp-annotation-badge" :data-tone="statusTone">
          {{ statusLabel }}
        </span>
      </div>

      <p class="hpp-annotation-state" :data-tone="statusTone">
        {{ statusMessage }}
      </p>

      <label class="hpp-annotation-switch">
        <input
          :checked="encryptionEnabled"
          type="checkbox"
          @change="handleEncryptionToggle"
        />
        <span>启用文章加密</span>
      </label>

      <div v-if="encryptionEnabled" class="hpp-annotation-password-card">
        <div class="hpp-annotation-password-row">
          <label class="hpp-annotation-field">
            <span>访问密码</span>
            <input
              :value="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              class="hpp-annotation-input"
              :placeholder="passwordPlaceholder"
              @input="password = ($event.target as HTMLInputElement).value; handlePasswordInput()"
            />
          </label>

          <label class="hpp-annotation-switch hpp-annotation-switch-inline">
            <input v-model="showPassword" type="checkbox" />
            <span>显示密码</span>
          </label>
        </div>

        <p class="hpp-annotation-note">
          {{ passwordHelp }}
        </p>
      </div>
    </section>
  </Teleport>
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

.hpp-annotation-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.hpp-annotation-switch input {
  width: 16px;
  height: 16px;
  margin: 0;
}

.hpp-annotation-switch-inline {
  flex-shrink: 0;
  margin-top: 24px;
  font-size: 13px;
  font-weight: 500;
  color: #475569;
}

.hpp-annotation-password-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(241, 245, 249, 0.72);
  border: 1px solid rgba(203, 213, 225, 0.9);
}

.hpp-annotation-password-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.hpp-annotation-field {
  flex: 1;
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: #334155;
}

.hpp-annotation-input {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 14px;
  color: #0f172a;
  background: #ffffff;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.hpp-annotation-input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
}

@media (max-width: 720px) {
  .hpp-annotation-head,
  .hpp-annotation-password-row {
    flex-direction: column;
  }

  .hpp-annotation-switch-inline {
    margin-top: 0;
  }
}
</style>
