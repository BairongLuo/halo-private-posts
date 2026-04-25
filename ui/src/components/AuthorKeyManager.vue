<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  buildAuthorKeyResource,
  listAuthorKeysByOwner,
  upsertAuthorKey,
} from '@/api/author-keys'
import { getCurrentHaloUserName } from '@/api/users'
import type { AuthorKeyResource, LocalAuthorKeyRecord } from '@/types/author-key'
import {
  exportAuthorKeyRecord,
  generateAuthorKeyRecord,
  importAuthorKeyRecord,
} from '@/utils/author-key-crypto'
import {
  deleteLocalAuthorKey,
  listLocalAuthorKeysByOwner,
  saveLocalAuthorKey,
} from '@/utils/author-key-store'

type MessageTone = 'neutral' | 'success' | 'invalid'

interface AuthorKeyRow {
  fingerprint: string
  displayName: string
  algorithm: string
  createdAt: string
  remote?: AuthorKeyResource
  local?: LocalAuthorKeyRecord
}

const loading = ref(false)
const currentUserName = ref('')
const remoteKeys = ref<AuthorKeyResource[]>([])
const localKeys = ref<LocalAuthorKeyRecord[]>([])
const importText = ref('')
const message = ref('')
const messageTone = ref<MessageTone>('neutral')

const rows = computed<AuthorKeyRow[]>(() => {
  const merged = new Map<string, AuthorKeyRow>()

  for (const remote of remoteKeys.value) {
    merged.set(remote.spec.fingerprint, {
      fingerprint: remote.spec.fingerprint,
      displayName: remote.spec.displayName,
      algorithm: remote.spec.algorithm,
      createdAt: remote.spec.createdAt,
      remote,
    })
  }

  for (const local of localKeys.value) {
    const existing = merged.get(local.fingerprint)
    merged.set(local.fingerprint, {
      fingerprint: local.fingerprint,
      displayName: existing?.displayName ?? local.displayName,
      algorithm: existing?.algorithm ?? local.algorithm,
      createdAt: existing?.createdAt ?? local.createdAt,
      remote: existing?.remote,
      local,
    })
  }

  return Array.from(merged.values()).sort((left, right) => {
    return right.createdAt.localeCompare(left.createdAt)
  })
})

const summaryMessage = computed(() => {
  if (!currentUserName.value) {
    return '正在读取当前账号…'
  }

  if (rows.value.length === 0) {
    return `当前账号 ${currentUserName.value} 还没有作者钥匙。生成后，后续文章加锁会自动写入 author slots。`
  }

  return `当前账号 ${currentUserName.value} 共 ${rows.value.length} 把作者钥匙，其中 ${rows.value.filter((row) => row.local).length} 把私钥在当前浏览器可用。`
})

onMounted(() => {
  void refresh()
})

async function refresh(): Promise<void> {
  loading.value = true

  try {
    currentUserName.value = await getCurrentHaloUserName()
    remoteKeys.value = await listAuthorKeysByOwner(currentUserName.value)
    localKeys.value = listLocalAuthorKeysByOwner(currentUserName.value)
    if (!message.value) {
      messageTone.value = 'neutral'
    }
  } catch (error) {
    setMessage('invalid', `读取作者钥匙失败：${toMessage(error)}`)
  } finally {
    loading.value = false
  }
}

async function generateKey(): Promise<void> {
  if (!currentUserName.value) {
    setMessage('invalid', '当前账号尚未加载完成')
    return
  }

  loading.value = true

  try {
    const record = await generateAuthorKeyRecord({
      ownerName: currentUserName.value,
      displayName: buildDefaultDisplayName(),
    })
    saveLocalAuthorKey(record)
    await upsertAuthorKey(buildAuthorKeyResource({
      ownerName: record.ownerName,
      displayName: record.displayName,
      fingerprint: record.fingerprint,
      algorithm: record.algorithm,
      publicKey: JSON.stringify(record.publicKey),
      createdAt: record.createdAt,
    }))
    await refresh()
    setMessage('success', `已生成作者钥匙 ${record.displayName}。后续文章加锁会自动写入这把钥匙。`)
  } catch (error) {
    setMessage('invalid', `生成作者钥匙失败：${toMessage(error)}`)
  } finally {
    loading.value = false
  }
}

async function importKey(): Promise<void> {
  if (!importText.value.trim()) {
    setMessage('invalid', '请先粘贴作者钥匙包 JSON')
    return
  }

  loading.value = true

  try {
    const record = await importAuthorKeyRecord(importText.value)
    if (currentUserName.value && record.ownerName !== currentUserName.value) {
      throw new Error(`这把钥匙属于 ${record.ownerName}，与当前账号 ${currentUserName.value} 不一致`)
    }

    saveLocalAuthorKey(record)
    await upsertAuthorKey(buildAuthorKeyResource({
      ownerName: record.ownerName,
      displayName: record.displayName,
      fingerprint: record.fingerprint,
      algorithm: record.algorithm,
      publicKey: JSON.stringify(record.publicKey),
      createdAt: record.createdAt,
    }))
    importText.value = ''
    await refresh()
    setMessage('success', `已导入作者钥匙 ${record.displayName}。`)
  } catch (error) {
    setMessage('invalid', `导入作者钥匙失败：${toMessage(error)}`)
  } finally {
    loading.value = false
  }
}

