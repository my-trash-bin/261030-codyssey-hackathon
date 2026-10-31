import { createRoot } from 'react-dom/client';
import { DesignSystemPage } from './design/DesignSystemPage.tsx';
import { App } from './ui/App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('UI 계약 위반: #root를 찾을 수 없습니다.');

// 디자인 시스템 화면은 같은 번들의 별도 경로로 둔다. 해시라서 정적 서버 설정이 필요 없다.
const designSystem = window.location.hash === '#design-system';
createRoot(root).render(designSystem ? <DesignSystemPage /> : <App />);
