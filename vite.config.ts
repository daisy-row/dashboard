import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  base: './',
  server: {
    port: 3000
  },
  build: {
    // recharts+d3 minify to ~450 kB (~140 kB gzip) and cannot shrink further;
    // they get their own long-cached chunk, so only warn beyond that.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory')) {
            return 'charts';
          }
          return 'vendor';
        }
      }
    }
  }
});
