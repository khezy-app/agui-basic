import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import type { Router } from 'vue-router'

import { ASK_USER_TIMEOUT_MS, askUser, openTask } from '@/agui/handlers'
import type { ToolHandlerResult } from '@/agui/handlers'
import type { Task } from '@/domain/task'
import { useCoworkStore } from '@/stores/cowork'
import { makeTask } from './fixtures'

const { routerRef } = vi.hoisted(() => ({ routerRef: { current: null as Router | null } }))

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return { ...actual, useRouter: () => routerRef.current }
})

const CALL = { id: 'c1', messageId: 'm1' }

async function makeRouter(initialPath: string): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
      { path: '/tasks/:id', name: 'task-detail', component: { template: '<div />' } },
    ],
  })
  await router.push(initialPath)
  return router
}

function stubGet(task: Task | null): Mock {
  const fetchMock = vi.fn<() => Promise<unknown>>().mockImplementation(() =>
    task === null
      ? Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () =>
            JSON.stringify({ type: 'not-found', title: 'Task not found', status: 404, detail: '' }),
        })
      : Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => JSON.stringify(task),
        }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Asserts the call failed and narrows the union so `error` can be read. */
function failureOf(result: ToolHandlerResult): string {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected a failure')
  return result.error
}

describe('open_task', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    routerRef.current = await makeRouter('/tasks')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('navigates to the task and reports it', async () => {
    stubGet({ ...makeTask({ id: 't7' }), title: 'Login bug' })

    const result = await openTask({ taskId: 't7' }, CALL)

    expect(result).toEqual({ ok: true, content: 'opened t7' })
    expect(routerRef.current?.currentRoute.value.path).toBe('/tasks/t7')
  })

  it('reports not_found and does not navigate', async () => {
    stubGet(null)

    const result = await openTask({ taskId: 'ghost' }, CALL)

    expect(result).toEqual({ ok: false, content: 'not_found ghost', error: 'not_found' })
    expect(routerRef.current?.currentRoute.value.path).toBe('/tasks')
  })

  it('does not navigate when the load fails for any other reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<() => Promise<unknown>>().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () =>
          JSON.stringify({ type: 'internal-error', title: 'Boom', status: 500, detail: '' }),
      }),
    )

    const result = await openTask({ taskId: 't7' }, CALL)

    expect(failureOf(result)).toBe('could not load the task')
    expect(routerRef.current?.currentRoute.value.path).toBe('/tasks')
  })

  it.each([null, undefined, 'nope', {}])('fails without navigating on %p', async (args) => {
    stubGet(makeTask({ id: 't7' }))

    const result = await openTask(args, CALL)

    expect(result.ok).toBe(false)
    expect(routerRef.current?.currentRoute.value.path).toBe('/tasks')
  })
})

describe('ask_user', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the chosen option', async () => {
    const promise = askUser({ question: 'Which task?', options: ['Login bug', 'Signup'] }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingQuestion).not.toBeNull())

    expect(useCoworkStore().pendingQuestion?.options).toEqual(['Login bug', 'Signup'])
    useCoworkStore().settlePendingQuestion('Login bug')

    expect(await promise).toEqual({ ok: true, content: 'answer: Login bug' })
  })

  it('resolves with a free-text answer', async () => {
    const promise = askUser({ question: 'Which task?', allowFreeText: true }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingQuestion).not.toBeNull())

    useCoworkStore().settlePendingQuestion('the one about auth')

    expect(await promise).toEqual({ ok: true, content: 'answer: the one about auth' })
  })

  it('clears the card once answered', async () => {
    const promise = askUser({ question: 'Which task?' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingQuestion).not.toBeNull())
    useCoworkStore().settlePendingQuestion('x')
    await promise

    expect(useCoworkStore().pendingQuestion).toBeNull()
  })

  it('times out after ten minutes and clears the card', async () => {
    vi.useFakeTimers()
    const promise = askUser({ question: 'Which task?' }, CALL)
    await vi.advanceTimersByTimeAsync(0)
    expect(useCoworkStore().pendingQuestion).not.toBeNull()

    await vi.advanceTimersByTimeAsync(ASK_USER_TIMEOUT_MS)

    expect(await promise).toEqual({
      ok: false,
      content: 'no answer within 10 minutes',
      error: 'no answer within 10 minutes',
    })
    expect(useCoworkStore().pendingQuestion).toBeNull()
  })

  it('does not time out early', async () => {
    vi.useFakeTimers()
    const promise = askUser({ question: 'Which task?' }, CALL)
    await vi.advanceTimersByTimeAsync(ASK_USER_TIMEOUT_MS - 1)

    useCoworkStore().settlePendingQuestion('early enough')
    expect(await promise).toEqual({ ok: true, content: 'answer: early enough' })
  })

  it('keeps at most six short options', async () => {
    const long = 'x'.repeat(200)
    const promise = askUser(
      { question: 'Which one?', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g', '  ', long] },
      CALL,
    )
    await vi.waitFor(() => expect(useCoworkStore().pendingQuestion).not.toBeNull())

    expect(useCoworkStore().pendingQuestion?.options).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])

    useCoworkStore().settlePendingQuestion('a')
    await promise
  })

  it('defaults allowFreeText to true', async () => {
    const promise = askUser({ question: 'Which task?' }, CALL)
    await vi.waitFor(() => expect(useCoworkStore().pendingQuestion).not.toBeNull())

    expect(useCoworkStore().pendingQuestion?.allowFreeText).toBe(true)
    useCoworkStore().settlePendingQuestion('x')
    await promise
  })

  it.each([null, undefined, 'nope', {}, { question: '   ' }])(
    'fails without asking on %p',
    async (args) => {
      const result = await askUser(args, CALL)

      expect(result.ok).toBe(false)
      expect(useCoworkStore().pendingQuestion).toBeNull()
    },
  )
})
