<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="view not-found">
    <h2>Page not found</h2>
    <p class="placeholder-note">That route does not exist.</p>
    <RouterLink to="/">Back to dashboard</RouterLink>
  </section>
</template>
