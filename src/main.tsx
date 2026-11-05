import { createRoot } from 'react-dom/client';
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/700.css';
import '@fontsource/golos-text/800.css';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);

// офлайн-режим для веб-версии (на iOS/Android/десктопе файлы и так локальные)
if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.hostname.includes('localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

if (import.meta.env.DEV) {
  void Promise.all([import('./store'), import('./actions')]).then(([s, a]) => {
    (window as unknown as Record<string, unknown>).__sn = { ...s, ...a };
  });
}
