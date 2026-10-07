import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { taskApi } from '../api/tasks'
import { useTaskDraft } from '../composables/useTaskDraft'

vi.mock('../api/tasks', () => ({
  taskApi: {
    list: vi.fn<typeof taskApi.list>(),
    stats: vi.fn<typeof taskApi.stats>(),
    get: vi.fn<typeof taskApi.get>(),
    create: vi.fn<typeof taskApi.create>(),
    patch: vi.fn<typeof taskApi.patch>(),
    remove: vi.fn<typeof taskApi.remove>(),
    changeStatus: vi.fn<typeof taskApi.changeStatus>(),
    bulkStatus: vi.fn<typeof taskApi.bulkStatus>(),
  },
}))

describe('useTaskDraft', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const draft = useTaskDraft()
    draft.clear()
    draft.setTarget(null)
    vi.clearAllMocks()
  })

  it('writes the supplied fields and never triggers a request (FR-S-03)', () => {
    useTaskDraft().applyAiDraft({
      taskId: null,
      fields: { title: 'Fix login redirect', priority: 'HIGH' },
      missing: [],
      appliedAt: 1,
    })

    expect(useTaskDraft().draft.value?.fields).toEqual({
      title: 'Fix login redirect',
      priority: 'HIGH',
    })
    // The regression guard: a draft must never create/update anything.
    expect(taskApi.create).not.toHaveBeenCalled()
    expect(taskApi.patch).not.toHaveBeenCalled()
    expect(taskApi.list).not.toHaveBeenCalled()
    expect(taskApi.stats).not.toHaveBeenCalled()
    expect(taskApi.changeStatus).not.toHaveBeenCalled()
  })

  it('keeps a user-edited field on a later draft and records it as kept', () => {
    const draft = useTaskDraft()
    draft.applyAiDraft({ taskId: null, fields: { title: 'AI title' }, missing: [], appliedAt: 1 })
    draft.noteUserEdit('title')

    draft.applyAiDraft({
      taskId: null,
      fields: { title: 'AI title v2', description: 'body' },
      missing: [],
      appliedAt: 2,
    })

    expect(draft.draft.value?.fields.title).toBe('AI title')
    expect(draft.draft.value?.fields.description).toBe('body')
    expect(draft.isAiSupplied('title')).toBe(false)
    expect(
      draft.draft.value?.missing.some((entry) => entry.includes('title') && entry.includes('kept')),
    ).toBe(true)
  })

  it('reports AI provenance and drops it on clear', () => {
    const draft = useTaskDraft()
    draft.applyAiDraft({
      taskId: null,
      fields: { title: 'From the agent' },
      missing: [],
      appliedAt: 1,
    })

    expect(draft.isAiSupplied('title')).toBe(true)

    draft.clear()

    expect(draft.isAiSupplied('title')).toBe(false)
    expect(draft.draft.value).toBeNull()
  })

  it('ignores a draft addressed to a different task', () => {
    const draft = useTaskDraft()
    draft.setTarget('b')

    draft.applyAiDraft({ taskId: 'a', fields: { title: 'Other task' }, missing: [], appliedAt: 1 })

    expect(draft.draft.value).toBeNull()
  })

  it('accepts a draft for the create form (taskId null)', () => {
    const draft = useTaskDraft()
    draft.setTarget(null)

    draft.applyAiDraft({ taskId: null, fields: { priority: 'URGENT' }, missing: [], appliedAt: 1 })

    expect(draft.draft.value?.fields.priority).toBe('URGENT')
  })

  it('is a singleton shared by every caller', () => {
    useTaskDraft().applyAiDraft({
      taskId: null,
      fields: { priority: 'LOW' },
      missing: [],
      appliedAt: 1,
    })

    expect(useTaskDraft().draft.value?.fields.priority).toBe('LOW')
    expect(useTaskDraft().hasDraft.value).toBe(true)
  })
})
