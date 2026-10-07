import { beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import TranscriptView from '@/components/cowork/TranscriptView.vue'
import { routes } from '@/router'
import { useCoworkStore } from '@/stores/cowork'
import type { AssistantItem, TranscriptItem, TranscriptState } from '@/agui/transcript'

function assistant(overrides: Partial<AssistantItem> = {}): AssistantItem {
  return {
    kind: 'assistant',
    id: 'a1',
    content: '',
    reasoning: '',
    toolCalls: [],
    createdAt: 1_760_000_000_000,
    streaming: false,
    ...overrides,
  }
}

function transcript(items: TranscriptItem[]): TranscriptState {
  return {
    items,
    runId: 'r1',
    threadId: 'th1',
    runOutcome: 'none',
    interrupts: [],
    lastToolCallIdsWithoutResult: [],
  }
}

let store: ReturnType<typeof useCoworkStore>

async function mountView(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  store = useCoworkStore()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.isReady()
  return mount(TranscriptView, { global: { plugins: [pinia, router] } })
}

beforeEach(() => {
  localStorage.clear()
})

describe('TranscriptView items', () => {
  it('renders user, assistant, error and notice items with their expected roles', async () => {
    const wrapper = await mountView()
    store.transcript = transcript([
      { kind: 'user', id: 'u1', content: 'Hi there', createdAt: 1 },
      assistant({ id: 'a1', content: 'Working on it' }),
      { kind: 'error', id: 'e1', message: 'Run failed', code: 'run_error', createdAt: 2 },
      { kind: 'notice', id: 'n1', text: 'Stopped', createdAt: 3 },
    ])
    await nextTick()

    expect(wrapper.get('[data-item-id="u1"]').text()).toContain('Hi there')
    expect(wrapper.get('[data-item-id="u1"]').classes()).toContain('user')
    expect(wrapper.get('[data-item-id="a1"]').text()).toContain('Working on it')
    expect(wrapper.get('[data-item-id="a1"]').classes()).toContain('assistant')

    const error = wrapper.get('[data-item-id="e1"]')
    expect(error.find('[role="alert"]').text()).toContain('Run failed')

    expect(wrapper.get('[data-item-id="n1"]').classes()).toContain('notice')
    expect(wrapper.get('[data-item-id="n1"]').text()).toBe('Stopped')

    // The transcript is an aria-live log, never assertive.
    const log = wrapper.get('[role="log"]')
    expect(log.attributes('aria-live')).toBe('polite')
  })

  it('keeps the same DOM node as streaming content grows', async () => {
    const wrapper = await mountView()
    store.transcript = transcript([assistant({ id: 'a1', content: 'Hel', streaming: true })])
    await nextTick()

    const node = wrapper.get('[data-item-id="a1"]').element

    store.transcript = transcript([
      assistant({ id: 'a1', content: 'Hello world', streaming: true }),
    ])
    await nextTick()

    expect(wrapper.get('[data-item-id="a1"]').element).toBe(node)
    expect(wrapper.get('[data-item-id="a1"]').text()).toContain('Hello world')
  })

  it('renders reasoning collapsed and distinct from the answer (FR-AI-26)', async () => {
    const wrapper = await mountView()
    store.transcript = transcript([
      assistant({ id: 'a1', reasoning: 'The user wants overdue tasks', content: 'Here they are' }),
    ])
    await nextTick()

    const details = wrapper.get('details.reasoning')
    expect(details.attributes('open')).toBeUndefined()
    expect(details.text()).toContain('Thought process')
    expect(details.text()).toContain('The user wants overdue tasks')
    // The answer lives outside the reasoning block.
    expect(wrapper.get('.answer').text()).toContain('Here they are')
    expect(wrapper.get('.answer').text()).not.toContain('The user wants overdue tasks')
  })
})

describe('TranscriptView autoscroll', () => {
  it('suppresses autoscroll when scrolled up and offers Jump to latest', async () => {
    const wrapper = await mountView()
    store.transcript = transcript([assistant({ id: 'a1', content: 'one' })])
    await nextTick()

    const scroller = wrapper.get('.transcript').element as HTMLElement
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true })
    scroller.scrollTop = 0
    await wrapper.get('.transcript').trigger('scroll')

    store.transcript = transcript([
      assistant({ id: 'a1', content: 'one' }),
      assistant({ id: 'a2', content: 'two' }),
    ])
    await nextTick()
    await nextTick()

    expect(wrapper.find('.jump').exists()).toBe(true)
    expect(scroller.scrollTop).toBe(0)
  })
})
