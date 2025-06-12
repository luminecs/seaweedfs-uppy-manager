import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
// export default defineConfig({
//   plugins: [vue()],
// })


export default defineConfig({
  plugins: [vue()],
  server: {
    host: true, // 保持这个配置，以便能通过 IP 访问
    proxy: {
      // 关键配置部分
      '/s3-api': { // 匹配所有以 '/s3-api' 开头的请求
        target: 'http://192.168.60.59:9999', // 你的 SeaweedFS S3 API 地址
        changeOrigin: true, // 必须设置为 true，表示改变请求源头
        rewrite: (path) => path.replace(/^\/s3-api/, ''), // 重写路径，去掉 '/s3-api' 前缀
      },
    }
  }
})
