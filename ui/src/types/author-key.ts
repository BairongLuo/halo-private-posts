export interface AuthorKeySpec {
  ownerName: string
  displayName: string
  fingerprint: string
  algorithm: string
  publicKey: string
  createdAt: string
}

export interface AuthorKeyMetadata {
  name: string
  version?: number
  creationTimestamp?: string
}

export interface AuthorKeyResource {
  apiVersion: 'privateposts.halo.run/v1alpha1'
  kind: 'AuthorKey'
  metadata: AuthorKeyMetadata
  spec: AuthorKeySpec
}

export interface AuthorKeyList {
  items?: AuthorKeyResource[]
  total?: number
}

export interface LocalAuthorKeyRecord {
  ownerName: string
  displayName: string
  fingerprint: string
  algorithm: string
  publicKey: JsonWebKey
  privateKey: JsonWebKey
  createdAt: string
}

export interface AuthorKeyRecipient {
  keyId: string
  algorithm: string
  publicKey: JsonWebKey
}
