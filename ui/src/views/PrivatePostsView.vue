<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getHaloPostByName, listHaloPosts } from '@/api/posts'
import {
  buildPrivatePostResource,
  createPrivatePost,
  deletePrivatePost,
  listPrivatePosts,
  updatePrivatePost,
} from '@/api/private-posts'
import type { HaloPostSummary } from '@/api/posts'
import type { EncryptedPrivatePostBundle, PrivatePost } from '@/types/private-post'
import { syncPrivatePostRegistry } from '@/stores/private-post-registry'
import {
  decryptPrivatePost,
  parseBundleJson,
  renderMarkdown,
} from '@/utils/private-post-crypto'

const route = useRoute()
const router = useRouter()

const items = ref<PrivatePost[]>([])
const loading = ref(false)
const loadingPosts = ref(false)
const loadingSelectedPost = ref(false)
const saving = ref(false)
const testing = ref(false)
const successMessage = ref('')
const errorMessage = ref('')
const previewHtml = ref('')
const recentPosts = ref<HaloPostSummary[]>([])
const selectedPost = ref<HaloPostSummary | null>(null)
const postPickerInput = ref('')
const form = ref({
  postName: '',
  bundleText: '',
  password: '',
})
const editing = ref<PrivatePost | null>(null)

const routePostName = computed(() => readQueryString(route.query.postName))
const selectedPostMapping = computed(() => {
  if (!routePostName.value) {
    return null
  }

  return items.value.find((item) => item.spec.postName === routePostName.value) ?? null
})

const parsedBundle = computed<EncryptedPrivatePostBundle | null>(() => {
  if (form.value.bundleText.trim().length === 0) {
    return null
  }

  try {
    return parseBundleJson(form.value.bundleText)
  } catch {
    return null
  }
})

const bundleParseError = computed(() => {
  if (form.value.bundleText.trim().length === 0) {
    return ''
  }

  try {
    parseBundleJson(form.value.bundleText)
    return ''
  } catch (error) {
    return toMessage(error)
  }
})

const bundleMetadataWarnings = computed(() => {
  const warnings: string[] = []
  if (!selectedPost.value || !parsedBundle.value) {
    return warnings
  }

  if (parsedBundle.value.metadata.slug !== selectedPost.value.slug) {
    warnings.push(
      `bundle 的 slug 是 ${parsedBundle.value.metadata.slug}，当前文章的 slug 是 ${selectedPost.value.slug}。`
    )
  }

  if (parsedBundle.value.metadata.title !== selectedPost.value.title) {
    warnings.push(
      `bundle 的 title 是 ${parsedBundle.value.metadata.title}，当前文章的 title 是 ${selectedPost.value.title}。`
    )
  }

  return warnings
})

onMounted(async () => {
  await Promise.all([refreshItems(), refreshRecentPosts()])
  await syncSelectionFromRoute()
})

watch(routePostName, () => {
  void syncSelectionFromRoute()
})

async function refreshItems() {
  loading.value = true
  errorMessage.value = ''
  try {
    items.value = await listPrivatePosts()
    syncPrivatePostRegistry(items.value)
  } catch (error) {
    errorMessage.value = `加载私密文章失败：${toMessage(error)}`
  } finally {
    loading.value = false
  }
}

async function refreshRecentPosts(keyword = '') {
  loadingPosts.value = true
  try {
    recentPosts.value = await listHaloPosts(keyword)
  } catch (error) {
    errorMessage.value = `加载 Halo 文章失败：${toMessage(error)}`
  } finally {
    loadingPosts.value = false
  }
}

async function syncSelectionFromRoute() {
  const postName = routePostName.value
  postPickerInput.value = postName

  if (!postName) {
    selectedPost.value = null
    if (!editing.value) {
      resetForm('')
    }
    return
  }

  loadingSelectedPost.value = true
  try {
    selectedPost.value = await getHaloPostByName(postName)
  } catch (error) {
    selectedPost.value = null
    errorMessage.value = `加载关联文章失败：${toMessage(error)}`
  } finally {
    loadingSelectedPost.value = false
  }

  if (selectedPostMapping.value) {
    fillForm(selectedPostMapping.value)
    return
  }

  prefillForPost(postName)
}

function fillForm(privatePost: PrivatePost) {
  editing.value = privatePost
  successMessage.value = ''
  errorMessage.value = ''
  previewHtml.value = ''
  postPickerInput.value = privatePost.spec.postName
  form.value = {
    postName: privatePost.spec.postName,
    bundleText: JSON.stringify(privatePost.spec.bundle, null, 2),
    password: '',
  }
}

