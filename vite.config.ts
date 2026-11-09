import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SHA del commit que expone el hosting durante el build (Vercel, Netlify o Cloudflare Pages).
const sha =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_REF ?? process.env.CF_PAGES_COMMIT_SHA ?? '';
const build = /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : 'dev';

export default defineConfig({
  plugins: [react()],
  define: { __LUMON_BUILD__: JSON.stringify(build) },
});
