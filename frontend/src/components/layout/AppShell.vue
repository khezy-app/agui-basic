<script setup lang="ts">
import { computed } from 'vue'
import { RouterView } from 'vue-router'

import CoworkPanel from '@/components/cowork/CoworkPanel.vue'
import ConfirmDialog from '@/components/task/ConfirmDialog.vue'
import { useCoworkPanel } from '@/composables/useCoworkPanel'
import { config } from '@/config'

import SideNav from './SideNav.vue'
import TopBar from './TopBar.vue'
import ToastRegion from './ToastRegion.vue'

// The panel is additive chrome: with the flag off the shell renders exactly as Phase 1
// did (AC-1.6), and nothing about the CRUD app changes while it is closed (FR-AI-08).
const { open, close } = useCoworkPanel()
const showPanel = computed(() => config.aguiEnabled && open.value)
</script>

<template>
  <div class="app-shell" :class="{ 'panel-open': showPanel }">
    <SideNav class="app-shell-nav" />
    <div class="app-shell-main">
      <TopBar />
      <main class="app-content">
        <slot>
          <RouterView />
        </slot>
      </main>
    </div>
    <CoworkPanel v-if="showPanel" class="app-shell-panel" @close="close()" />
    <ToastRegion />
    <ConfirmDialog />
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100vh;
}

.app-shell.panel-open {
  grid-template-columns: 220px minmax(0, 1fr) 420px;
}

.app-shell-nav {
  grid-row: 1;
  grid-column: 1;
}

.app-shell-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  grid-row: 1;
  grid-column: 2;
}

.app-shell-panel {
  grid-row: 1;
  grid-column: 3;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
}

.app-content {
  flex: 1;
  padding: var(--space-4);
}

@media (max-width: 1200px) {
  .app-shell.panel-open {
    grid-template-columns: 220px 1fr;
  }

  .app-shell-panel {
    position: fixed;
    inset: 0;
    grid-column: auto;
    z-index: 60;
    width: auto;
    height: 100vh;
  }
}

@media (max-width: 900px) {
  .app-shell {
    grid-template-columns: 1fr;
  }
}
</style>
