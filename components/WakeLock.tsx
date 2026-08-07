'use client';

import { useEffect } from 'react';

// Mantem a tela ligada enquanto o app estiver aberto e visivel (modo vitrine).
// Reobtem o lock ao voltar do background. Silencioso se o navegador nao suportar.
export default function WakeLock() {
  useEffect(() => {
    let sentinel: { release: () => Promise<void> } | null = null;

    const request = async () => {
      try {
        const nav = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof sentinel> } };
        if (nav.wakeLock && document.visibilityState === 'visible') {
          sentinel = await nav.wakeLock.request('screen');
        }
      } catch {
        /* usuario negou, bateria baixa, ou nao suportado — ignora */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') request();
    };

    request();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release().catch(() => {});
    };
  }, []);

  return null;
}
