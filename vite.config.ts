import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5195, strictPort: true },
  build: {
    rollupOptions: {
      input: { main: 'index.html', agent: 'agent.html' },
    },
  },
});
