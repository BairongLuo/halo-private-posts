import type { Content } from '@halo-dev/api-client'

export class LatestContentCache {
  private readonly items = new Map<string, Content>()

  remember(postName: string, content: Content): void {
    if (!postName || !hasContentPayload(content)) {
      return
    }

    this.items.set(postName, cloneContent(content))
  }

  read(postName: string): Content | null {
    const content = this.items.get(postName)
    return content ? cloneContent(content) : null
  }
}

function hasContentPayload(content: Content): boolean {
  return Boolean(content.raw?.trim() || content.content?.trim())
}

function cloneContent(content: Content): Content {
  return {
    raw: content.raw ?? '',
    content: content.content ?? '',
    rawType: content.rawType ?? '',
  } as Content
}
