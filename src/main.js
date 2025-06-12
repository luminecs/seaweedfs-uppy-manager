// src/main.js
import { createApp } from 'vue'
import './style.css' // 引入 Tailwind CSS
import App from './App.vue'
import router from './router' // 引入路由

// 引入 Uppy 的核心和仪表盘样式
import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';

const app = createApp(App)
app.use(router) // 使用路由
app.mount('#app')
