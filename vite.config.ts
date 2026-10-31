import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // reachable from other devices on your network (the relay must be reachable too)
    open: true,
  },
});
