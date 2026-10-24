import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  // 使用 hash 模式，双击 index.html 之外的无服务场景也能正常路由
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'board-list',
      component: () => import('@/views/BoardListView.vue'),
    },
    {
      path: '/board/:id',
      name: 'board-editor',
      component: () => import('@/views/BoardEditorView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
