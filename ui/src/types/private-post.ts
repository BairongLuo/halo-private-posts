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

export interface SiteRecoverySlot {
  kid: string
  alg: string
  wrapped_cek: string
}

export interface SiteRecoveryPublicKey {
  kid: string
  alg: string
  publicKey: string
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
  site_recovery_slot: SiteRecoverySlot
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
  deletionTimestamp?: string
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

export type PrivatePostPayloadFormat = 'markdown' | 'html'

export interface DecryptedPrivatePostDocument {
  metadata: BundleMetadata
  payload_format: PrivatePostPayloadFormat
  content: string
}

export interface SiteRecoveryResetRequest {
  postName: string
  nextPassword: string
}

export interface SiteRecoveryRefreshRequest {
  postName: string
  payloadFormat?: string
  content?: string
  metadata?: BundleMetadata
}
