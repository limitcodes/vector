import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@mariozechner/pi-coding-agent': resolve(
          'node_modules/@mariozechner/pi-coding-agent/dist/index.js'
        )
      }
    },
    build: {
      rollupOptions: {
        external: []
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [tailwindcss()]
  }
})
