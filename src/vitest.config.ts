import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'app/**/*.interaction.test.tsx',
      'app/api/versions/revert/route.test.ts',
      'app/pages/api/plugins/[pluginId]/module/response-headers.test.ts',
    ],
    restoreMocks: true,
    clearMocks: true,
  },
});