function prefillForPost(postName: string) {
  editing.value = null
  successMessage.value = ''
  errorMessage.value = ''
  previewHtml.value = ''
  form.value = {
    postName,
    bundleText: '',
    password: '',
  }
}

function resetForm(defaultPostName = routePostName.value) {
  editing.value = null
  successMessage.value = ''
  errorMessage.value = ''
  previewHtml.value = ''
  form.value = {
    postName: defaultPostName,
    bundleText: '',
    password: '',
  }
}

function handleResetForm() {
  resetForm()
}

async function validateLocally() {
  if (!parsedBundle.value) {
    errorMessage.value = bundleParseError.value || '请先提供有效的 bundle JSON'
    return
  }

  if (form.value.password.trim().length === 0) {
    errorMessage.value = '请提供访问密码以测试本地解锁'
    return
  }

  errorMessage.value = ''
  successMessage.value = ''
  testing.value = true
  try {
    const decrypted = await decryptPrivatePost(parsedBundle.value, form.value.password)
    previewHtml.value = await renderMarkdown(decrypted.markdown)
    successMessage.value = '本地解锁成功。密码没有发送到 Halo 服务端。'
  } catch (error) {
    previewHtml.value = ''
    errorMessage.value = toMessage(error)
  } finally {
    testing.value = false
  }
}

async function saveBundle() {
  if (form.value.postName.trim().length === 0) {
    errorMessage.value = '请填写 Halo postName'
    return
  }

  if (!parsedBundle.value) {
    errorMessage.value = bundleParseError.value || '请先提供有效的 bundle JSON'
    return
  }

  const targetPostName = form.value.postName.trim()
  const wasEditing = Boolean(editing.value)
  saving.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const payload = buildPrivatePostResource({
      bundle: parsedBundle.value,
      postName: targetPostName,
      existing: editing.value,
    })

    if (editing.value) {
      await updatePrivatePost(payload)
    } else {
      await createPrivatePost(payload)
    }

    successMessage.value = wasEditing
      ? '私密文章映射已更新。'
      : '私密文章映射已创建。'
    await refreshItems()
    const savedItem = items.value.find((item) => item.spec.postName === targetPostName) ?? null
    if (savedItem) {
      fillForm(savedItem)
      successMessage.value = wasEditing
        ? '私密正文已更新，文章列表里的状态也会同步刷新。'
        : '私密正文已创建，文章列表里的状态也会同步刷新。'
    } else {
      resetForm()
    }
  } catch (error) {
    errorMessage.value = `保存失败：${toMessage(error)}`
  } finally {
    saving.value = false
  }
}

async function removeItem(privatePost: PrivatePost) {
  if (!window.confirm(`确认删除 ${privatePost.spec.title} 的私密正文映射？`)) {
    return
  }

  errorMessage.value = ''
  successMessage.value = ''
  try {
    await deletePrivatePost(privatePost.metadata.name)
    if (editing.value?.metadata.name === privatePost.metadata.name) {
      if (routePostName.value) {
        prefillForPost(routePostName.value)
      } else {
        resetForm()
      }
    }
    successMessage.value = '私密文章映射已删除。'
    await refreshItems()
  } catch (error) {
    errorMessage.value = `删除失败：${toMessage(error)}`
  }
}

async function navigateToPost(postName: string) {
  const normalized = postName.trim()
  if (!normalized) {
    errorMessage.value = '请先输入 Halo postName，或从文章列表里的“私密正文”入口进入。'
    return
  }

  await router.replace({
    name: 'HaloPrivatePosts',
    query: {
      ...route.query,
      postName: normalized,
    },
  })
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

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误'
}

function readerUrlFor(slug: string) {
  return `/private-posts?slug=${encodeURIComponent(slug)}`
}

function readQueryString(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}
</script>

