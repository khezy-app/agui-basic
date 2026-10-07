import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { routes } from '../router'

const router = createRouter({ history: createMemoryHistory(), routes })

describe('router', () => {
  it('resolves /tasks/new as task-new, not task-detail (route order guard)', () => {
    expect(router.resolve('/tasks/new').name).toBe('task-new')
  })

  it('gives every declared route a meta.title', () => {
    for (const route of routes) {
      expect(route.meta?.title, `${String(route.path)} is missing meta.title`).toBeTruthy()
    }
  })

  it('resolves /tasks/abc to task-detail and passes the id as a prop', () => {
    const resolved = router.resolve('/tasks/abc')

    expect(resolved.name).toBe('task-detail')
    expect(resolved.params.id).toBe('abc')
    expect(resolved.matched[0]?.props.default).toBe(true)
  })

  it('resolves /tasks/abc/edit to task-edit', () => {
    expect(router.resolve('/tasks/abc/edit').name).toBe('task-edit')
  })

  it('falls back to not-found for unknown paths', () => {
    expect(router.resolve('/does/not/exist').name).toBe('not-found')
  })
})
