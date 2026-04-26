<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  createRecoveryMnemonicSetup,
  getRecoveryMnemonicWords,
  importRecoveryMnemonic,
  type LocalRecoverySecretState,
} from '@/utils/recovery-phrase'
import {
  getLocalRecoverySecretState,
  saveLocalRecoverySecretState,
} from '@/utils/recovery-secret-store'

type MessageTone = 'neutral' | 'success' | 'invalid'

const emit = defineEmits<{
  changed: [LocalRecoverySecretState | null]
}>()

const loading = ref(false)
const localState = ref<LocalRecoverySecretState | null>(getLocalRecoverySecretState())
const pendingMnemonic = ref('')
const pendingState = ref<LocalRecoverySecretState | null>(null)
const importText = ref('')
const message = ref('')
const messageTone = ref<MessageTone>('neutral')
const confirmationInputs = ref({
  word3: '',
  word7: '',
  word11: '',
})

const pendingWords = computed(() => getRecoveryMnemonicWords(pendingMnemonic.value))
const summaryMessage = computed(() => {
  if (localState.value) {
    return '需要时可在下方重新导入。'
  }

  return '当前浏览器还没有恢复助记词。'
})

function setMessage(tone: MessageTone, nextMessage: string) {
  messageTone.value = tone
  message.value = nextMessage
}

async function startSetup() {
  loading.value = true

  try {
    const setup = await createRecoveryMnemonicSetup()
    pendingMnemonic.value = setup.mnemonic
    pendingState.value = setup.state
    confirmationInputs.value = {
      word3: '',
      word7: '',
      word11: '',
    }
    setMessage('neutral', '恢复助记词已生成。请先离线保存，再完成下方确认。')
  } catch (error) {
    setMessage('invalid', `初始化恢复助记词失败：${toMessage(error)}`)
  } finally {
    loading.value = false
  }
}

function cancelSetup() {
  pendingMnemonic.value = ''
  pendingState.value = null
  confirmationInputs.value = {
    word3: '',
    word7: '',
    word11: '',
  }
  if (!localState.value) {
    setMessage('neutral', '已取消本次恢复助记词初始化。')
  }
}

async function confirmSetup() {
  if (!pendingState.value || pendingWords.value.length < 11) {
    setMessage('invalid', '当前没有可确认的恢复助记词。')
    return
  }

  const checks = [
    { label: '第 3 个单词', expected: pendingWords.value[2], actual: confirmationInputs.value.word3 },
    { label: '第 7 个单词', expected: pendingWords.value[6], actual: confirmationInputs.value.word7 },
    { label: '第 11 个单词', expected: pendingWords.value[10], actual: confirmationInputs.value.word11 },
  ]

  const mismatch = checks.find((item) => normalizeWord(item.actual) !== item.expected)
  if (mismatch) {
    setMessage('invalid', `${mismatch.label} 不正确，请确认你已经正确抄写恢复助记词。`)
    return
  }

  saveLocalRecoverySecretState(pendingState.value)
  localState.value = pendingState.value
  emit('changed', localState.value)
  pendingMnemonic.value = ''
  pendingState.value = null
  confirmationInputs.value = {
    word3: '',
    word7: '',
    word11: '',
  }
  setMessage('success', '恢复助记词已确认并导入当前浏览器。之后不会再次显示。')
}

async function importExistingMnemonic() {
  if (!importText.value.trim()) {
    setMessage('invalid', '请先输入恢复助记词。')
    return
  }

  loading.value = true

  try {
    const state = await importRecoveryMnemonic(importText.value)
    saveLocalRecoverySecretState(state)
    localState.value = state
    emit('changed', localState.value)
    importText.value = ''
    setMessage('success', '恢复助记词已导入当前浏览器。')
  } catch (error) {
    setMessage('invalid', `导入恢复助记词失败：${toMessage(error)}`)
  } finally {
    loading.value = false
  }
}

async function copyPendingMnemonic() {
  if (!pendingMnemonic.value) {
    return
  }

  try {
    await navigator.clipboard.writeText(pendingMnemonic.value)
    setMessage('success', '恢复助记词已复制到剪贴板。')
  } catch (error) {
    setMessage('invalid', `复制恢复助记词失败：${toMessage(error)}`)
  }
}

