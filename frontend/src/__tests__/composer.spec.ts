import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import Composer from '@/components/cowork/CoworkComposer.vue'
import { useCoworkStore } from '@/stores/cowork'
import type { PendingApproval } from '@/agui/resume'

let store: ReturnType<typeof useCoworkStore>

function mountComposer(): VueWrapper {
  const pinia = createPinia()
  setActivePinia(pinia)
  store = useCoworkStore()
  return mount(Composer, { global: { plugins: [pinia] } })
}

function makeApproval(): PendingApproval {
  return {
    interruptId: 'i1',
    toolCallId: 'c1',
    messageId: 'm1',
    tool: 'update_task_status',
    args: {},
    summary: 'Move a task',
    reason: '',
    createdAt: 1,
    status: 'pending',
    error: null,
    restored: false,
    tasks: null,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('Composer', () => {
  it('sends on Enter and not on Shift+Enter, disabled while empty', async () => {
    const wrapper = mountComposer()
    const send = vi.spyOn(store, 'send').mockResolvedValue()

    expect(wrapper.get('.send').attributes('disabled')).toBeDefined()

    await wrapper.get('textarea').setValue('hello')
    expect(wrapper.get('.send').attributes('disabled')).toBeUndefined()

    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(send).not.toHaveBeenCalled()

    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('hello')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('offers the three starter prompts that only fill the box', async () => {
    const wrapper = mountComposer()
    const send = vi.spyOn(store, 'send').mockResolvedValue()

    const suggestions = wrapper.findAll('.suggestion')
    expect(suggestions).toHaveLength(3)

    await suggestions[0]!.trigger('click')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(
      "What's overdue and blocked?",
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('queues while running — one call, never a second request (FR-AI-25)', async () => {
    const wrapper = mountComposer()
    const send = vi.spyOn(store, 'send').mockResolvedValue()
    store.phase = 'streaming'

    await wrapper.get('textarea').setValue('queued request')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('queued request')
    // A stop button replaces send while a run is in flight.
    expect(wrapper.find('.send').exists()).toBe(false)
    expect(wrapper.find('.stop').exists()).toBe(true)

    store.queuedMessage = 'queued request'
    await nextTick()
    expect(wrapper.get('.hint').text()).toContain('Queued: queued request')
  })

  it('stops the run and reflects the stopped phase (FR-AI-24)', async () => {
    const wrapper = mountComposer()
    store.phase = 'streaming'
    const stop = vi.spyOn(store, 'stop')
    await nextTick()

    await wrapper.get('.stop').trigger('click')

    expect(stop).toHaveBeenCalledTimes(1)
    expect(store.phase).toBe('stopped')
  })

  it('is disabled with a hint while an approval card is open', async () => {
    const wrapper = mountComposer()
    store.approvalQueue = [makeApproval()]
    await nextTick()

    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.hint').text()).toBe('Answer the question above to continue')
    expect(wrapper.get('.send').attributes('disabled')).toBeDefined()
  })
})
