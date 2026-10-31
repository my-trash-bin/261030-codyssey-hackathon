import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

// Vite 7의 devHtmlHook은 server.hmr 값과 무관하게 /@vite/client 스크립트 태그를 주입하고,
// 그 클라이언트는 HMR WebSocket 연결을 시도한다. fixture 화면도 같은 CSP 경계를 쓰므로
// 개발 HTML에서 이 태그를 걷어낸다. 편집 뒤에는 브라우저를 새로고침한다.
function stripViteClient(): Plugin {
  return {
    name: 'safehandoff-strip-vite-client',
    apply: 'serve',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/<script\b[^>]*\bsrc="\/@vite\/client"[^>]*><\/script>\s*/g, '');
      },
    },
  };
}

// 연출 화면은 두 엔트리를 함께 빌드한다.
export default defineConfig({
  plugins: [stripViteClient()],
  build: {
    outDir: 'dist/static',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        demo: fileURLToPath(new URL('index.html', import.meta.url)),
        presentation: fileURLToPath(new URL('presentation.html', import.meta.url)),
      },
    },
  },
});
