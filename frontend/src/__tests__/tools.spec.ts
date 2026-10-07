import { describe, expect, it } from 'vitest'

import { clientTools } from '@/agui/tools'
import { TASK_PRIORITIES, TASK_STATUSES } from '@/domain/task'

type Property = {
  description?: string
  enum?: string[]
  items?: { type?: string; description?: string }
}

type Schema = {
  type?: string
  description?: string
  properties?: Record<string, Property>
  required?: string[]
}

/** `expect` takes one argument, so failures are identified by the assertion itself. */
function propertiesOf(tool: { parameters?: unknown }): Record<string, Property> {
  return (tool.parameters as Schema).properties ?? {}
}

/** Names BE-08 owns and FE-11 must not mirror (FR-AI-05). */
const BACKEND_TOOL_NAMES = [
  'query_tasks',
  'get_task',
  'get_task_stats',
  'propose_task_mutation',
  'update_state',
  'search_team',
]

describe('clientTools', () => {
  it('declares exactly the four frontend tools', () => {
    expect(clientTools.map((tool) => tool.name)).toEqual([
      'prefill_task_form',
      'update_task_status',
      'open_task',
      'ask_user',
    ])
  })

  it('mirrors no backend tool name', () => {
    const names = clientTools.map((tool) => tool.name)
    for (const backend of BACKEND_TOOL_NAMES) expect(names).not.toContain(backend)
  })

  it('gives every tool a description and an object schema', () => {
    expect(clientTools.every((tool) => (tool.description ?? '').length > 40)).toBe(true)
    expect(clientTools.every((tool) => (tool.parameters as Schema).type === 'object')).toBe(true)
  })

  it('gives every property — and every array item — a description', () => {
    const missing = clientTools.flatMap((tool) =>
      Object.entries(propertiesOf(tool)).flatMap(([key, property]) => {
        const gaps: string[] = []
        if (!property.description) gaps.push(`${tool.name}.${key}`)
        if (property.items && !property.items.description) gaps.push(`${tool.name}.${key}[]`)
        return gaps
      }),
    )

    expect(missing).toEqual([])
  })

  it('spells every enum out in `enum` and in the prose', () => {
    const prefill = clientTools.find((tool) => tool.name === 'prefill_task_form')!
    const schema = prefill.parameters as Schema

    expect(schema.properties?.status?.enum).toEqual([...TASK_STATUSES])
    expect(schema.properties?.priority?.enum).toEqual([...TASK_PRIORITIES])
    // Small-model robustness: the same values have to be readable without JSON parsing.
    for (const status of TASK_STATUSES)
      expect(schema.properties?.status?.description).toContain(status)
    for (const priority of TASK_PRIORITIES) {
      expect(schema.properties?.priority?.description).toContain(priority)
    }

    const statusChange = clientTools.find((tool) => tool.name === 'update_task_status')!
    expect((statusChange.parameters as Schema).properties?.status?.enum).toEqual([...TASK_STATUSES])
  })

  it('requires only what the model cannot proceed without', () => {
    const required = Object.fromEntries(
      clientTools.map((tool) => [tool.name, (tool.parameters as Schema).required ?? []]),
    )

    expect(required).toEqual({
      prefill_task_form: [],
      update_task_status: ['status'],
      open_task: ['taskId'],
      ask_user: ['question'],
    })
  })

  it('prefill requires neither title nor taskId, but says so', () => {
    const prefill = clientTools.find((tool) => tool.name === 'prefill_task_form')!
    const schema = prefill.parameters as Schema

    expect(schema.required).toBeUndefined()
    expect(schema.description).toContain('title')
    expect(schema.description).toContain('taskId')
  })

  it('describes the date format the model must send', () => {
    const properties = propertiesOf(clientTools.find((tool) => tool.name === 'prefill_task_form')!)

    expect(properties.dueDate?.description).toContain('yyyy-MM-dd')
    expect(properties.assigneeName?.description).toContain('name')
  })

  it('does not claim that prefill saves anything', () => {
    const prefill = clientTools.find((tool) => tool.name === 'prefill_task_form')!
    expect(prefill.description).toMatch(/does NOT save/i)
  })

  it('does not claim that update_task_status applies anything by itself', () => {
    const statusChange = clientTools.find((tool) => tool.name === 'update_task_status')!
    expect(statusChange.description).toMatch(/confirmation card/i)
  })
})