<template>
  <section class="private-posts-view">
    <header class="hero">
      <div>
        <p class="eyebrow">Halo Private Posts</p>
        <h1>加密正文托管与浏览器本地解锁</h1>
        <p class="summary">
          这一页现在更偏向“给已有 Halo 文章挂私密正文”。推荐直接从文章列表里的“私密正文”入口进入，
          再为对应文章维护加密 bundle。读者访问 `/private-posts?slug=...` 时，正文会在浏览器本地解密，并在切后台、
          离开页面或空闲超时后自动重锁。
        </p>
      </div>
      <div class="hero-actions">
        <a class="hero-link" href="https://docs.halo.run/category/%E6%8F%92%E4%BB%B6%E5%BC%80%E5%8F%91" target="_blank">
          查看接入文档
        </a>
        <a class="hero-link secondary" href="https://docs.halo.run/category/%E6%8F%92%E4%BB%B6%E5%BC%80%E5%8F%91" target="_blank">
          Halo 插件文档
        </a>
      </div>
    </header>

    <div class="banner error" v-if="errorMessage">{{ errorMessage }}</div>
    <div class="banner success" v-if="successMessage">{{ successMessage }}</div>

    <div class="layout">
      <section class="editor-card">
        <div class="card-header">
          <div>
            <h2>{{ editing ? '编辑私密文章映射' : '新建私密文章映射' }}</h2>
            <p>保存时只会提交 bundle 和 `postName`，本地验证密码不会上传。优先从文章列表进入这里，会更接近最终使用流。</p>
          </div>
          <button class="ghost-button" type="button" @click="handleResetForm">清空表单</button>
        </div>

        <section class="binding-panel">
          <div class="section-header">
            <div>
              <h3>关联 Halo 文章</h3>
              <p>推荐从文章列表里的“私密正文”字段直接进入。你也可以在这里载入最近文章，把私密正文配置到一篇现有文章上。</p>
            </div>
            <button v-if="selectedPost" class="ghost-button" type="button" @click="clearSelectedPost">
              取消关联
            </button>
          </div>

          <div class="picker-row">
            <input
              v-model="postPickerInput"
              class="text-input"
              list="halo-post-options"
              type="text"
              placeholder="输入 Halo postName，或从下方最近文章中选一篇"
            />
            <button class="secondary-button" type="button" :disabled="loadingSelectedPost" @click="navigateToPost(postPickerInput)">
              {{ loadingSelectedPost ? '载入中…' : '载入文章' }}
            </button>
            <button class="ghost-button" type="button" :disabled="loadingPosts" @click="refreshRecentPosts(postPickerInput)">
              {{ loadingPosts ? '搜索中…' : '搜索最近文章' }}
            </button>
          </div>

          <datalist id="halo-post-options">
            <option v-for="post in recentPosts" :key="post.name" :value="post.name">
              {{ post.title }} · {{ post.slug }}
            </option>
          </datalist>

          <div v-if="recentPosts.length > 0 && !selectedPost" class="recent-posts">
            <button
              v-for="post in recentPosts"
              :key="post.name"
              class="recent-post-button"
              type="button"
              @click="navigateToPost(post.name)"
            >
              <strong>{{ post.title }}</strong>
              <span>{{ post.slug }}</span>
            </button>
          </div>

          <div v-if="routePostName || selectedPost" class="selected-post-card">
            <div class="selected-post-head">
              <span class="state-pill" :class="{ active: selectedPostMapping }">
                {{ selectedPostMapping ? '已配置私密正文' : '未配置私密正文' }}
              </span>
              <span class="state-pill subtle">{{ routePostName }}</span>
            </div>

            <template v-if="selectedPost">
              <h3>{{ selectedPost.title }}</h3>
              <p class="selected-post-slug">{{ selectedPost.slug }}</p>
              <p class="selected-post-excerpt" v-if="selectedPost.excerpt">{{ selectedPost.excerpt }}</p>
              <dl class="selected-post-meta">
                <div>
                  <dt>发布时间</dt>
                  <dd>{{ formatTimestamp(selectedPost.publishTime) }}</dd>
                </div>
                <div>
                  <dt>可见性</dt>
                  <dd>{{ selectedPost.visible || '未设置' }}</dd>
                </div>
              </dl>
            </template>

            <p v-else class="selected-post-excerpt">
              当前已经锁定到文章 `{{ routePostName }}`，但还没拿到这篇文章的详细信息。
            </p>
          </div>
        </section>

        <label class="field">
          <span>Halo postName</span>
          <input
            v-model="form.postName"
            class="text-input"
            type="text"
            :readonly="Boolean(selectedPost)"
            placeholder="例如：e0507f6f-88bb-4d3c-a90a-a88aba222035"
          />
          <small class="field-hint" v-if="selectedPost">
            当前已锁定为所选文章的 `metadata.name`。如果想手工改成别的文章，先点“取消关联”。
          </small>
        </label>

        <div class="field">
          <span>ZKVault bundle JSON</span>
          <textarea
            v-model="form.bundleText"
            class="code-input"
            rows="18"
            placeholder="{ ... EncryptedPrivatePostBundle v1 ... }"
          />
          <small v-if="bundleParseError" class="field-error">{{ bundleParseError }}</small>
        </div>

        <div class="bundle-meta" v-if="parsedBundle">
          <div>
            <span class="meta-label">slug</span>
            <strong>{{ parsedBundle.metadata.slug }}</strong>
          </div>
          <div>
            <span class="meta-label">title</span>
            <strong>{{ parsedBundle.metadata.title }}</strong>
          </div>
          <div>
            <span class="meta-label">published_at</span>
            <strong>{{ parsedBundle.metadata.published_at || '未设置' }}</strong>
          </div>
        </div>

        <div class="bundle-warning" v-if="bundleMetadataWarnings.length > 0">
          <h3>bundle 公开元数据与当前文章不一致</h3>
          <ul>
            <li v-for="warning in bundleMetadataWarnings" :key="warning">{{ warning }}</li>
          </ul>
        </div>

        <div class="test-row">
          <label class="field test-field">
            <span>本地解锁测试密码</span>
            <input
              v-model="form.password"
              class="text-input"
              type="password"
              autocomplete="current-password"
              placeholder="仅用于浏览器本地验证"
            />
          </label>
          <button class="secondary-button" type="button" :disabled="testing" @click="validateLocally">
            {{ testing ? '验证中…' : '测试本地解锁' }}
          </button>
          <button class="primary-button" type="button" :disabled="saving" @click="saveBundle">
            {{ saving ? '保存中…' : editing ? '更新映射' : '保存映射' }}
          </button>
        </div>

        <div class="preview-card" v-if="previewHtml">
          <div class="preview-header">
            <h3>本地解锁预览</h3>
            <span>基于浏览器 `scrypt + AES-256-GCM`</span>
          </div>
          <article class="preview-content" v-html="previewHtml" />
        </div>

        <div class="guide">
          <h3>主题接入提示</h3>
          <p>
            主题可以通过 Finder `haloPrivatePostFinder.getByPostName(post.metadata.name)` 判断当前文章是否绑定了私密正文，
            然后自行渲染锁定页，或者直接跳到插件提供的 `/private-posts?slug=...` 独立阅读页。文章列表里也会显示“是否已配置私密正文”的状态字段。
          </p>
          <pre class="code-snippet">&lt;th:block th:with="privatePost=${haloPrivatePostFinder.getByPostName(post.metadata.name).block()}"&gt;
  &lt;a th:if="${privatePost != null}" th:href="${privatePost.readerUrl}"&gt;阅读私密正文&lt;/a&gt;
