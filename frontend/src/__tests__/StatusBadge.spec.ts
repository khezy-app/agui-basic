import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import StatusBadge from '../components/task/StatusBadge.vue'
import { STATUS_LABEL, TASK_STATUSES } from '../domain/task'

describe('StatusBadge', () => {
  it.each(TASK_STATUSES)('renders the %s label with its CSS class', (status) => {
    const wrapper = mount(StatusBadge, { props: { status } })

    expect(wrapper.text()).toBe(STATUS_LABEL[status])
    expect(wrapper.classes()).toContain(`status-${status.toLowerCase().replace(/_/g, '-')}`)
  })

  it('falls back to the raw value for an unknown status', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'WEIRD' } })

    expect(wrapper.text()).toBe('WEIRD')
    expect(wrapper.classes()).toContain('status-unknown')
  })
})
