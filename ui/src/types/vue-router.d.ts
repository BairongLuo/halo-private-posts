declare module 'vue-router' {
  export interface RouteLocationNormalizedLoaded {
    query: Record<string, unknown>
  }

  export interface Router {
    push(to: {
      name?: string
      path?: string
      query?: Record<string, unknown>
    }): Promise<void>
    replace(to: {
      name?: string
      path?: string
      query?: Record<string, unknown>
    }): Promise<void>
  }

  export function useRoute(): RouteLocationNormalizedLoaded
  export function useRouter(): Router
}
