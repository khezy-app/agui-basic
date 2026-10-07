import type { Tool } from '@ag-ui/client'

import { STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES } from '@/domain/task'

/**
 * The four client tools (spec §6.2), declared exactly once.
 *
 * They are advertised in `RunAgentInput.tools` and executed by the browser; the agent
 * only ever emits `TOOL_CALL_*` for them. **No backend tool name appears here** (FR-AI-05):
 * `query_tasks`, `get_task`, `get_task_stats` and the rest stay BE-08's business, and
 * mirroring them would have the model call a name that nothing executes.
 *
 * Every property carries a `description`, and every enum is spelled out in the prose as
 * well as in `enum`. The model behind this agent is small; a schema it has to guess at
 * is a schema it gets wrong, and a wrong `status` is a rejected tool call.
 */

const STATUS_ENUM = TASK_STATUSES.map((status) => `${status} (${STATUS_LABEL[status]})`).join(', ')

const priorityEnum = [...TASK_PRIORITIES]

export const prefillTaskFormTool: Tool = {
  name: 'prefill_task_form',
  description:
    'Fill the task form for the user to review. Does NOT save anything — the user must press Save. ' +
    'Call this when the user describes a task they want to create or change. Omit any field you could not determine.',
  parameters: {
    type: 'object',
    description:
      'At least `title` or `taskId` is required. Everything is optional otherwise; omit what you cannot determine.',
    properties: {
      title: { type: 'string', description: 'Task title, at most 160 characters.' },
      description: {
        type: 'string',
        description: 'Longer description. Use an empty string for none.',
      },
      status: {
        type: 'string',
        enum: [...TASK_STATUSES],
        description: `Workflow status. One of: ${STATUS_ENUM}.`,
      },
      priority: {
        type: 'string',
        enum: priorityEnum,
        description: `Priority. One of: ${priorityEnum.join(', ')}.`,
      },
      assigneeName: {
        type: 'string',
        description:
          'Full name of the assignee, e.g. "Ada Lovelace". If no team member matches, the field is left empty and reported as missing.',
      },
      dueDate: {
        type: 'string',
        description:
          'Due date as yyyy-MM-dd, e.g. 2026-01-09. Resolve relative dates against context.today.',
      },
      estimateHours: {
        type: 'number',
        description: 'Estimated effort in hours, e.g. 3.5.',
      },
      tags: {
        type: 'array',
        items: { type: 'string', description: 'One lower-case tag, e.g. "bug".' },
        description: 'Lower-case tags, e.g. ["bug", "auth"].',
      },
      taskId: {
        type: 'string',
        description: 'Id of an existing task to change instead of creating one.',
      },
    },
  },
}

export const updateTaskStatusTool: Tool = {
  name: 'update_task_status',
  description:
    'Ask the user to confirm a status change for one or more tasks. The user sees a confirmation card; ' +
    'this does NOT change anything by itself. Use taskIds for several tasks at once.',
  parameters: {
    type: 'object',
    description: 'Exactly one of `taskId` or `taskIds` is required, together with `status`.',
    properties: {
      taskId: { type: 'string', description: 'Id of the single task to change.' },
      taskIds: {
        type: 'array',
        items: { type: 'string', description: 'A task id.' },
        description: 'Ids of several tasks to change at once (at most 100).',
      },
      status: {
        type: 'string',
        enum: [...TASK_STATUSES],
        description: `Status to move to. One of: ${STATUS_ENUM}.`,
      },
      reopen: {
        type: 'boolean',
        description:
          'Set to true to reopen a CANCELLED task (moving it back to TODO). Required for that transition.',
      },
    },
    required: ['status'],
  },
}

export const openTaskTool: Tool = {
  name: 'open_task',
  description:
    'Open a task in the user task list. Use after identifying the right task, e.g. to show it.',
  parameters: {
    type: 'object',
    description: 'Identifies the task to open.',
    properties: {
      taskId: { type: 'string', description: 'Id of the task to open.' },
    },
    required: ['taskId'],
  },
}

export const askUserTool: Tool = {
  name: 'ask_user',
  description:
    'Ask the user a clarifying question when the request is ambiguous (which task, which person, which date). ' +
    'Waits for their answer.',
  parameters: {
    type: 'object',
    description: 'A question, optionally with a short list of choices.',
    properties: {
      question: { type: 'string', description: 'The question to ask, in one or two sentences.' },
      options: {
        type: 'array',
        items: { type: 'string', description: 'One choice the user can pick.' },
        description: 'Up to 6 short choices the user can pick instead of typing.',
      },
      allowFreeText: {
        type: 'boolean',
        description: 'Set to true to let the user answer with their own words as well.',
      },
    },
    required: ['question'],
  },
}

/** The single source of truth for `RunAgentInput.tools` (FR-AI-05). */
export const clientTools: Tool[] = [
  prefillTaskFormTool,
  updateTaskStatusTool,
  openTaskTool,
  askUserTool,
]
