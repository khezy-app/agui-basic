<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

import { useCoworkPanel } from '@/composables/useCoworkPanel'
import { config } from '@/config'

type NavItem = {
  title: string
  to: string
  icon: string
}

const items: NavItem[] = [
  { title: 'Dashboard', to: '/', icon: '▦' },
  { title: 'Tasks', to: '/tasks', icon: '☰' },
]

const route = useRoute()
const { open, toggle } = useCoworkPanel()

function isActive(item: NavItem): boolean {
  if (item.to === '/') return route.path === '/'
  return route.path === item.to || route.path.startsWith(`${item.to}/`)
}
</script>

<template>
  <nav class="side-nav" aria-label="Main navigation">
    <RouterLink
      v-for="item in items"
      :key="item.title"
      :to="item.to"
      class="nav-item"
      :class="{ active: isActive(item) }"
    >
      <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
      <span class="nav-label">{{ item.title }}</span>
    </RouterLink>
    <!-- The AI entry is hidden entirely when the feature flag is off (AC-1.6). -->
    <button
      v-if="config.aguiEnabled"
      type="button"
      class="nav-item nav-button"
      :class="{ active: open }"
      :aria-pressed="open"
      @click="toggle()"
    >
      <span class="nav-icon" aria-hidden="true">✦</span>
      <span class="nav-label">AI Cowork</span>
    </button>
  </nav>
</template>

<style scoped>
.side-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-2);
  background: var(--bg);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  color: #cbd5e1;
  text-decoration: none;
  font-weight: 500;
}

.nav-button {
  border: none;
  background: transparent;
  font: inherit;
  cursor: pointer;
  text-align: left;
  width: 100%;
}

.nav-item:hover {
  text-decoration: none;
  background: rgb(255 255 255 / 8%);
  color: #ffffff;
}

.nav-item.active {
  background: var(--primary);
  color: #ffffff;
}

.nav-icon {
  width: 18px;
  text-align: center;
}

@media (max-width: 900px) {
  .side-nav {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }

  .nav-item {
    padding: var(--space-1) var(--space-2);
  }

  .nav-button {
    width: auto;
  }
}
</style>
