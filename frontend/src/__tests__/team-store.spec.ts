import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { ApiError } from '../api/errors'
import { teamApi } from '../api/team'
import type { TeamMember } from '../domain/task'
import { useTeamStore } from '../stores/team'
import { useUiStore } from '../stores/ui'

vi.mock('../api/team', () => ({ teamApi: { list: vi.fn<typeof teamApi.list>() } }))

const MEMBERS: TeamMember[] = [
  { id: 'm1', displayName: 'Ada Lovelace', email: 'ada@example.com', role: 'ENGINEER' },
  { id: 'm2', displayName: 'Grace Hopper', email: 'grace@example.com', role: 'QA' },
]

describe('useTeamStore', () => {
  let store: ReturnType<typeof useTeamStore>
  let pushToast: Mock

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    const ui = useUiStore()
    pushToast = vi.spyOn(ui, 'pushToast').mockImplementation(() => {})
    store = useTeamStore()
  })

  it('fetches members once even when called repeatedly', async () => {
    vi.mocked(teamApi.list).mockResolvedValue(MEMBERS)

    await store.fetchMembers()
    await store.fetchMembers()

    expect(teamApi.list).toHaveBeenCalledTimes(1)
    expect(store.state).toBe('ready')
    expect(store.members).toHaveLength(2)
    expect(pushToast).not.toHaveBeenCalled()
  })

  it('resolves members by id and by display name (case-insensitively)', async () => {
    vi.mocked(teamApi.list).mockResolvedValue(MEMBERS)
    await store.fetchMembers()

    expect(store.byId.get('m1')?.displayName).toBe('Ada Lovelace')
    expect(store.byName('  ada lovelace ')?.id).toBe('m1')
    expect(store.byName('nobody')).toBeUndefined()
  })

  it('reports a failed fetch through the ui store and allows a retry', async () => {
    vi.mocked(teamApi.list).mockRejectedValueOnce(
      new ApiError({ title: 'Server error', status: 500, kind: 'internal-error', detail: 'boom' }),
    )

    await store.fetchMembers()

    expect(store.state).toBe('error')
    expect(store.error?.status).toBe(500)
    expect(pushToast).toHaveBeenCalledWith({ kind: 'error', title: 'Server error', detail: 'boom' })

    vi.mocked(teamApi.list).mockResolvedValue(MEMBERS)
    await store.fetchMembers()

    expect(store.state).toBe('ready')
    expect(teamApi.list).toHaveBeenCalledTimes(2)
  })
})
