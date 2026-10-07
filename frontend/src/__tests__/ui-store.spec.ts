import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useUiStore } from '../stores/ui'

describe('useUiStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps at most three visible toasts, dropping the oldest', () => {
    const ui = useUiStore()

    ui.pushToast({ kind: 'error', title: 'one' })
    ui.pushToast({ kind: 'error', title: 'two' })
    ui.pushToast({ kind: 'error', title: 'three' })
    ui.pushToast({ kind: 'error', title: 'four' })

    expect(ui.toasts).toHaveLength(3)
    expect(ui.toasts.map((toast) => toast.title)).toEqual(['two', 'three', 'four'])
  })

  it('auto-dismisses success and info toasts after 6s', () => {
    const ui = useUiStore()

    ui.pushToast({ kind: 'success', title: 'saved' })
    ui.pushToast({ kind: 'info', title: 'note' })
    expect(ui.toasts).toHaveLength(2)

    vi.advanceTimersByTime(6000)

    expect(ui.toasts).toHaveLength(0)
  })

  it('never auto-dismisses error toasts', () => {
    const ui = useUiStore()

    ui.pushToast({ kind: 'error', title: 'boom' })
    vi.advanceTimersByTime(60000)

    expect(ui.toasts).toHaveLength(1)
  })

  it('dismisses a toast by id immediately', () => {
    const ui = useUiStore()

    ui.pushToast({ kind: 'error', title: 'boom' })
    ui.toasts.slice().forEach((toast) => ui.dismissToast(toast.id))

    expect(ui.toasts).toHaveLength(0)
  })
})
