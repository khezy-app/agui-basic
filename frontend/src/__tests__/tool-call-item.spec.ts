import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ToolCallItemView from '@/components/cowork/ToolCallItem.vue'
import type { ToolCallItem } from '@/agui/transcript'

function toolCall(overrides: Partial<ToolCallItem> = {}): ToolCallItem {
  return {
    id: 'c1',
    name: 'query_tasks',
    parentMessageId: 'a1',
    argsText: '{"q":"overdue"}',
    args: { q: 'overdue' },
    state: 'done',
    resultContent: 'found 2 tasks',
    resultError: null,
    resultMessageId: 'm1',
    metadata: null,
    interruptId: null,
    ...overrides,
  }
}

describe('ToolCallItem (FR-AI-08)', () => {
  it('shows the tool name always, even with no arguments yet', () => {
    const wrapper = mount(ToolCallItemView, {
      props: {
        call: toolCall({ name: 'update_task_status', args: undefined, state: 'streaming-args' }),
      },
    })

    expect(wrapper.get('.name').text()).toBe('update_task_status')
  })

  it('renders parsed arguments as JSON after expanding', async () => {
    const wrapper = mount(ToolCallItemView, { props: { call: toolCall() } })

    expect(wrapper.find('.args').exists()).toBe(false)
    await wrapper.get('.toggle').trigger('click')

    expect(wrapper.get('.args').text()).toContain('"q"')
    expect(wrapper.get('.args').text()).toContain('overdue')
  })

  it('renders unparsed arguments as raw text with a receiving label, without crashing (FR-AI-27)', async () => {
    const wrapper = mount(ToolCallItemView, {
      props: {
        call: toolCall({
          argsText: '{"q": "ov',
          args: undefined,
          state: 'streaming-args',
          resultContent: null,
          resultMessageId: null,
        }),
      },
    })

    await wrapper.get('.toggle').trigger('click')

    expect(wrapper.get('.receiving').text()).toContain('receiving arguments…')
    expect(wrapper.get('.args').text()).toContain('{"q": "ov')
  })

  it('maps call state to the running/done/failed/awaiting-approval badge', () => {
    const cases: [Partial<ToolCallItem>, string][] = [
      [{ state: 'streaming-args' }, 'running…'],
      [{ state: 'awaiting-result' }, 'running…'],
      [{ state: 'done' }, 'done'],
      [{ state: 'error', resultError: 'boom' }, 'failed'],
      [{ state: 'awaiting-result', interruptId: 'i1' }, 'awaiting approval'],
    ]

    for (const [overrides, label] of cases) {
      const wrapper = mount(ToolCallItemView, { props: { call: toolCall(overrides) } })
      expect(wrapper.get('.badge').text()).toBe(label)
    }
  })

  it('renders a result error in red and links to the card it produced', () => {
    const wrapper = mount(ToolCallItemView, {
      props: {
        call: toolCall({ name: 'update_task_status', state: 'error', resultError: 'rejected' }),
        cardHref: '#card-status-change',
      },
    })

    expect(wrapper.get('.result-error').text()).toBe('rejected')
    const link = wrapper.get('a.card-link')
    expect(link.text()).toContain('view confirmation')
    expect(link.attributes('href')).toBe('#card-status-change')
  })
})
