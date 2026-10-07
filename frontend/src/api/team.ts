import type { TeamMember } from '@/domain/task'

import { apiFetch } from './client'

export const teamApi = {
  list: (signal?: AbortSignal) => apiFetch<TeamMember[]>('/team-members', { signal }),
}
