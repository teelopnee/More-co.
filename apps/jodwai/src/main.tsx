import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans-thai/thai-400.css';
import '@fontsource/ibm-plex-sans-thai/thai-500.css';
import '@fontsource/ibm-plex-sans-thai/thai-600.css';
import '@fontsource/ibm-plex-sans-thai/thai-700.css';
import '@fontsource/ibm-plex-sans-thai/latin-400.css';
import '@fontsource/ibm-plex-sans-thai/latin-500.css';
import '@fontsource/ibm-plex-sans-thai/latin-600.css';
import '@fontsource/ibm-plex-sans-thai/latin-700.css';
import './styles.css';
import { App } from './App';
import { initInstallPrompt } from './lib/install';

initInstallPrompt();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support + "new version available" prompt.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        const bar = document.createElement('div');
        bar.className = 'toast';
        bar.setAttribute('role', 'status');
        bar.innerHTML = '<span>มีเวอร์ชันใหม่ของจดไว</span>';
        const btn = document.createElement('button');
        btn.textContent = 'อัปเดต';
        btn.onclick = () => update(true);
        bar.appendChild(btn);
        document.body.appendChild(bar);
      },
    });
  });
}
