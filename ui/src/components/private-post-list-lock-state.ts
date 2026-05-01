import { parseBundleJson } from '@/utils/private-post-crypto'

export interface PrivatePostListLockStateInput {
  sourceAnnotationsPresent: boolean
  sourceBundleText?: string | null
  registryLoaded: boolean
  registryHasPrivatePost: boolean
}

export interface PrivatePostListLockState {
  resolved: boolean
  locked: boolean
}

export function resolvePrivatePostListLockState(
  input: PrivatePostListLockStateInput
): PrivatePostListLockState {
  const sourceLockState = resolveSourceLockState(input.sourceAnnotationsPresent, input.sourceBundleText)
  if (sourceLockState !== null) {
    return {
      resolved: true,
      locked: sourceLockState,
    }
  }

  if (!input.registryLoaded) {
    return {
      resolved: false,
      locked: false,
    }
  }

  return {
    resolved: true,
    locked: input.registryHasPrivatePost,
  }
}

function resolveSourceLockState(
  sourceAnnotationsPresent: boolean,
  sourceBundleText?: string | null
): boolean | null {
  if (!sourceAnnotationsPresent) {
    return null
  }

  const normalizedBundleText = sourceBundleText?.trim() ?? ''
  if (!normalizedBundleText) {
    return false
  }

  try {
    parseBundleJson(normalizedBundleText)
    return true
  } catch {
    return false
  }
}
