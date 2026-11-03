import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { AppProvider, go, useApp, useHashRoute, type Route } from './lib/app';
import { useSetting } from './lib/hooks';
import { takeSharedFiles } from './lib/shareInbox';
import { Brand } from './components/Brand';
import { IconChart, IconList, IconScan, IconSettings } from './components/Icons';
import { TxEditor } from './components/TxEditor';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';
import { Stats } from './pages/Stats';

// The slip reader (OCR + QR) is heavy; load it only when scanning.
const Scan = lazy(() => import('./pages/Scan').then((m) => ({ default: m.Scan })));

function useTheme() {
  const theme = useSetting<'system' | 'light' | 'dark'>('theme', 'system');
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1117' : '#f5f6fa');
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function Nav({ route }: { route: Route }) {
  const { pickSlips } = useApp();
  const link = (r: Route, label: string, icon: ReactNode) => (
    <a href={r === 'home' ? '#/' : `#/${r}`} aria-current={route === r ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
    </a>
  );
  return (
    <nav className="nav" aria-label="เมนูหลัก">
      <Brand />
      {link('home', 'รายการ', <IconList />)}
      <button className="scan-btn" onClick={pickSlips} data-testid="nav-scan">
        <span className="bubble">
          <IconScan />
        </span>
        <span>สแกนสลิป</span>
      </button>
      {link('stats', 'สรุป', <IconChart />)}
      {link('settings', 'ตั้งค่า', <IconSettings />)}
    </nav>
  );
}

function Shell() {
  const route = useHashRoute();
  const { editor, openEditor, startScan } = useApp();
  useTheme();

  // Pick up images shared from the gallery (Android share target).
  useEffect(() => {
    if (!location.hash.includes('shared=1')) return;
    history.replaceState(history.state, '', '#/scan');
    takeSharedFiles().then((files) => {
      if (files.length) startScan(files);
      else go('scan');
    });
  }, [route, startScan]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  return (
    <div className="app">
      <Nav route={route} />
      <main className="main">
        {route === 'home' && <Home />}
        {route === 'stats' && <Stats />}
        {route === 'settings' && <Settings />}
        {route === 'scan' && (
          <Suspense fallback={<div className="card empty"><span className="spin" /></div>}>
            <Scan />
          </Suspense>
        )}
      </main>
      {editor && (
        <TxEditor
          key={'tx' in editor ? editor.tx.id : 'new'}
          tx={'tx' in editor ? editor.tx : undefined}
          newType={'newType' in editor ? editor.newType : undefined}
          onClose={() => openEditor(null)}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
