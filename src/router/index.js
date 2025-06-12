// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router';
import Upload from '../views/Upload.vue';
import Buckets from '../views/Buckets.vue';
import Files from '../views/Files.vue';

const routes = [
  {
    path: '/Upload',
    name: 'Upload',
    component: Upload,
  },
  {
    path: '/',
    name: 'Buckets',
    component: Buckets,
  },
  {
    // 动态路由，:bucketName 是参数
    path: '/buckets/:bucketName',
    name: 'Files',
    component: Files,
    props: true, // 将路由参数作为 props 传递给组件
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
