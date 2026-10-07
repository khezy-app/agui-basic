import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Router } from 'vue-router'

/**
 * FE-13: the AI entry and the panel's docked/closed behaviour.
 *
 * `useCoworkPanel` keeps its open state in a module-level ref, so each case imports the
 * shell fresh (`vi.resetModules`) after arranging `localStorage` — that is exactly how a
 * reload observes the persisted preference.
 */
async function importShell(enabled: boolean) {
  vi.resetModules()
  vi.doMock('@/config', () => ({
    config: { aguiEnabled: enabled, aguiUrl: '/agent', apiBaseUrl: '/api', aguiModel: 'test' },
  }))
  const { default: AppShell } = await import('@/components/layout/AppShell.vue')
  const { routes } = await import('@/router')
  return { AppShell, routes }
}

async function mountShell(enabled: boolean, path = '/'): Promise<VueWrapper> {
  const { AppShell, routes } = await importShell(enabled)
  const pinia = createPinia()
  setActivePinia(pinia)
  const router: Router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()

  return mount(AppShell, {
    global: { plugins: [pinia, router] },
    slots: { default: 'content' },
  })
}

beforeEach(() => {
  localStorage.clear()
})

describe('AI Cowork entry (FR-AI-08, AC-1.6)', () => {
  it('hides the nav entry and the panel entirely when the flag is off', async () => {
    const wrapper = await mountShell(false)

    expect(wrapper.find('.nav-button').exists()).toBe(false)
    expect(wrapper.find('.app-shell-panel').exists()).toBe(false)
    // The Phase 1 navigation is intact, just without the AI entry.
    expect(wrapper.findAll('.nav-item')).toHaveLength(2)
  })

  it('docks the panel when the enabled nav entry is clicked', async () => {
    const wrapper = await mountShell(true)

    const button = wrapper.get('.nav-button')
    expect(button.text()).toContain('AI Cowork')
    expect(wrapper.find('.app-shell-panel').exists()).toBe(false)

    await button.trigger('click')

    const panel = wrapper.get('.app-shell-panel')
    expect(panel.text()).toContain('AI Cowork')
    expect(button.attributes('aria-pressed')).toBe('true')
    // Docked layout: the shell gains the panel column.
    expect(wrapper.get('.app-shell').classes()).toContain('panel-open')
  })

  it('honours the persisted preference on remount', async () => {
    localStorage.setItem('agui.panelOpen', 'true')

    const wrapper = await mountShell(true)

    expect(wrapper.find('.app-shell-panel').exists()).toBe(true)
    expect(wrapper.get('.nav-button').attributes('aria-pressed')).toBe('true')
  })

  it('closes the panel with the close button and remembers it', async () => {
    localStorage.setItem('agui.panelOpen', 'true')
    const wrapper = await mountShell(true)

    await wrapper.get('.app-shell-panel [aria-label="Close panel"]').trigger('click')

    expect(wrapper.find('.app-shell-panel').exists()).toBe(false)
    expect(localStorage.getItem('agui.panelOpen')).toBe('false')
  })
})
