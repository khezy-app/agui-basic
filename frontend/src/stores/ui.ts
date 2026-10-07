import { ref } from 'vue'
import { defineStore } from 'pinia'

export type ToastKind = 'info' | 'success' | 'error'

export type Toast = {
  id: string
  kind: ToastKind
  title: string
  detail?: string
  /**
   * Set when the failure has a user-facing retry path (a version conflict, a forceable
   * delete, …). The toast region only renders `title`/`detail` today; the flag is
   * carried so the retry affordance can be added without re-reporting the error.
   */
  retryable?: boolean
}

const MAX_VISIBLE = 3
const AUTO_DISMISS_MS = 6000

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function dismissToast(id: string) {
    const timer = timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(id)
    }
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  function pushToast(toast: Omit<Toast, 'id'>) {
    const id = crypto.randomUUID()
    toasts.value.push({ ...toast, id })

    const overflow = toasts.value.length - MAX_VISIBLE
    if (overflow > 0) {
      toasts.value.slice(0, overflow).forEach((entry) => dismissToast(entry.id))
    }

    // Errors stay until the user dismisses them; info/success fade out.
    if (toast.kind !== 'error') {
      timers.set(
        id,
        setTimeout(() => dismissToast(id), AUTO_DISMISS_MS),
      )
    }
  }

  return { toasts, pushToast, dismissToast }
})
