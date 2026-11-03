import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { thisMonth } from './format';
import type { Tx } from './db';
import type { TxType } from './categories';

export type Route = 'home' | 'stats' | 'settings' | 'scan';

function readRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return h === 'stats' || h === 'settings' || h === 'scan' ? h : 'home';
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(route: Route) {
  const hash = route === 'home' ? '#/' : `#/${route}`;
  if (location.hash !== hash) location.hash = hash;
}

// Files picked for scanning are handed to the scan page through memory.
let pending: File[] = [];
export function takePendingFiles(): File[] {
  const f = pending;
  pending = [];
  return f;
}

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export type EditorTarget = { tx: Tx } | { newType: TxType } | null;

interface AppCtx {
  month: string;
  setMonth: (m: string) => void;
  editor: EditorTarget;
  openEditor: (t: EditorTarget) => void;
  toast: (text: string, action?: Toast['action']) => void;
  pickSlips: () => void;
  startScan: (files: File[]) => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [month, setMonth] = useState(thisMonth);
  const [editor, openEditor] = useState<EditorTarget>(null);
  const [toastState, setToast] = useState<Toast | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const toast = useCallback((text: string, action?: Toast['action']) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, action });
    timer.current = window.setTimeout(() => setToast(null), action ? 6000 : 3200);
  }, []);

  const startScan = useCallback((files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif)$/i.test(f.name));
    if (!images.length) return;
    pending = images;
    if (readRoute() === 'scan') window.dispatchEvent(new Event('jodwai:files'));
    else go('scan');
  }, []);

  const pickSlips = useCallback(() => inputRef.current?.click(), []);

  return (
    <Ctx.Provider value={{ month, setMonth, editor, openEditor, toast, pickSlips, startScan }}>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="slip-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          startScan(files);
        }}
      />
      {toastState && (
        <div className="toast" role="status" key={toastState.id}>
          <span>{toastState.text}</span>
          {toastState.action && (
            <button
              onClick={() => {
                toastState.action!.run();
                setToast(null);
              }}
            >
              {toastState.action.label}
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}