&lt;/th:block&gt;</pre>
        </div>
      </section>

      <aside class="list-card">
        <div class="card-header">
          <div>
            <h2>已保存条目</h2>
            <p>一个 `postName` 和一个 `slug` 都只允许绑定一条记录。</p>
          </div>
          <button class="ghost-button" type="button" :disabled="loading" @click="refreshItems">
            {{ loading ? '刷新中…' : '刷新' }}
          </button>
        </div>

        <div class="empty-state" v-if="!loading && items.length === 0">
          还没有私密文章映射。先录入一条 bundle 试试。
        </div>

        <ul class="post-list" v-else>
          <li v-for="item in items" :key="item.metadata.name" class="post-item">
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
            </dl>

            <p class="post-item-excerpt">{{ item.spec.excerpt || '无公开摘要' }}</p>

            <div class="post-item-actions">
              <a class="item-link" :href="readerUrlFor(item.spec.slug)" target="_blank">阅读页</a>
              <button class="ghost-button" type="button" @click="fillForm(item)">编辑</button>
              <button class="danger-button" type="button" @click="removeItem(item)">删除</button>
            </div>
          </li>
        </ul>
      </aside>
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

.hero-link {
  display: inline-flex;
  justify-content: center;
  padding: 12px 16px;
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.16);
  color: #f8fafc;
  text-decoration: none;
  font-weight: 600;
}

.hero-link.secondary {
  background: rgba(15, 23, 42, 0.18);
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

.banner.success {
  background: #dcfce7;
  color: #166534;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.9fr);
  gap: 22px;
  margin-top: 22px;
}

.editor-card,
.list-card {
  padding: 26px;
  border-radius: 26px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(12px);
}

.card-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 20px;
}

.card-header h2 {
  margin: 0;
  font-size: 22px;
}

.card-header p {
  margin: 8px 0 0;
  color: #475569;
  line-height: 1.5;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
  font-weight: 600;
}

.field span {
  font-size: 14px;
  color: #0f172a;
}

