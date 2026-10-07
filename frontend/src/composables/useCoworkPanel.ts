import { ref, watch } from 'vue'

/**
 * The AI Cowork panel's docked/closed state.
 *
 * This is UI chrome, not shared agent state, so it lives in `localStorage` — the
 * deliberate exception the spec calls out (FE-13 §4.1, contrast OPEN-10).
 */
const STORAGE_KEY = 'agui.panelOpen'

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    // Storage can be unavailable (private mode, quota); closed is the safe default.
    return false
  }
}

const open = ref(readOpen())
let persisting = false

export function useCoworkPanel() {
  if (!persisting) {
    persisting = true
    watch(open, (value) => {
      try {
        localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false')
      } catch {
        // Non-fatal: the panel still works, it just will not be remembered.
      }
    })
  }

  return {
    open,
    toggle: () => {
      open.value = !open.value
    },
    setOpen: (value: boolean) => {
      open.value = value
    },
    close: () => {
      open.value = false
    },
  }
}
