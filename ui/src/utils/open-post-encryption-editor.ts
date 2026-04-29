export function openPostEncryptionEditor(postName: string): void {
  if (typeof window === 'undefined' || !postName) {
    return
  }

  const nextUrl = new URL('/console/posts/editor', window.location.origin)
  nextUrl.searchParams.set('name', postName)
  nextUrl.searchParams.set('hppOpenEncryption', '1')
  window.location.assign(nextUrl.toString())
}
