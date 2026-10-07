<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const title = computed(() => {
  const metaTitle = route.meta.title
  return typeof metaTitle === 'string' ? metaTitle : 'Task Manager'
})

// OPEN-12: the top-bar box is the *same* `q` filter as the URL, not a second search path.
// It navigates to /tasks with `q` set, preserving filters already applied when we are
// already on the list and starting fresh from anywhere else.
const searchInput = ref(typeof route.query.q === 'string' ? route.query.q : '')

watch(
  () => route.query.q,
  (value) => {
    searchInput.value = typeof value === 'string' ? value : ''
  },
)

function submitSearch() {
  const value = searchInput.value.trim()
  const base = route.name === 'tasks' ? { ...route.query } : {}
  if (value === '') delete base.q
  else base.q = value
  void router.push({ name: 'tasks', query: base })
}

function clearSearch() {
  searchInput.value = ''
  submitSearch()
}
</script>

<template>
  <header class="top-bar">
    <h1 class="page-title">{{ title }}</h1>
    <div class="top-bar-actions">
      <form class="task-search-form" role="search" @submit.prevent="submitSearch">
        <input
          v-model="searchInput"
          class="task-search"
          type="search"
          placeholder="Search tasks"
          aria-label="Search tasks"
        />
        <button class="task-search-submit" type="submit">Search</button>
        <button
          v-if="searchInput !== ''"
          class="task-search-clear"
          type="button"
          aria-label="Clear search"
          @click="clearSearch"
        >
          ×
        </button>
      </form>
      <div class="user-chip" title="Fixed dev identity — no authentication in Phase 1">
        <span class="user-avatar" aria-hidden="true">DU</span>
        <span class="user-name">Dev User</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.page-title {
  margin: 0;
  font-size: 18px;
}

.top-bar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.task-search-form {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.task-search {
  width: 240px;
  max-width: 40vw;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-alt);
}

.task-search-submit,
.task-search-clear {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-alt);
  cursor: pointer;
}

.task-search-clear {
  line-height: 1;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  white-space: nowrap;
}

.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--primary);
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
}

@media (max-width: 900px) {
  .top-bar {
    flex-wrap: wrap;
  }

  .user-name {
    display: none;
  }
}
</style>
