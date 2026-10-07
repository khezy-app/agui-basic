<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

import type { PendingQuestion } from '@/stores/cowork'

/**
 * The clarifying question `ask_user` opened (FR-AI-29).
 *
 * Options are one-tap answers; the free-text field is offered when the model allowed it,
 * and the "Ask something else" toggle makes it available regardless, because a small
 * model sometimes omits `allowFreeText` and the user must not be trapped.
 */
const props = defineProps<{ question: PendingQuestion }>()

const emit = defineEmits<{
  answer: [answer: string]
  dismiss: []
}>()

const freeText = ref('')
const showFreeText = ref(props.question.allowFreeText)
const input = ref<HTMLInputElement | null>(null)

const canSubmit = computed(() => freeText.value.trim() !== '')

async function askSomethingElse() {
  showFreeText.value = true
  await nextTick()
  input.value?.focus()
}

function submitFreeText() {
  if (!canSubmit.value) return
  emit('answer', freeText.value.trim())
}
</script>

<template>
  <section class="card question" aria-label="Question">
    <p class="prompt">{{ question.question }}</p>
    <div v-if="question.options.length > 0" class="options">
      <button
        v-for="option in question.options"
        :key="option"
        type="button"
        class="option"
        @click="emit('answer', option)"
      >
        {{ option }}
      </button>
    </div>
    <form v-if="showFreeText" class="free-text" @submit.prevent="submitFreeText">
      <input
        ref="input"
        v-model="freeText"
        type="text"
        class="input"
        placeholder="Type your answer"
        aria-label="Your answer"
      />
      <button type="submit" class="btn primary" :disabled="!canSubmit">Send</button>
    </form>
    <div class="actions">
      <button v-if="!showFreeText" type="button" class="btn ghost" @click="askSomethingElse">
        Ask something else
      </button>
      <button type="button" class="btn ghost" @click="emit('dismiss')">Dismiss</button>
    </div>
  </section>
</template>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-left: 4px solid var(--primary);
  border-radius: var(--radius);
  background: var(--surface);
  padding: var(--space-2) var(--space-3);
}

.prompt {
  font-weight: 500;
  margin: 0 0 var(--space-2);
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.option {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-alt);
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
  font: inherit;
}

.free-text {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.input {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-1) var(--space-2);
  font: inherit;
}

.btn {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
  font: inherit;
}

.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #ffffff;
}

.btn.ghost {
  border-color: transparent;
  color: var(--text-muted);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.actions {
  display: flex;
  gap: var(--space-2);
}
</style>
