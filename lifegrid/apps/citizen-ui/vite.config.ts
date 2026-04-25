import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
          icons:  ['lucide-react'],
          map:    ['leaflet', 'react-leaflet'],
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      'react', 'react-dom', 'react-router-dom',
      'lucide-react', 'framer-motion', 'zustand',
      'immer', 'axios', 'date-fns', 'uuid',
    ],
  },
});
