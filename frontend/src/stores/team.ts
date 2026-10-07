import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { isApiError, type ApiError } from '@/api/errors'
import { teamApi } from '@/api/team'
import type { TeamMember } from '@/domain/task'

import { useUiStore } from './ui'

/**
 * Team member lookup. Read by FE-06 (assignee label) and FE-11 (`assigneeName` feedback);
 * deliberately independent of the task store so it can be loaded once by the shell.
 */
export const useTeamStore = defineStore('team', () => {
  const ui = useUiStore()

  const members = ref<TeamMember[]>([])
  const state = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const error = ref<ApiError | null>(null)

  /**
   * Idempotent: the shell calls it on mount and FE-06 may call it again when the form
   * opens, so an in-flight or already-loaded fetch is skipped rather than repeated.
   */
  async function fetchMembers(): Promise<void> {
    if (state.value === 'ready' || state.value === 'loading') return

    state.value = 'loading'
    error.value = null

    try {
      members.value = await teamApi.list()
      state.value = 'ready'
    } catch (caught) {
      state.value = 'error'
      error.value = isApiError(caught) ? caught : null

      if (isApiError(caught)) {
        ui.pushToast({
          kind: 'error',
          title: caught.message,
          detail: caught.detail,
        })
      } else {
        ui.pushToast({
          kind: 'error',
          title: 'Could not load team members',
          detail: caught instanceof Error ? caught.message : String(caught),
        })
      }
    }
  }

  const byId = computed(() => new Map(members.value.map((member) => [member.id, member])))

  /** Mirrors the backend's case-insensitive display-name resolution (BE-04). */
  function byName(name: string): TeamMember | undefined {
    const needle = name.trim().toLowerCase()
    return members.value.find((member) => member.displayName.toLowerCase() === needle)
  }

  return { members, state, error, fetchMembers, byId, byName }
})
