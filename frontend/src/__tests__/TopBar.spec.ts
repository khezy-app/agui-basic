import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import TopBar from '../components/layout/TopBar.vue'
import { routes } from '../router'

let router: Router
let wrapper: VueWrapper | undefined

async function mountTopBar(path = '/') {
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()

  wrapper = mount(TopBar, { global: { plugins: [router] } })
  await flushPromises()

  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
})

describe('TopBar search (OPEN-12)', () => {
  it('navigates to /tasks with the trimmed q on submit', async () => {
    const view = await mountTopBar('/')

    await view.get('.task-search').setValue('  flaky test ')
    await view.get('form').trigger('submit')
    // The target route is lazy-loaded, so the navigation resolves a tick after the push.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('tasks'))

    expect(router.currentRoute.value.query.q).toBe('flaky test')
  })

  it('preserves existing filters when already on the task list', async () => {
    const view = await mountTopBar('/tasks?status=TODO')

    await view.get('.task-search').setValue('flaky')
    await view.get('form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.query).toMatchObject({ status: 'TODO', q: 'flaky' })
  })

  it('clears q with the clear button, keeping other filters', async () => {
    const view = await mountTopBar('/tasks?status=TODO&q=flaky')

    await view.get('.task-search-clear').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.q).toBeUndefined()
    expect(router.currentRoute.value.query.status).toBe('TODO')
  })
})
