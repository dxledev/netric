import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { randomUUID } from 'node:crypto'

// https://vite.dev/config/
export default defineConfig(() => {
  const buildId = randomUUID()

  return {
    define: { __APP_BUILD_ID__: JSON.stringify(buildId) },
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler']],
        },
      }),
      tailwindcss(),
      {
        name: 'emit-app-version-manifest',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({ buildId }),
          })
        },
      },
    ],
  }
})
