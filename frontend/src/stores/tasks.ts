import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'

import { isApiError, toFieldErrors, type ApiError } from '@/api/errors'
import { taskApi } from '@/api/tasks'
import {
  DEFAULT_TASK_QUERY,
  type Task,
  type TaskQuery,
  type TaskSortField,
  type TaskStats,
  type TaskStatus,
} from '@/domain/task'
import { toCreateInput, toPatchInput, validateTask, type TaskFormValue } from '@/domain/validation'

import { useUiStore } from './ui'

/** Mirrors the shared-state `context.view` union (spec §5.1). */
export type TaskView = 'dashboard' | 'task-list' | 'task-detail' | 'task-form'
export type LoadState = 'idle' | 'loading' | 'ready' | 'error'
export type FormState = 'idle' | 'saving' | 'error'
export type SaveMode = 'create' | 'patch'

const MIN_PAGE_SIZE = 1
const MAX_PAGE_SIZE = 100

/**
 * The single source of truth for the task UI **and** the AI layer (FR-F-17): the list
 * query, filters, paging, selection, the loaded detail, dashboard stats and the form
 * state. FE-10 reads `query`, `selectedIds`, `tasks`, `activeTaskId` and `view` to build
 * the AG-UI state document, so those stay plain reactive members with stable names.
 *
 * Every action catches its own rejection and reports it through the `ui` store — no
 * component ever sees a rejected promise (FR-F-15/FR-F-16).
 */
