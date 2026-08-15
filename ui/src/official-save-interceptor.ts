export const POST_SETTING_FORM_ID = 'post-setting-form'

/**
 * 在 Halo 官方文章设置表单提交前完成异步准备，然后恢复原本的提交。
 * 没有待处理密码时完全不干预官方保存链路。
 */
export function installOfficialSaveInterceptor(
  shouldPrepare: () => boolean,
  prepare: () => Promise<boolean>,
): () => void {
  let preparing = false
  let resumeNextSubmit = false

  const handleSubmit = (event: SubmitEvent) => {
    const form = event.target
    if (!(form instanceof HTMLFormElement) || form.id !== POST_SETTING_FORM_ID) {
      return
    }

    if (resumeNextSubmit) {
      resumeNextSubmit = false
      return
    }

    if (!shouldPrepare()) {
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    if (preparing) {
      return
    }

    preparing = true
    void prepare()
      .then((prepared) => {
        if (!prepared || !form.isConnected) {
          return
        }
        resumeNextSubmit = true
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
      })
      .catch(() => undefined)
      .finally(() => {
        preparing = false
      })
  }

  document.addEventListener('submit', handleSubmit, true)
  return () => document.removeEventListener('submit', handleSubmit, true)
}
