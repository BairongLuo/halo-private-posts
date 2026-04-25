import { consoleApiClient } from '@halo-dev/api-client'

export async function getCurrentHaloUserName(): Promise<string> {
  const { data } = await consoleApiClient.user.getCurrentUserDetail()
  return data.user.metadata.name
}