function exportKey(record: LocalAuthorKeyRecord): void {
  const blob = new Blob([exportAuthorKeyRecord(record)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${record.ownerName}-${record.fingerprint.slice(0, 12)}.author-key.json`
  anchor.click()
  URL.revokeObjectURL(url)
  setMessage('success', `已导出作者钥匙 ${record.displayName}。`)
}

function removeLocalKey(fingerprint: string): void {
  deleteLocalAuthorKey(fingerprint)
  localKeys.value = listLocalAuthorKeysByOwner(currentUserName.value)
  setMessage('neutral', '已移除当前浏览器中的本地私钥。服务端公钥记录仍然保留。')
}

function setMessage(tone: MessageTone, nextMessage: string): void {
  messageTone.value = tone
  message.value = nextMessage
}

function buildDefaultDisplayName(): string {
  const now = new Date()
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ]

  return `作者钥匙 ${parts[0]}-${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}`
}

function shortFingerprint(fingerprint: string): string {
  if (fingerprint.length <= 20) {
    return fingerprint
  }

  return `${fingerprint.slice(0, 10)}...${fingerprint.slice(-8)}`
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}
</script>

<template>
  <section class="author-key-manager">
    <div class="author-key-head">
      <div>
        <h2>作者钥匙</h2>
        <p class="author-key-summary">
          {{ message || summaryMessage }}
        </p>
      </div>
      <div class="author-key-actions">
        <button class="author-key-button secondary" type="button" :disabled="loading" @click="refresh">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
        <button class="author-key-button" type="button" :disabled="loading || !currentUserName" @click="generateKey">
          生成新钥匙
        </button>
      </div>
    </div>

    <p class="author-key-status" :data-tone="messageTone">
      {{ message || summaryMessage }}
    </p>

    <details class="author-key-import">
      <summary>导入作者钥匙包</summary>
      <p class="author-key-import-help">
        粘贴之前导出的 `.author-key.json` 内容。导入后会把私钥保存到当前浏览器，并补齐服务端公钥记录。
      </p>
      <textarea
        v-model="importText"
        class="author-key-textarea"
        spellcheck="false"
        placeholder="{ ... author key package ... }"
      />
      <div class="author-key-actions">
        <button class="author-key-button" type="button" :disabled="loading" @click="importKey">
          导入钥匙包
        </button>
      </div>
    </details>

    <div class="author-key-empty" v-if="rows.length === 0">
      当前还没有作者钥匙。
    </div>

    <ul class="author-key-list" v-else>
      <li v-for="row in rows" :key="row.fingerprint" class="author-key-item">
        <div class="author-key-item-head">
          <div>
            <h3>{{ row.displayName }}</h3>
            <p>{{ shortFingerprint(row.fingerprint) }}</p>
          </div>
          <div class="author-key-pills">
            <span class="author-key-pill" :data-tone="row.remote ? 'success' : 'neutral'">
              {{ row.remote ? '已同步公钥' : '仅本地' }}
            </span>
            <span class="author-key-pill" :data-tone="row.local ? 'success' : 'invalid'">
              {{ row.local ? '本地私钥可用' : '缺少本地私钥' }}
            </span>
          </div>
        </div>

        <dl class="author-key-meta">
          <div>
            <dt>算法</dt>
            <dd>{{ row.algorithm }}</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{{ formatTimestamp(row.createdAt) }}</dd>
          </div>
        </dl>

        <div class="author-key-actions">
          <button
            v-if="row.local"
            class="author-key-button secondary"
            type="button"
            @click="exportKey(row.local)"
          >
            导出私钥
          </button>
          <button
            v-if="row.local"
            class="author-key-button danger"
            type="button"
            @click="removeLocalKey(row.fingerprint)"
          >
            移除本地私钥
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.author-key-manager {
  display: grid;
  gap: 16px;
  border: 1px solid #dbe4f0;
  border-radius: 20px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
  padding: 20px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.06);
}

.author-key-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.author-key-head h2 {
  margin: 0;
  font-size: 20px;
  color: #0f172a;
}

.author-key-summary,
.author-key-status,
.author-key-import-help,
.author-key-empty {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #475569;
}

.author-key-status[data-tone='success'] {
  color: #166534;
}

.author-key-status[data-tone='invalid'] {
  color: #b91c1c;
}

.author-key-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.author-key-button {
  border: 1px solid #1d4ed8;
  border-radius: 999px;
  background: #1d4ed8;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  padding: 8px 14px;
}

.author-key-button.secondary {
  border-color: #cbd5e1;
  background: #fff;
  color: #0f172a;
}

.author-key-button.danger {
  border-color: #fecaca;
  background: #fff;
  color: #b91c1c;
}

.author-key-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.author-key-import {
  display: grid;
  gap: 10px;
}

.author-key-import summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  color: #1e293b;
}

.author-key-textarea {
  min-height: 160px;
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 14px;
  background: #fff;
  color: #0f172a;
  font: inherit;
  padding: 12px;
  resize: vertical;
}

.author-key-list {
  display: grid;
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.author-key-item {
  display: grid;
  gap: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #fff;
  padding: 16px;
}

.author-key-item-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.author-key-item-head h3 {
  margin: 0;
  font-size: 16px;
  color: #0f172a;
}

.author-key-item-head p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace;
}

.author-key-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.author-key-pill {
  border-radius: 999px;
  background: #e2e8f0;
  color: #334155;
  font-size: 11px;
  font-weight: 700;
  padding: 6px 10px;
}

.author-key-pill[data-tone='success'] {
  background: #dcfce7;
  color: #166534;
}

.author-key-pill[data-tone='invalid'] {
  background: #fee2e2;
  color: #b91c1c;
}

.author-key-meta {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
}

.author-key-meta dt {
  font-size: 12px;
  color: #64748b;
}

.author-key-meta dd {
  margin: 4px 0 0;
  font-size: 13px;
  color: #0f172a;
}

@media (max-width: 768px) {
  .author-key-head,
  .author-key-item-head,
  .author-key-meta {
    display: grid;
  }
}
</style>
