import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: [resolve('tsconfig.json')] }), react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*overwatch*.spec.ts', 'src/**/*overwatch*.spec.tsx'],
  },
})
