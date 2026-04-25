import { createApp } from 'vue'

import PrivatePostAnnotationTool from './PrivatePostAnnotationTool.vue'

const TOOL_SELECTOR = '[data-hpp-annotation-tool]'

let installed = false

export function installPrivatePostAnnotationTool(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  installed = true

  const mountAll = () => {
    document.querySelectorAll<HTMLElement>(TOOL_SELECTOR).forEach((container) => {
      if (container.dataset.hppMounted === 'true') {
        return
      }

      const bundleFieldId = container.dataset.bundleFieldId ?? 'hpp-annotation-bundle'

      createApp(PrivatePostAnnotationTool, {
        bundleFieldId,
      }).mount(container)

      container.dataset.hppMounted = 'true'
    })
  }

  mountAll()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll, { once: true })
  }

  const observer = new MutationObserver(() => {
    mountAll()
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}
