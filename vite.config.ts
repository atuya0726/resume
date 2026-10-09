import { defineConfig } from 'vite';
import { localSavePlugin } from './server/local-save.ts';

export default defineConfig({
  plugins: [localSavePlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Personal data must never reach the development server console.
    forwardConsole: false,
    watch: { ignored: ['**/public/profile.enc.json', '**/public/resume-content.json', '**/public/.local-resume-*.tmp'] },
    fs: { deny: ['.env', '.env.*', '**/private/**', '**/*.private.json', '**/*.pdf'] },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
