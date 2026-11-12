import { createRouter, createWebHistory } from 'vue-router';
import LobbyPage from './features/lobby/LobbyPage.vue';
import SessionPage from './features/session/SessionPage.vue';
import SpatialSessionPage from './features/session/SpatialSessionPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'lobby', component: LobbyPage },
    { path: '/sessions/:sessionId', name: 'session', component: SessionPage },
    { path: '/spatial/:sessionId', name: 'spatial-session', component: SpatialSessionPage },
    { path: '/demo', name: 'demo', component: SessionPage, props: { demo: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
