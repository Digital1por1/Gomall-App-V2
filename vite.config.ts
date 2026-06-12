
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Carga todas las variables de entorno del sistema y de archivos .env
  // El tercer parámetro '' permite cargar variables sin el prefijo VITE_
  // Fix: Cast process to any to access Node.js cwd() method and avoid TypeScript type errors
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      sourcemap: false
    },
    server: {
      port: 3000,
    },
  };
});