function downloadPendingMnemonic() {
  if (!pendingMnemonic.value) {
    return
  }

  const blob = new Blob([pendingMnemonic.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'halo-private-posts-recovery-phrase.txt'
  anchor.click()
  URL.revokeObjectURL(url)
  setMessage('success', '恢复助记词已导出为文本文件。')
}

function normalizeWord(value: string) {
  return value.trim().toLowerCase()
}

function formatTimestamp(value?: string): string {
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
</script>

<template>
  <section class="recovery-manager">
    <div class="recovery-head">
      <div>
        <h2>恢复助记词</h2>
        <p class="recovery-summary">{{ summaryMessage }}</p>
      </div>
      <span class="recovery-pill" :data-tone="localState ? 'success' : 'neutral'">
        {{ localState ? '当前浏览器已就绪' : '尚未初始化' }}
      </span>
    </div>

    <p v-if="message" class="recovery-status" :data-tone="messageTone">{{ message }}</p>

    <div v-if="localState" class="recovery-ready">
      <dl class="recovery-meta">
        <div>
          <dt>导入时间</dt>
          <dd>{{ formatTimestamp(localState.createdAt) }}</dd>
        </div>
      </dl>
    </div>

    <div v-else class="recovery-empty">
      <div class="recovery-actions">
        <button class="recovery-button" type="button" :disabled="loading" @click="startSetup">
          {{ loading ? '生成中…' : '初始化恢复助记词' }}
        </button>
      </div>
    </div>

    <section v-if="pendingMnemonic" class="recovery-setup">
      <div class="recovery-setup-head">
        <div>
          <h3>请立即保存这组恢复助记词</h3>
          <p>关闭当前界面后，这组助记词不会再次显示。</p>
        </div>
        <div class="recovery-actions">
          <button class="recovery-button secondary" type="button" @click="copyPendingMnemonic">
            复制
          </button>
          <button class="recovery-button secondary" type="button" @click="downloadPendingMnemonic">
            下载
          </button>
        </div>
      </div>

      <div class="recovery-mnemonic">
        <span v-for="(word, index) in pendingWords" :key="`${index}-${word}`">
          {{ index + 1 }}. {{ word }}
        </span>
      </div>

      <div class="recovery-confirm-grid">
        <label class="recovery-field">
          <span>第 3 个单词</span>
          <input v-model="confirmationInputs.word3" type="text" autocomplete="off" />
        </label>
        <label class="recovery-field">
          <span>第 7 个单词</span>
          <input v-model="confirmationInputs.word7" type="text" autocomplete="off" />
        </label>
        <label class="recovery-field">
          <span>第 11 个单词</span>
          <input v-model="confirmationInputs.word11" type="text" autocomplete="off" />
        </label>
      </div>

      <div class="recovery-actions">
        <button class="recovery-button" type="button" @click="confirmSetup">
          我已抄写并确认
        </button>
        <button class="recovery-button secondary" type="button" @click="cancelSetup">
          取消
        </button>
      </div>
    </section>

    <details class="recovery-import">
      <summary>重新导入助记词</summary>
      <p>把已保存的助记词重新导入到当前浏览器。</p>
      <textarea
        v-model="importText"
        class="recovery-textarea"
        spellcheck="false"
        placeholder="在这里粘贴 12 个英文单词"
      />
      <div class="recovery-actions">
        <button class="recovery-button" type="button" :disabled="loading" @click="importExistingMnemonic">
          导入恢复助记词
        </button>
      </div>
    </details>
  </section>
</template>

<style scoped>
.recovery-manager {
  display: grid;
  gap: 16px;
  border: 1px solid #dbe4f0;
  border-radius: 18px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
  padding: 18px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.06);
}

.recovery-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.recovery-head h2,
.recovery-setup-head h3 {
  margin: 0;
  color: #0f172a;
}

.recovery-summary,
.recovery-status,
.recovery-import p,
.recovery-setup-head p {
  margin: 0;
  color: #475569;
  line-height: 1.6;
  font-size: 13px;
}

.recovery-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(148, 163, 184, 0.16);
  color: #475569;
  font-size: 12px;
  font-weight: 700;
}

.recovery-pill[data-tone='success'] {
  background: #dcfce7;
  color: #166534;
}

.recovery-status[data-tone='success'] {
  color: #166534;
}

.recovery-status[data-tone='invalid'] {
  color: #991b1b;
}

.recovery-meta {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, max-content);
  margin: 0;
}

.recovery-meta dt {
  font-size: 12px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.recovery-meta dd {
  margin: 4px 0 0;
  color: #0f172a;
}

.recovery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.recovery-button {
  border: 1px solid #1d4ed8;
  border-radius: 999px;
  background: #1d4ed8;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  padding: 8px 14px;
}

.recovery-button.secondary {
  border-color: #cbd5e1;
  background: #fff;
  color: #0f172a;
}

.recovery-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.recovery-setup {
  display: grid;
  gap: 16px;
  padding: 18px;
  border-radius: 18px;
  background: rgba(15, 118, 110, 0.05);
  border: 1px solid rgba(15, 118, 110, 0.16);
}

.recovery-setup-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.recovery-mnemonic {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.recovery-mnemonic span {
  padding: 10px 12px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(148, 163, 184, 0.24);
  color: #0f172a;
  font-size: 13px;
  font-weight: 600;
}

.recovery-confirm-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.recovery-field {
  display: grid;
  gap: 8px;
}

.recovery-field span {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}

.recovery-field input,
.recovery-textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: #fff;
  color: #0f172a;
  font: inherit;
  padding: 10px 12px;
}

.recovery-import {
  display: grid;
  gap: 10px;
}

.recovery-import summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  color: #1e293b;
}

.recovery-textarea {
  min-height: 120px;
  resize: vertical;
}

@media (max-width: 900px) {
  .recovery-head,
  .recovery-setup-head,
  .recovery-confirm-grid,
  .recovery-meta {
    display: grid;
  }
}
</style>
