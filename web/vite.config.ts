import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const localConfigPath = path.resolve(rootDir, 'agu.config.local.json');
const configEndpoint = '/__agu_local_config__';

function aguLocalConfigPlugin(): Plugin {
  const serveLocalConfig = (_req: IncomingMessage, res: ServerResponse) => {
    if (!fs.existsSync(localConfigPath)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    fs.createReadStream(localConfigPath).pipe(res);
  };

  return {
    name: 'agu-local-config',
    configureServer(server) {
      server.middlewares.use(configEndpoint, serveLocalConfig);
    },
    configurePreviewServer(server) {
      server.middlewares.use(configEndpoint, serveLocalConfig);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [vue(), aguLocalConfigPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: process.env.AGU_DESKTOP === '1',
    open: process.env.AGU_DESKTOP !== '1',
  },
});
