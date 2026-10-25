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
      path: '/assets',
      name: 'assets-library',
      component: () => import('@/views/AssetsLibraryView.vue'),
    },
    {
      path: '/board/:id',
      name: 'board-editor',
      component: () => import('@/views/BoardEditorView.vue'),
    },
    {
      path: '/ai',
      redirect: '/ai/draft',
    },
    {
      path: '/ai/:key',
      name: 'ai-studio',
      component: () => import('@/views/AiStudioView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
