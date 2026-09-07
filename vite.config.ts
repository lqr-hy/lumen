import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.bilibili.co', '.bilibili.com'],
    proxy: {
      '/x/upload/cover': {
        target: 'https://activity-template.bilibili.co',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-moveable') || id.includes('framer-motion')) return 'canvas-vendor'
          if (id.includes('react') || id.includes('zustand')) return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      },
    }),
  ],
})
