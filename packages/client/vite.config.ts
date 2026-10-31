import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// @vitejs/plugin-react는 넣지 않는다. 개발 모드에서 인라인 스크립트 프리앰블을 넣어
// CSP script-src 'self'를 깨뜨린다. JSX는 tsconfig의 jsx: react-jsx를 읽는 esbuild가 처리한다.
//
// Vite 7의 devHtmlHook은 server.hmr 값과 무관하게 /@vite/client 스크립트 태그를 주입하고,
// 그 클라이언트는 HMR WebSocket 연결을 시도한다. CSP를 완화하지 않으려면 개발 HTML에서
// 이 태그를 걷어내야 한다. 자동 갱신이 없으므로 편집 뒤에는 브라우저를 새로고침한다.
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

export default defineConfig({
  plugins: [stripViteClient()],
  build: { outDir: 'dist/static', emptyOutDir: true },
});
