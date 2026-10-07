import type { Component } from 'vue'

import ApprovalCard from './cards/ApprovalCard.vue'
import ErrorCard from './cards/ErrorCard.vue'
import QuestionCard from './cards/QuestionCard.vue'
import StatsCard from './cards/StatsCard.vue'
import StatusChangeCard from './cards/StatusChangeCard.vue'
import TaskListCard from './cards/TaskListCard.vue'
import TaskSummaryCard from './cards/TaskSummaryCard.vue'

export type CardKind =
  'task-list' | 'task-summary' | 'stats' | 'approval' | 'question' | 'status-change' | 'error'

const registry: Record<CardKind, Component> = {
  'task-list': TaskListCard,
  'task-summary': TaskSummaryCard,
  stats: StatsCard,
  approval: ApprovalCard,
  question: QuestionCard,
  'status-change': StatusChangeCard,
  error: ErrorCard,
}

/** Static map, no dynamic lookup — the model never chooses a component (FR-AI-21). */
export const cardFor = (kind: CardKind): Component => registry[kind]

/** The component for a classification, or `null` when the content produced no card. */
export const componentFor = (kind: CardKind | null): Component | null =>
  kind === null ? null : registry[kind]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tryParse(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}

/**
 * Maps a tool name (ours, never model-chosen) plus the result-content shape onto a card.
 * Unknown or unparseable content yields `null` — the caller renders plain text instead,
 * never a crash, never a blank area.
 */
export function classify(toolName: string, content: unknown): CardKind | null {
  const parsed = typeof content === 'string' ? tryParse(content) : content
  if (isRecord(parsed) && typeof parsed.error === 'string' && parsed.error !== '') return 'error'
  switch (toolName) {
    case 'query_tasks':
      return isRecord(parsed) && Array.isArray(parsed.tasks) && typeof parsed.total === 'number'
        ? 'task-list'
        : null
    case 'get_task':
      return isRecord(parsed) && isRecord(parsed.brief) ? 'task-summary' : null
    case 'get_task_stats':
      return isRecord(parsed) && typeof parsed.total === 'number' && isRecord(parsed.byStatus)
        ? 'stats'
        : null
    default:
      return null
  }
}
