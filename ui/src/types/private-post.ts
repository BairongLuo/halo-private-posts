export interface BundleMetadata {
  slug: string
  title: string
  excerpt?: string
  published_at?: string
}

export interface PasswordSlot {
  kdf: string
  salt: string
  wrap_iv: string
  wrapped_cek: string
  auth_tag: string
}

export interface RecoverySlot {
  scheme: string
  wrap_alg: string
  wrap_iv: string
  wrapped_cek: string
  auth_tag: string
}

export interface EncryptedPrivatePostBundle {
  version: number
  payload_format: string
  cipher: string
  kdf: string
  data_iv: string
  ciphertext: string
  auth_tag: string
  password_slot: PasswordSlot
  recovery_slot: RecoverySlot
  metadata: BundleMetadata
}

export interface PrivatePostSpec {
  postName: string
  slug: string
  title: string
  excerpt?: string
  publishedAt?: string
  bundle: EncryptedPrivatePostBundle
}

export interface Metadata {
  name: string
  version?: number
  creationTimestamp?: string
}

export interface PrivatePost {
  apiVersion: 'privateposts.halo.run/v1alpha1'
  kind: 'PrivatePost'
  metadata: Metadata
  spec: PrivatePostSpec
}

export interface PrivatePostList {
  items: PrivatePost[]
  total: number
}

export interface PrivatePostView {
  resourceName: string
  postName: string
  slug: string
  title: string
  excerpt: string
  publishedAt: string
  readerUrl: string
  bundleUrl: string
  bundle: EncryptedPrivatePostBundle
}

export interface DecryptedPrivatePostDocument {
  metadata: BundleMetadata
  markdown: string
}
