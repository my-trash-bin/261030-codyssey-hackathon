import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('UI 계약 위반: #root를 찾을 수 없습니다.');
createRoot(root).render(<App />);
