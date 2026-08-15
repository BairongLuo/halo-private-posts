<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { axiosInstance } from '@halo-dev/api-client'

import {
  findPasswordConfigField,
  readPasswordConfigField,
  writePasswordConfigField,
} from '../annotation-field'
import { installOfficialSaveInterceptor } from '../official-save-interceptor'

const props = defineProps<{
  mountSelector: string
}>()

const HASH_API = '/apis/console.api.privateposts.halo.run/v1alpha1/hide-password/hash'
const FORMKIT_SETTLE_DELAY_MS = 30

const target = ref<HTMLElement | null>(null)
const password = ref('')
const configured = ref(false)
const busy = ref(false)
const message = ref('')
const error = ref('')
const pendingAction = ref<'none' | 'set' | 'clear'>('none')

const stateText = computed(() => {
  if (pendingAction.value === 'clear') {
    return '等待保存后清除'
  }
  if (pendingAction.value === 'set') {
    return configured.value ? '等待保存后更新密码' : '等待保存后设置密码'
  }
  return configured.value ? '已设置密码' : '未设置密码'
})

let observer: MutationObserver | null = null
let currentConfigField: HTMLInputElement | null = null
let uninstallSaveInterceptor: (() => void) | null = null

watch(password, (value) => {
  if (value.trim()) {
    pendingAction.value = 'set'
    message.value = '新密码将在点击设置窗口底部的「保存」时生效'
  } else if (pendingAction.value === 'set') {
    pendingAction.value = 'none'
    message.value = ''
  }
  error.value = ''
})

onMounted(() => {
  refresh()
  uninstallSaveInterceptor = installOfficialSaveInterceptor(
    () => pendingAction.value !== 'none',
    preparePasswordForOfficialSave,
  )
  observer = new MutationObserver(refresh)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
  uninstallSaveInterceptor?.()
  uninstallSaveInterceptor = null
})

function refresh() {
  target.value = document.querySelector<HTMLElement>(props.mountSelector)
  const field = findPasswordConfigField()
  if (field !== currentConfigField) {
    currentConfigField = field
    password.value = ''
    pendingAction.value = 'none'
    message.value = ''
    error.value = ''
  }
  configured.value = Boolean(readPasswordConfigField())
}

async function preparePasswordForOfficialSave(): Promise<boolean> {
  busy.value = true
  error.value = ''
  message.value = '正在准备密码配置…'

  try {
    if (pendingAction.value === 'set') {
      const newPassword = password.value.trim()
      if (!newPassword) {
        throw new Error('请输入新密码')
      }
      if (newPassword.length > 256) {
        throw new Error('访问密码不能超过 256 个字符')
      }

      const { data } = await axiosInstance.post<{ config?: string }>(HASH_API, {
        password: newPassword,
      })
      if (!data.config || !writePasswordConfigField(data.config)) {
        throw new Error('无法写入 Halo 文章设置表单')
      }
      configured.value = true
    } else if (pendingAction.value === 'clear') {
      if (!writePasswordConfigField('')) {
        throw new Error('无法写入 Halo 文章设置表单')
      }
      configured.value = false
    }

    // Halo 2.24 的 AnnotationsForm 会在保存时立刻检查 FormKit 状态。
    // 即使 schema 已配置 delay: 0，也留出一个宏任务确保响应式状态完成提交。
    await new Promise((resolve) => setTimeout(resolve, FORMKIT_SETTLE_DELAY_MS))

    password.value = ''
    pendingAction.value = 'none'
    message.value = '密码配置已加入本次保存'
    return true
  } catch (err) {
    error.value = toMessage(err)
    message.value = ''
    return false
  } finally {
    busy.value = false
  }
}

function toggleClearPassword() {
  error.value = ''
  if (pendingAction.value === 'clear') {
    pendingAction.value = 'none'
    message.value = ''
  } else {
    password.value = ''
    pendingAction.value = 'clear'
    message.value = '密码将在点击设置窗口底部的「保存」时清除'
  }
}

function toMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const response = err.response
    if (typeof response === 'object' && response !== null && 'data' in response) {
      const data = response.data
      if (typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') {
        return data.message
      }
    }
  }
  if (err instanceof Error && err.message) {
    return err.message
  }
  if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
    return err.message
  }
  return '操作失败'
}
</script>

<template>
  <Teleport :to="target" :disabled="!target">
    <div class="hpp-hide-password-panel">
      <p class="hpp-hide-password-desc">
        设置访问密码后，正文里
        <code>[hide-password]...[/hide-password]</code>
        标记之间的内容将对访客隐藏，输入密码后可见。
      </p>

      <p class="hpp-hide-password-state">
        当前状态：{{ stateText }}
      </p>

      <input
        v-model="password"
        class="hpp-hide-password-input"
        type="password"
        autocomplete="new-password"
        maxlength="256"
        :disabled="busy"
        placeholder="输入新密码，随文章设置一起保存"
      >

      <div v-if="configured || pendingAction === 'clear'" class="hpp-hide-password-actions">
        <button
          class="hpp-hide-password-button hpp-hide-password-button--danger"
          type="button"
          :disabled="busy"
          @click="toggleClearPassword"
        >
          {{ pendingAction === 'clear' ? '取消清除' : '清除密码' }}
        </button>
      </div>

      <p v-if="message" class="hpp-hide-password-message hpp-hide-password-message--success">
        {{ message }}
      </p>
      <p v-if="error" class="hpp-hide-password-message hpp-hide-password-message--error">
        {{ error }}
      </p>
    </div>
  </Teleport>
</template>

<style scoped>
.hpp-hide-password-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0;
}

.hpp-hide-password-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-secondary, #666);
}

.hpp-hide-password-desc code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--color-fill-tertiary, #f3f4f6);
}

.hpp-hide-password-state {
  margin: 0;
  font-size: 13px;
}

.hpp-hide-password-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 6px;
  font-size: 14px;
  background: var(--color-fill, #fff);
}

.hpp-hide-password-actions {
  display: flex;
  gap: 8px;
}

.hpp-hide-password-button {
  padding: 6px 14px;
  border: 1px solid var(--color-primary, #2563eb);
  border-radius: 6px;
  background: var(--color-primary, #2563eb);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}

.hpp-hide-password-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.hpp-hide-password-button--danger {
  border-color: var(--color-danger, #dc2626);
  background: var(--color-danger, #dc2626);
}

.hpp-hide-password-message {
  margin: 0;
  font-size: 13px;
}

.hpp-hide-password-message--success {
  color: var(--color-success, #16a34a);
}

.hpp-hide-password-message--error {
  color: var(--color-danger, #dc2626);
}
</style>
