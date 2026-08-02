'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'install-prompt-dismissed';

export default function InstallPrompt() {
  const { user } = useAuth();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setVisible(false);
  };

  if (!user || !visible || !deferred) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 z-40 mx-auto flex max-w-sm items-center gap-3 rounded-2xl border border-white/10 bg-[#0d1b2a] p-4 shadow-2xl md:bottom-6 md:left-6 md:right-auto">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tamagochi-500/15">
        <Download size={18} className="text-tamagochi-300" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">Instalar Tamagochi Me</p>
        <p className="text-xs text-slate-400">Acesso rápido direto da tela inicial</p>
      </div>
      <button
        onClick={install}
        className="shrink-0 rounded-xl border border-tamagochi-500/30 bg-tamagochi-500/20 px-3 py-2 text-xs font-semibold text-tamagochi-300 transition hover:bg-tamagochi-500/30"
      >
        Instalar
      </button>
      <button onClick={dismiss} aria-label="Dispensar" className="shrink-0 text-slate-500 transition hover:text-white">
        <X size={16} />
      </button>
    </div>
  );
}
