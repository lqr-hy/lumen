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
          const packagePath = id.split('node_modules/').pop() || ''
          const packageName = packagePath.startsWith('@')
            ? packagePath.split('/').slice(0, 2).join('/')
            : packagePath.split('/')[0]
          if (
            packageName === 'react' ||
            packageName === 'react-dom' ||
            packageName === 'scheduler' ||
            packageName === 'zustand'
          ) {
            return 'react-vendor'
          }
          if (packageName === 'react-moveable' || packageName === 'framer-motion')
            return 'canvas-vendor'
          if (packageName.startsWith('@earendil-works/')) return 'runtime-vendor'
          if (packageName === 'prismjs' || packageName === 'vue') return 'codegen-vendor'
          if (packageName.startsWith('@dnd-kit/') || packageName === 'react-colorful') return 'ui-vendor'
          if (packageName === 'lucide-react') return 'icon-vendor'
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
