import { axiosInstance } from '@halo-dev/api-client'

import type { AuthorKeyResource, AuthorKeySpec } from '@/types/author-key'

const API_BASE = '/apis/privateposts.halo.run/v1alpha1/authorkeys'

export async function listAuthorKeys(): Promise<AuthorKeyResource[]> {
  const { data } = await axiosInstance.get<{ items?: AuthorKeyResource[] }>(API_BASE, {
    params: {
      page: 1,
      size: 200,
      sort: 'metadata.creationTimestamp,desc',
    },
  })

  return data.items ?? []
}

export async function listAuthorKeysByOwner(ownerName: string): Promise<AuthorKeyResource[]> {
  const items = await listAuthorKeys()
  return items.filter((item) => item.spec.ownerName === ownerName)
}

export async function upsertAuthorKey(resource: AuthorKeyResource): Promise<AuthorKeyResource> {
  try {
    const { data } = await axiosInstance.get<AuthorKeyResource>(`${API_BASE}/${resource.metadata.name}`)
    const nextResource: AuthorKeyResource = {
      ...resource,
      metadata: {
        ...resource.metadata,
        ...(data.metadata.version ? { version: data.metadata.version } : {}),
      },
    }
    const { data: updated } = await axiosInstance.put<AuthorKeyResource>(
      `${API_BASE}/${resource.metadata.name}`,
      nextResource
    )
    return updated
  } catch (error) {
    if (isNotFound(error)) {
      const { data } = await axiosInstance.post<AuthorKeyResource>(API_BASE, resource)
      return data
    }

    throw error
  }
}

export function buildAuthorKeyResource(spec: AuthorKeySpec): AuthorKeyResource {
  return {
    apiVersion: 'privateposts.halo.run/v1alpha1',
    kind: 'AuthorKey',
    metadata: {
      name: buildAuthorKeyResourceName(spec.fingerprint),
    },
    spec,
  }
}

function buildAuthorKeyResourceName(fingerprint: string): string {
  const normalized = fingerprint.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const suffix = normalized.slice(0, 32) || 'unknown'
  return `author-key-${suffix}`
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  return 'response' in error
    && typeof error.response === 'object'
    && error.response !== null
    && 'status' in error.response
    && error.response.status === 404
}