export const useTaskStore = defineStore('tasks', () => {
  const ui = useUiStore()

  // list
  const query = ref<TaskQuery>({ ...DEFAULT_TASK_QUERY })
  const tasks = ref<Task[]>([])
  const totalElements = ref(0)
  const totalPages = ref(0)
  const listState = ref<LoadState>('idle')
  const listError = ref<ApiError | null>(null)

  // bulk selection
  const selectedIds = ref<string[]>([])

  // detail
  const activeTaskId = ref<string | null>(null)
  const activeTask = ref<Task | null>(null)
  const detailState = ref<LoadState>('idle')
  const detailError = ref<ApiError | null>(null)

  // dashboard stats
  const stats = ref<TaskStats | null>(null)
  const statsState = ref<LoadState>('idle')
  const statsError = ref<ApiError | null>(null)

  // form
  const formState = ref<FormState>('idle')
  const formErrors = ref<Record<string, string>>({})
  /**
   * The REST body of the last **successful** write, kept verbatim for the AI approval
   * path (FE-12): C6 puts that response into the resume payload, and the write actions
   * below are pinned to `boolean` by FE-03/FE-04/FE-06. `shallowRef` on purpose, so the
   * stored object is the plain parsed JSON rather than a reactive proxy.
   */
  const lastWrite = shallowRef<{
    kind: 'create' | 'patch' | 'status' | 'bulk-status'
    result: unknown
  }>({
    kind: 'create',
    result: null,
  })

  // route view — the router sets it, FE-10 forwards it as `context.view`
  const view = ref<TaskView>('task-list')

  // Non-reactive bookkeeping: the abort handle and the page the current `tasks` came from.
  let inFlightList: AbortController | null = null
  let lastLoadedPage: number | null = null

  const isEmpty = computed(() => listState.value === 'ready' && tasks.value.length === 0)

  const isFiltered = computed(() => {
    const current = query.value
    return (
      current.statuses.length > 0 ||
      current.priorities.length > 0 ||
      current.assigneeId !== null ||
      current.unassigned ||
      current.tag !== null ||
      current.q !== null ||
      current.overdue ||
      current.dueWithinDays !== null ||
      current.createdFrom !== null ||
      current.createdTo !== null
    )
  })

  const pageCount = computed(() => totalPages.value)

  const allOnPageSelected = computed(
    () =>
      tasks.value.length > 0 && tasks.value.every((task) => selectedIds.value.includes(task.id)),
  )

  const selectedTasks = computed(() =>
    tasks.value.filter((task) => selectedIds.value.includes(task.id)),
  )

  const visibleTaskIds = computed(() => tasks.value.map((task) => task.id))

  /** The one error policy: a C1 error keeps its own title/detail, anything else is wrapped. */
  function report(caught: unknown, fallbackTitle: string) {
    if (!isApiError(caught)) {
      ui.pushToast({
        kind: 'error',
        title: fallbackTitle,
        detail: caught instanceof Error ? caught.message : String(caught),
      })
      return
    }
    ui.pushToast({ kind: 'error', title: caught.message, detail: caught.detail })
  }

  /** Drops selected ids that are no longer on the loaded page (bulk actions are page-local). */
  function pruneSelection() {
    const visible = new Set(tasks.value.map((task) => task.id))
    selectedIds.value = selectedIds.value.filter((id) => visible.has(id))
  }

  /** The version of a task we last saw, from the loaded detail or the loaded page. */
  function versionFor(id: string): number | undefined {
    if (activeTask.value?.id === id) return activeTask.value.version
    return tasks.value.find((task) => task.id === id)?.version
  }

  async function fetchList(): Promise<void> {
    // Last write wins: abort whatever is in flight before starting a new one.
    inFlightList?.abort()
    const controller = new AbortController()
    inFlightList = controller

    listState.value = 'loading'
    listError.value = null

    try {
      const page = await taskApi.list({ ...query.value }, controller.signal)
      if (controller.signal.aborted) return

      tasks.value = page.content
      totalElements.value = page.totalElements
      totalPages.value = page.totalPages
      listState.value = 'ready'

      // Bulk actions never span pages, so a page change drops ids that scrolled away.
      if (lastLoadedPage !== null && lastLoadedPage !== page.page) pruneSelection()
      lastLoadedPage = page.page
    } catch (caught) {
      if (controller.signal.aborted) return
      listState.value = 'error'
      listError.value = isApiError(caught) ? caught : null
      report(caught, 'Could not load tasks')
    } finally {
      if (inFlightList === controller) inFlightList = null
    }
  }

  /** Merge a partial query; any filter change resets to page 0 unless `page` is explicit. */
  function setQuery(patch: Partial<TaskQuery>): Promise<void> {
    const next: TaskQuery = { ...query.value, ...patch }
    next.page = patch.page !== undefined ? Math.max(0, patch.page) : 0
    next.size = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, next.size))

    query.value = next
    return fetchList()
  }

  function setFilter<K extends keyof TaskQuery>(key: K, value: TaskQuery[K]): Promise<void> {
    return setQuery({ [key]: value } as Partial<TaskQuery>)
  }

  function clearFilters(): Promise<void> {
    query.value = {
      ...DEFAULT_TASK_QUERY,
      sort: query.value.sort,
      descending: query.value.descending,
      size: query.value.size,
      page: 0,
    }
    return fetchList()
  }

  function setSort(field: TaskSortField): Promise<void> {
    const sameField = query.value.sort === field
    query.value = {
      ...query.value,
      sort: field,
      descending: sameField
        ? !query.value.descending
        : field === 'createdAt' || field === 'updatedAt',
      page: 0,
    }
    return fetchList()
  }

  function setPage(page: number): Promise<void> {
    const maxPage = Math.max(totalPages.value - 1, 0)
    query.value = { ...query.value, page: Math.min(Math.max(page, 0), maxPage) }
    return fetchList()
  }

  function toggleSelection(id: string) {
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter((entry) => entry !== id)
      : [...selectedIds.value, id]
  }

  function selectAll(ids: string[]) {
    selectedIds.value = [...new Set(ids)]
  }

  function clearSelection() {
    selectedIds.value = []
  }

  function setView(next: TaskView) {
    view.value = next
  }

  async function fetchDetail(id: string): Promise<void> {
    activeTaskId.value = id
    detailState.value = 'loading'
    detailError.value = null

    try {
      activeTask.value = await taskApi.get(id)
      detailState.value = 'ready'
    } catch (caught) {
      activeTask.value = null
      detailState.value = 'error'
      detailError.value = isApiError(caught) ? caught : null
      // A 404 lands here too: FE-06 renders `detailError` as a "task not found" empty state.
      report(caught, 'Could not load the task')
    }
  }

  function clearDetail() {
    activeTaskId.value = null
    activeTask.value = null
    detailState.value = 'idle'
    detailError.value = null
  }

  async function fetchStats(): Promise<void> {
    statsState.value = 'loading'
    statsError.value = null

    try {
      stats.value = await taskApi.stats()
      statsState.value = 'ready'
    } catch (caught) {
      statsState.value = 'error'
      statsError.value = isApiError(caught) ? caught : null
      report(caught, 'Could not load the dashboard stats')
    }
  }

  /**
   * Shared write path. Returns the saved task on success, `null` on any failure (with
   * `formState`/`formErrors` set and a toast pushed). `saveTask` keeps its pinned
   * boolean contract on top of this; `createTask` hands the task itself back so FE-06 can
   * navigate to `/tasks/{id}`.
   */
  async function persist(
    mode: SaveMode,
    id: string | null,
    input: TaskFormValue,
  ): Promise<Task | null> {
    const validation = validateTask(input, mode)
    if (!validation.valid) {
      formErrors.value = validation.errors
      formState.value = 'error'
      return null
    }

    formState.value = 'saving'
    formErrors.value = {}

    try {
      const saved =
        mode === 'create'
          ? await taskApi.create(toCreateInput(input))
          : await taskApi.patch(requireId(id), toPatchInput(input), versionFor(requireId(id)))

      await Promise.all([
        fetchList(),
        id === null ? Promise.resolve() : fetchDetail(id),
        fetchStats(),
      ])

      lastWrite.value = { kind: mode, result: saved }
      formState.value = 'idle'
      ui.pushToast({ kind: 'success', title: mode === 'create' ? 'Task created' : 'Task saved' })
      return saved
    } catch (caught) {
      formState.value = 'error'
      if (isApiError(caught)) formErrors.value = toFieldErrors(caught)
      report(caught, 'Could not save the task')
      return null
    }
  }

  async function saveTask(
    mode: SaveMode,
    id: string | null,
    input: TaskFormValue,
  ): Promise<boolean> {
    return (await persist(mode, id, input)) !== null
  }

  /**
   * Additive FE-06 helper: identical to `saveTask('create', null, input)` but returns the
   * created task, which the create form needs to navigate to `/tasks/{id}`.
   */
  function createTask(input: TaskFormValue): Promise<Task | null> {
    return persist('create', null, input)
  }

  function requireId(id: string | null): string {
    if (id === null) throw new Error('saveTask("patch") requires a task id')
    return id
  }

  async function changeStatus(id: string, status: TaskStatus, reopen = false): Promise<boolean> {
    try {
      const saved = await taskApi.changeStatus(id, {
        status,
        reopen,
        expectedVersion: versionFor(id),
      })

      // Only refresh the detail when it is the open task — otherwise a list-row status
      // change would silently open a detail view (and set `context.taskId`).
      const detailRefresh = activeTaskId.value === id ? fetchDetail(id) : Promise.resolve()
      await Promise.all([fetchList(), detailRefresh, fetchStats()])
      lastWrite.value = { kind: 'status', result: saved }
      return true
    } catch (caught) {
      if (isApiError(caught) && caught.kind === 'illegal-transition') {
        // AC-1.3: show the backend's detail verbatim; the list is not refetched.
        ui.pushToast({
          kind: 'error',
          title: caught.message || 'Status change rejected',
          detail: caught.detail,
        })
        return false
      }

      if (isApiError(caught) && caught.kind === 'version-conflict') {
        formErrors.value = { ...formErrors.value, version: caught.detail }
        ui.pushToast({
          kind: 'error',
          title: caught.message || 'Version conflict',
          detail: caught.detail,
          retryable: true,
        })
        return false
      }

      report(caught, 'Could not change the status')
      return false
    }
  }

  async function bulkChangeStatus(
    ids: string[],
    status: TaskStatus,
    reopen = false,
  ): Promise<boolean> {
    const expectedVersions: Record<string, number> = {}
    for (const id of ids) {
      const version = versionFor(id)
      if (version !== undefined) expectedVersions[id] = version
    }

    try {
      const saved = await taskApi.bulkStatus({ ids, status, reopen, expectedVersions })
      clearSelection()
      await Promise.all([fetchList(), fetchStats()])
      lastWrite.value = { kind: 'bulk-status', result: saved }
      return true
    } catch (caught) {
      if (isApiError(caught) && caught.kind === 'illegal-transition') {
        // AC-1.5: one illegal row rejects the whole batch. Nothing is refetched and the
        // backend's multi-line detail names every offending task.
        ui.pushToast({
          kind: 'error',
          title: caught.message || 'Status change rejected',
          detail: caught.detail,
        })
        return false
      }

      report(caught, 'Could not change the selected tasks')
      return false
    }
  }

  async function deleteTask(id: string, force = false): Promise<boolean> {
    try {
      await taskApi.remove(id, force)
      if (activeTaskId.value === id) clearDetail()
      await Promise.all([fetchList(), fetchStats()])
      return true
    } catch (caught) {
      if (isApiError(caught) && caught.kind === 'blocked-delete') {
        ui.pushToast({
          kind: 'error',
          title: caught.message || 'Task cannot be deleted',
          detail: caught.detail,
          // A force retry is only available while the delete was not already forced.
          retryable: !force,
        })
        return false
      }

      report(caught, 'Could not delete the task')
      return false
    }
  }

  return {
    // state
    query,
    tasks,
    totalElements,
    totalPages,
    listState,
    listError,
    selectedIds,
    activeTaskId,
    activeTask,
    detailState,
    detailError,
    stats,
    statsState,
    statsError,
    formState,
    formErrors,
    lastWrite,
    view,
    // getters
    isEmpty,
    isFiltered,
    pageCount,
    allOnPageSelected,
    selectedTasks,
    visibleTaskIds,
    // actions
    fetchList,
    setQuery,
    setFilter,
    clearFilters,
    setSort,
    setPage,
    toggleSelection,
    selectAll,
    clearSelection,
    setView,
    fetchDetail,
    clearDetail,
    fetchStats,
    saveTask,
    createTask,
    changeStatus,
    bulkChangeStatus,
    deleteTask,
  }
})
