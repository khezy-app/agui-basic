import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { taskApi } from '../api/tasks'
import { teamApi } from '../api/team'
import TaskForm from '../components/task/TaskForm.vue'
import { useTaskDraft } from '../composables/useTaskDraft'
import type { Task } from '../domain/task'
import { useTaskStore } from '../stores/tasks'
import { makeTask, TEAM_MEMBERS } from './fixtures'

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

vi.mock('../api/team', () => ({ teamApi: { list: vi.fn<typeof teamApi.list>() } }))

type Props = { mode: 'create' | 'edit'; initial?: Task }

async function mountForm(props: Props) {
  const pinia = createPinia()
  setActivePinia(pinia)
  vi.mocked(teamApi.list).mockResolvedValue(TEAM_MEMBERS)

  const wrapper = mount(TaskForm, { props, global: { plugins: [pinia] } })
  await flushPromises()

  return { wrapper, store: useTaskStore(pinia) }
}

function submitButton(wrapper: VueWrapper) {
  return wrapper.get('button[type="submit"]')
}

beforeEach(() => {
  vi.clearAllMocks()
  useTaskDraft().clear()
})

describe('TaskForm', () => {
  it('renders every field with the create defaults', async () => {
    const { wrapper } = await mountForm({ mode: 'create' })

    for (const id of [
      'title',
      'description',
      'priority',
      'assigneeId',
      'reporterId',
      'dueDate',
      'estimateHours',
      'tags',
    ]) {
      expect(wrapper.find(`#${id}`).exists(), `#${id}`).toBe(true)
    }

    expect((wrapper.get('#priority').element as HTMLSelectElement).value).toBe('MEDIUM')
    expect((wrapper.get('#dueDate').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('#estimateHours').element as HTMLInputElement).value).toBe('')
    expect(submitButton(wrapper).text()).toContain('Create task')
  })

  it('disables submit for a blank title and flags an over-long one', async () => {
    const { wrapper } = await mountForm({ mode: 'create' })

    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.get('#title').setValue('x'.repeat(161))
    await flushPromises()

    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('must be at most 160 characters')
    expect(wrapper.get('#title').attributes('aria-invalid')).toBe('true')
  })

  it('emits the normalised payload on submit', async () => {
    const { wrapper } = await mountForm({ mode: 'create' })

    await wrapper.get('#title').setValue('   Fix login   ')
    await wrapper.get('#tags').setValue('Bug, bug,  AUTH ')
    await wrapper.get('#estimateHours').setValue('3')
    await wrapper.get('#description').setValue('   ')
    await flushPromises()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const emitted = wrapper.emitted('submit')
    expect(emitted).toBeTruthy()
    const payload = emitted?.[0]?.[0] as Record<string, unknown>

    expect(payload.title).toBe('Fix login')
    expect(payload.tags).toEqual(['bug', 'auth'])
    expect(payload.estimateHours).toBe(3)
    expect(payload.description).toBeNull()
    expect(payload.dueDate).toBeNull()
    expect(payload.status).toBe('TODO')
    expect(payload.priority).toBe('MEDIUM')
  })

  it('renders server field errors on the matching controls, including tags[0]', async () => {
    const { wrapper, store } = await mountForm({ mode: 'create' })

    store.formErrors = {
      title: 'must not be blank',
      'tags[0]': 'must be 1–24 characters',
    }
    await flushPromises()

    expect(wrapper.text()).toContain('must not be blank')
    expect(wrapper.text()).toContain('must be 1–24 characters (entry 0)')
    expect(wrapper.get('#tags').attributes('aria-invalid')).toBe('true')
  })

  it('disables submit while saving and does not reset the form afterwards', async () => {
    const { wrapper, store } = await mountForm({ mode: 'create' })

    await wrapper.get('#title').setValue('Keep me')
    store.formState = 'saving'
    await flushPromises()

    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
    expect(submitButton(wrapper).text()).toContain('Saving…')

    store.formState = 'error'
    await flushPromises()

    expect((wrapper.get('#title').element as HTMLInputElement).value).toBe('Keep me')
  })

  it('marks an AI-drafted field and removes the marker once the user edits it', async () => {
    const { wrapper } = await mountForm({ mode: 'create' })

    useTaskDraft().applyAiDraft({
      taskId: null,
      fields: { title: 'Fix login' },
      missing: [],
      appliedAt: 1,
    })
    await flushPromises()

    expect((wrapper.get('#title').element as HTMLInputElement).value).toBe('Fix login')
    expect(wrapper.text()).toContain('Prefilled by the assistant')
    expect(wrapper.find('.ai-marker').exists()).toBe(true)

    await wrapper.get('#title').setValue('My own title')
    await flushPromises()

    expect(wrapper.find('.ai-marker').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Prefilled by the assistant')
  })

  it('accepts a §5.1-shaped draft (null scalars and a numeric estimate)', async () => {
    const { wrapper } = await mountForm({ mode: 'create' })

    useTaskDraft().applyAiDraft({
      taskId: null,
      fields: {
        title: 'From the wire',
        description: null,
        dueDate: null,
        estimateHours: 5,
        tags: ['bug'],
      } as never,
      missing: [],
      appliedAt: 1,
    })
    await flushPromises()

    expect((wrapper.get('#description').element as HTMLTextAreaElement).value).toBe('')
    expect((wrapper.get('#dueDate').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('#estimateHours').element as HTMLInputElement).value).toBe('5')
    expect(wrapper.findAll('.ai-marker').length).toBe(5)
  })

  it('renders the amber callout for unresolved draft fields', async () => {
    const { wrapper } = await mountForm({ mode: 'create' })

    useTaskDraft().applyAiDraft({
      taskId: null,
      fields: { title: 'Fix login' },
      missing: ['assigneeId'],
      appliedAt: 1,
    })
    await flushPromises()

    const callout = wrapper.get('.missing-callout')
    expect(callout.text()).toContain('assigneeId')
  })

  it('offers only the four creatable statuses on create and none when editing', async () => {
    const create = await mountForm({ mode: 'create' })

    expect(create.wrapper.find('#status').exists()).toBe(true)
    const options = create.wrapper
      .findAll('#status option')
      .map((option) => (option.element as HTMLOptionElement).value)
    expect(options).toEqual(['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED'])

    const edit = await mountForm({ mode: 'edit', initial: makeTask({ status: 'IN_REVIEW' }) })
    expect(edit.wrapper.find('#status').exists()).toBe(false)
    expect(edit.wrapper.get('button[type="submit"]').text()).toContain('Save changes')
  })

  it('offers reload-latest on a version conflict and keeps the user edits', async () => {
    const { wrapper, store } = await mountForm({
      mode: 'edit',
      initial: makeTask({ id: 't1', title: 'Original', version: 3 }),
    })

    await wrapper.get('#title').setValue('My edit')
    vi.mocked(taskApi.get).mockResolvedValue(
      makeTask({ id: 't1', title: 'Server title', version: 4 }),
    )
    store.formErrors = { version: 'stale version' }
    await flushPromises()

    const banner = wrapper.get('.conflict-banner')
    expect(banner.text()).toContain('changed since you loaded it')

    await banner.get('.conflict-reload').trigger('click')
    await flushPromises()

    expect(taskApi.get).toHaveBeenCalledWith('t1')
    expect((wrapper.get('#title').element as HTMLInputElement).value).toBe('My edit')
    expect(wrapper.find('.conflict-banner').exists()).toBe(false)
  })

  it('keeps a later draft from overwriting a field the user already edited', async () => {
    const { wrapper } = await mountForm({ mode: 'create' })

    await wrapper.get('#title').setValue('Mine')
    useTaskDraft().applyAiDraft({
      taskId: null,
      fields: { title: 'Agent title', description: 'Agent body' },
      missing: [],
      appliedAt: 1,
    })
    await flushPromises()

    expect((wrapper.get('#title').element as HTMLInputElement).value).toBe('Mine')
    expect((wrapper.get('#description').element as HTMLTextAreaElement).value).toBe('Agent body')
    expect(wrapper.get('.missing-callout').text()).toContain('kept your value')
  })
})
