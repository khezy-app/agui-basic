import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import type { Router } from 'vue-router'

import { prefillTaskForm } from '@/agui/handlers'
import type { ToolHandlerResult } from '@/agui/handlers'
import { useTaskDraft } from '@/composables/useTaskDraft'
import { useCoworkStore } from '@/stores/cowork'
import { useTeamStore } from '@/stores/team'
import { TEAM_MEMBERS } from './fixtures'

const { routerRef } = vi.hoisted(() => ({ routerRef: { current: null as Router | null } }))

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return { ...actual, useRouter: () => routerRef.current }
})

const CALL = { id: 'c1', messageId: 'm1' }

function makeRouter(initialPath: string): Router {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: { template: '<div />' } },
      { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
      { path: '/tasks/new', name: 'task-new', component: { template: '<div />' } },
      { path: '/tasks/:id/edit', name: 'task-edit', component: { template: '<div />' } },
    ],
  })
  router.push(initialPath)
  return router
}

function stubFetch(): Mock {
  const fetchMock = vi.fn<() => Promise<unknown>>().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => '{}',
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Asserts the call failed and narrows the union so `error` can be read. */
function failureOf(result: ToolHandlerResult): string {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected a failure')
  return result.error
}

/** `missing` entries are field names, so the lookup is deliberately loose. */
function draftFields(): Record<string, unknown> {
  return (useTaskDraft().draft.value?.fields ?? {}) as Record<string, unknown>
}

/** Every request that would mutate the backend, which a prefill must never make (AC-2.1). */
function writes(fetchMock: Mock): string[] {
  return fetchMock.mock.calls
    .map((call) => String((call[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase())
    .filter((method) => method !== 'GET')
}

describe('prefill_task_form', () => {
  let fetchMock: Mock

  beforeEach(() => {
    setActivePinia(createPinia())
    routerRef.current = makeRouter('/tasks')
    fetchMock = stubFetch()
    useTeamStore().members = [...TEAM_MEMBERS]
    useTaskDraft().setTarget(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useTaskDraft().clear()
  })

  it('applies the resolved fields to the form', async () => {
    const result = await prefillTaskForm(
      { title: 'Fix login redirect', priority: 'HIGH', dueDate: '2026-01-09' },
      CALL,
    )

    expect(result.ok).toBe(true)
    expect(useTaskDraft().draft.value?.fields).toMatchObject({
      title: 'Fix login redirect',
      priority: 'HIGH',
      dueDate: '2026-01-09',
    })
    expect(useTaskDraft().draft.value?.taskId).toBeNull()
  })

  it('never writes to the backend (AC-2.1)', async () => {
    await prefillTaskForm({ title: 'Fix login redirect', status: 'TODO' }, CALL)
    await prefillTaskForm({ taskId: 't1', title: 'Rename' }, CALL)

    expect(writes(fetchMock)).toEqual([])
  })

  it('resolves an assignee name to an id', async () => {
    await prefillTaskForm({ title: 'Ship it', assigneeName: 'ada lovelace' }, CALL)

    expect(useTaskDraft().draft.value?.fields.assigneeId).toBe('m1')
    expect(useTaskDraft().draft.value?.missing).toEqual([])
  })

  it('omits an unknown assignee and reports it rather than guessing (FR-AI-12)', async () => {
    const result = await prefillTaskForm({ title: 'Ship it', assigneeName: 'Nobody Atall' }, CALL)

    expect(useTaskDraft().draft.value?.fields.assigneeId).toBeUndefined()
    expect(useTaskDraft().draft.value?.missing).toContain('assigneeId')
    expect(result.ok).toBe(true)
    expect(result.content).toContain('missing=[assigneeId]')
  })

  it.each([
    ['status', { status: 'done' }, 'status'],
    ['priority', { priority: 'VERY_HIGH' }, 'priority'],
    ['dueDate wording', { dueDate: 'next friday' }, 'dueDate'],
    ['dueDate shape', { dueDate: '2026-1-9' }, 'dueDate'],
    ['estimateHours type', { estimateHours: '3' }, 'estimateHours'],
    ['estimateHours range', { estimateHours: 5000 }, 'estimateHours'],
    ['tags shape', { tags: 'bug' }, 'tags'],
  ])('omits an invalid %s and reports it', async (_name, args, expectedMissing) => {
    const result = await prefillTaskForm({ title: 'Ship it', ...args }, CALL)

    expect(useTaskDraft().draft.value?.missing).toContain(expectedMissing)
    expect(draftFields()[expectedMissing]).toBeUndefined()
    expect(result.ok).toBe(true)
  })

  it('keeps the usable fields alongside the unusable ones', async () => {
    await prefillTaskForm({ title: 'Ship it', status: 'IN_PROGRESS', dueDate: 'soon' }, CALL)

    expect(useTaskDraft().draft.value?.fields).toMatchObject({
      title: 'Ship it',
      status: 'IN_PROGRESS',
    })
    expect(useTaskDraft().draft.value?.missing).toEqual(['dueDate'])
  })

  it('fails when neither a title nor a taskId is given', async () => {
    const result = await prefillTaskForm({ status: 'TODO' }, CALL)

    expect(result).toEqual({
      ok: false,
      content: 'prefill_task_form needs a title (max 160 chars) or a taskId',
      error: 'prefill_task_form needs a title (max 160 chars) or a taskId',
    })
    expect(useTaskDraft().draft.value).toBeNull()
  })

  it('fails on a title over 160 characters', async () => {
    const result = await prefillTaskForm({ title: 'x'.repeat(161) }, CALL)

    expect(failureOf(result)).toContain('160')
    expect(useTaskDraft().draft.value).toBeNull()
  })

  it.each([null, undefined, 'nope', 42, []])('fails without throwing on %p', async (args) => {
    const result = await prefillTaskForm(args, CALL)

    expect(result.ok).toBe(false)
    expect(useTaskDraft().draft.value).toBeNull()
  })

  it('returns the documented content shape', async () => {
    const result = await prefillTaskForm(
      {
        title: 'Fix login redirect',
        priority: 'HIGH',
        dueDate: '2026-01-09',
        tags: ['bug', 'auth'],
      },
      CALL,
    )

    expect(result).toEqual({
      ok: true,
      content:
        'prefilled title="Fix login redirect", priority=HIGH, dueDate=2026-01-09, tags=[bug,auth]',
    })
  })

  it('appends the missing list to the content', async () => {
    const result = await prefillTaskForm({ title: 'Ship it', assigneeName: 'Ghost' }, CALL)

    expect(result.content).toBe('prefilled title="Ship it"; missing=[assigneeId]')
  })

  it('writes the draft into the shared state document too', async () => {
    await prefillTaskForm({ title: 'Fix login redirect', taskId: 't9' }, CALL)

    expect(useCoworkStore().state.draft).toMatchObject({
      taskId: 't9',
      source: 'ai',
      task: { title: 'Fix login redirect' },
    })
  })

  it('navigates to the create form for a new task', async () => {
    await prefillTaskForm({ title: 'Fix login redirect' }, CALL)

    expect(routerRef.current?.currentRoute.value.path).toBe('/tasks/new')
  })

  it('navigates to the edit form for an existing task', async () => {
    await prefillTaskForm({ taskId: 't9', title: 'Rename' }, CALL)

    expect(routerRef.current?.currentRoute.value.path).toBe('/tasks/t9/edit')
  })

  it('stays put when the user is already on the target form (OPEN-11)', async () => {
    routerRef.current = makeRouter('/tasks/new')

    await prefillTaskForm({ title: 'Fix login redirect' }, CALL)

    expect(routerRef.current?.currentRoute.value.path).toBe('/tasks/new')
  })

  it('preserves the fields the user already edited (FR-S-04)', async () => {
    await prefillTaskForm({ title: 'AI title' }, CALL)
    useTaskDraft().noteUserEdit('title')
    useTaskDraft().draft.value = { ...useTaskDraft().draft.value!, fields: { title: 'my title' } }

    await prefillTaskForm({ title: 'AI title again', priority: 'HIGH' }, CALL)

    const draft = useTaskDraft().draft.value
    expect(draft?.fields.title).toBe('my title')
    expect(draft?.fields.priority).toBe('HIGH')
    expect(draft?.missing.join(' ')).toContain('kept your value')
  })

  it('is ignored by the form when it targets a different task', async () => {
    useTaskDraft().setTarget('t1')

    await prefillTaskForm({ taskId: 't9', title: 'Rename' }, CALL)

    // FE-06 refuses a draft addressed to another task rather than hijacking the form.
    expect(useTaskDraft().draft.value).toBeNull()
  })

  it('trims text and normalises an empty description', async () => {
    await prefillTaskForm({ title: '  Ship it  ', description: '   ' }, CALL)

    expect(useTaskDraft().draft.value?.fields).toMatchObject({
      title: 'Ship it',
      description: '',
    })
  })

  it('rounds estimate hours to one decimal place', async () => {
    await prefillTaskForm({ title: 'Ship it', estimateHours: 2.3456 }, CALL)

    expect(useTaskDraft().draft.value?.fields.estimateHours).toBe(2.3)
  })
})
