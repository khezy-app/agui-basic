import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const APP_NAME = 'Task Manager'

// `/tasks/new` is declared before `/tasks/:id` so `new` is not parsed as an id.
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { title: 'Dashboard' },
  },
  {
    path: '/tasks',
    name: 'tasks',
    component: () => import('@/views/TaskListView.vue'),
    meta: { title: 'Tasks' },
  },
  {
    path: '/tasks/new',
    name: 'task-new',
    component: () => import('@/views/TaskFormView.vue'),
    meta: { title: 'New task' },
  },
  {
    path: '/tasks/:id',
    name: 'task-detail',
    component: () => import('@/views/TaskDetailView.vue'),
    props: true,
    meta: { title: 'Task detail' },
  },
  {
    path: '/tasks/:id/edit',
    name: 'task-edit',
    component: () => import('@/views/TaskFormView.vue'),
    props: true,
    meta: { title: 'Edit task' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: 'Not found' },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : undefined
  document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
})

export default router
