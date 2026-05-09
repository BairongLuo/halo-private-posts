import type { HaloPostSummary } from '@/api/posts'
import type { PrivatePost } from '@/types/private-post'

export function readQueryString(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }

  return typeof value === 'string' ? value : ''
}

export function formatTimestamp(value?: string): string {
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

export function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

export function resolveSelectedArticleTitle(
  selectedPost: HaloPostSummary | null,
  selectedPostMapping: PrivatePost | null,
  routePostName: string
): string {
  return selectedPost?.title || selectedPostMapping?.spec.title || routePostName
}

export function resolveSelectedArticleSlug(
  selectedPost: HaloPostSummary | null,
  selectedPostMapping: PrivatePost | null
): string {
  return selectedPost?.slug || selectedPostMapping?.spec.slug || ''
}

export function resolveSiteRecoveryAvailability(
  routePostName: string,
  selectedPostMapping: PrivatePost | null
): string {
  if (!routePostName) {
    return '先从列表选中一篇文章。'
  }

  if (!selectedPostMapping) {
    return '当前文章还没有同步出私密正文。'
  }

  if (selectedPostMapping.spec.bundle.site_recovery_slot) {
    return '输入新口令后，平台会直接重写 password slot。'
  }

  return '当前文章缺少有效的平台恢复槽。请重新加锁后再使用平台恢复。'
}

export function canResetWithSiteRecovery(
  selectedPostMapping: PrivatePost | null,
  nextPassword: string,
  confirmNextPassword: string
): boolean {
  return Boolean(
    selectedPostMapping
      && selectedPostMapping.spec.bundle.site_recovery_slot
      && nextPassword.trim()
      && confirmNextPassword.trim()
  )
}
