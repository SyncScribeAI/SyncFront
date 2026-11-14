/// <reference types="vitest/config" />
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const PDFJS_DIR = path.resolve(__dirname, 'node_modules/pdfjs-dist');
const PDFJS_ASSETS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

/**
 * Ресурсы pdf.js (cmaps, стандартные шрифты, wasm, ICC-профили) раздаются со своего
 * origin по пути /pdfjs/: в закрытом контуре CDN недоступен. В dev они читаются прямо из
 * пакета, при сборке копируются в dist/pdfjs, поэтому версия всегда совпадает с пакетом.
 */
function pdfjsAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'syncfront-pdfjs-assets',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const relative = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        const file = path.resolve(PDFJS_DIR, `.${relative}`);
        // Раздаются только файлы каталогов ресурсов внутри пакета.
        const inside = PDFJS_ASSETS.some((dir) =>
          file.startsWith(path.join(PDFJS_DIR, dir) + path.sep),
        );
        if (!inside) return next();
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      for (const dir of PDFJS_ASSETS) {
        cpSync(path.join(PDFJS_DIR, dir), path.join(outDir, 'pdfjs', dir), { recursive: true });
      }
    },
  };
}

// В dev все запросы к /api проксируются на бэкенд, чтобы не упираться в CORS.
// В prod базовый URL API берётся из VITE_API_BASE_URL (см. src/api/config.ts).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://localhost:8000';

  return {
    plugins: [react(), pdfjsAssets()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true },
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Стабильные vendor-чанки кешируются браузером независимо от кода приложения.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            query: ['@tanstack/react-query'],
            forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
          },
        },
      },
    },
    test: {
      // Кастомное окружение = jsdom + Node-реализации AbortController/AbortSignal/Headers/URL,
      // иначе на Node 22+ undici отвергает jsdom-сигнал (см. src/test/environment.ts).
      environment: './src/test/environment.ts',
      globals: false,
      setupFiles: ['./src/test/setup.ts'],
      // В jsdom fetch требует абсолютный URL; MSW резолвит относительные пути хендлеров
      // против того же origin, поэтому значения должны совпадать.
      environmentOptions: { jsdom: { url: 'http://localhost:3000' } },
      env: { VITE_API_BASE_URL: 'http://localhost:3000' },
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/api/openapi.d.ts', 'src/test/**', 'src/main.tsx'],
      },
    },
  };
});