.text-input,
.code-input {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 16px;
  background: rgba(248, 250, 252, 0.92);
  color: #0f172a;
  font: inherit;
}

.text-input:focus,
.code-input:focus {
  outline: none;
  border-color: #0f766e;
  box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.12);
}

.code-input {
  min-height: 340px;
  font-family:
    'JetBrains Mono', 'SFMono-Regular', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo,
    monospace;
  font-size: 13px;
  line-height: 1.6;
}

.field-error {
  color: #b91c1c;
}

.field-hint {
  color: #475569;
  font-weight: 500;
}

.binding-panel {
  margin-bottom: 20px;
  padding: 20px;
  border-radius: 22px;
  background: rgba(248, 250, 252, 0.86);
}

.section-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}

.section-header h3 {
  margin: 0;
  font-size: 18px;
}

.section-header p {
  margin: 8px 0 0;
  color: #475569;
  line-height: 1.6;
}

.picker-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
}

.recent-posts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.recent-post-button {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 16px;
  background: #fff;
  color: #0f172a;
  text-align: left;
  cursor: pointer;
}

.recent-post-button span {
  color: #64748b;
  font-size: 13px;
}

.selected-post-card {
  margin-top: 14px;
  padding: 18px;
  border-radius: 18px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.selected-post-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.state-pill {
  display: inline-flex;
  align-items: center;
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

.selected-post-card h3 {
  margin: 0;
  font-size: 20px;
}

.selected-post-slug {
  margin: 6px 0 0;
  color: #0f766e;
  font-weight: 700;
}

.selected-post-excerpt {
  margin: 12px 0 0;
  color: #475569;
  line-height: 1.6;
}

.selected-post-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 14px 0 0;
}

.selected-post-meta dt {
  margin: 0 0 4px;
  font-size: 12px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.selected-post-meta dd {
  margin: 0;
  color: #0f172a;
}

.bundle-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin: 0 0 20px;
  padding: 18px;
  border-radius: 18px;
  background: linear-gradient(180deg, #f8fafc 0%, #eff6ff 100%);
}

.meta-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #64748b;
}

.test-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: end;
}

.test-field {
  margin-bottom: 0;
}

.primary-button,
.secondary-button,
.ghost-button,
.danger-button {
  border: 0;
  border-radius: 16px;
  padding: 14px 18px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  background: #0f766e;
  color: #f8fafc;
}

.secondary-button {
  background: #0f172a;
  color: #f8fafc;
}

.ghost-button {
  background: rgba(15, 23, 42, 0.06);
  color: #0f172a;
}

.danger-button {
  background: #fee2e2;
  color: #991b1b;
}

.primary-button:disabled,
.secondary-button:disabled,
.ghost-button:disabled,
.danger-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.bundle-warning {
  margin: 0 0 20px;
  padding: 18px;
  border-radius: 18px;
  background: #fff7ed;
  color: #9a3412;
}

.bundle-warning h3 {
  margin: 0 0 10px;
  font-size: 16px;
}

.bundle-warning ul {
  margin: 0;
  padding-left: 18px;
}

.preview-card,
.guide {
  margin-top: 22px;
  padding: 22px;
  border-radius: 22px;
  background: rgba(248, 250, 252, 0.86);
}

.preview-header {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: baseline;
}

.preview-header h3,
.guide h3 {
  margin: 0;
}

.preview-header span,
.guide p {
  color: #475569;
}

.preview-content {
  margin-top: 18px;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
  line-height: 1.8;
}

.preview-content :deep(h1),
.preview-content :deep(h2),
.preview-content :deep(h3) {
  line-height: 1.25;
}

.code-snippet {
  overflow: auto;
  margin-top: 14px;
  padding: 16px;
  border-radius: 16px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 13px;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 16px 0 12px;
}

.post-item-meta dt {
  margin: 0 0 4px;
  font-size: 12px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.post-item-meta dd {
  margin: 0;
  color: #0f172a;
}

.post-item-excerpt {
  margin: 0;
  color: #475569;
  line-height: 1.6;
}

.post-item-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  align-items: center;
}

.item-link {
  color: #0f766e;
  font-weight: 700;
  text-decoration: none;
}

@media (max-width: 1080px) {
  .layout {
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
  .editor-card,
  .list-card {
    padding: 20px;
    border-radius: 22px;
  }

  .section-header,
  .picker-row,
  .bundle-meta,
  .test-row,
  .selected-post-meta,
  .post-item-meta {
    grid-template-columns: 1fr;
  }

  .recent-posts {
    grid-template-columns: 1fr;
  }
}
</style>
