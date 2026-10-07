import { ref } from 'vue'

export type ConfirmOptions = {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
}

/**
 * Confirmation dialog state. Module-level (a singleton) on purpose: every caller shares
 * the one `<ConfirmDialog>` host rendered by `AppShell`, so `confirm()` resolves the
 * promise when the user answers the shared dialog.
 */
const state = ref<ConfirmOptions | null>(null)
let resolvePending: ((confirmed: boolean) => void) | null = null

function confirm(options: ConfirmOptions): Promise<boolean> {
  state.value = options
  return new Promise<boolean>((resolve) => {
    resolvePending = resolve
  })
}

/** Resolves the open dialog (true = confirm) and closes it. No-op when none is open. */
function settleConfirm(confirmed: boolean) {
  resolvePending?.(confirmed)
  resolvePending = null
  state.value = null
}

export function useConfirm() {
  return { state, confirm, settleConfirm }
}
