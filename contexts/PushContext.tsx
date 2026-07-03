'use client';

import {
  createContext, useContext, useEffect, useState, useCallback, ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

interface PushContextValue {
  permission: NotificationPermission | 'unsupported';
  subscription: PushSubscription | null;
  requesting: boolean;
  enable: () => Promise<void>;
  sendPush: (title: string, body: string, url?: string) => Promise<void>;
}

const PushContext = createContext<PushContextValue | null>(null);

export function usePush() {
  const ctx = useContext(PushContext);
  if (!ctx) throw new Error('usePush must be used inside PushProvider');
  return ctx;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function PushProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [swReg, setSwReg] = useState<ServiceWorkerRegistration | null>(null);

  // Register service worker once
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    setPermission('Notification' in window ? Notification.permission : 'unsupported');

    navigator.serviceWorker.register('/sw.js').then(reg => {
      setSwReg(reg);
      return reg.pushManager.getSubscription();
    }).then(sub => {
      if (sub) setSubscription(sub);
    }).catch(() => {/* sw registration failed silently */});
  }, []);

  // Restore stored subscription from Firestore when user loads
  useEffect(() => {
    if (!user || subscription) return;
    getDoc(doc(db, 'users', user.uid, 'settings', 'push_subscription')).then(snap => {
      if (snap.exists()) {
        // We already have a subscription stored; the SW will have it too
        // No need to re-subscribe unless SW was cleared
      }
    });
  }, [user, subscription]);

  const enable = useCallback(async () => {
    if (!('Notification' in window) || !swReg) return;
    setRequesting(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return;

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
      const sub = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as ArrayBuffer,
      });
      setSubscription(sub);

      // Persist subscription in Firestore
      if (user) {
        await setDoc(
          doc(db, 'users', user.uid, 'settings', 'push_subscription'),
          JSON.parse(JSON.stringify(sub)),
        );
      }
    } finally {
      setRequesting(false);
    }
  }, [swReg, user]);

  const sendPush = useCallback(async (title: string, body: string, url?: string) => {
    if (!subscription) return;
    try {
      const res = await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription, title, body, url }),
      });
      if (res.status === 410) {
        // Subscription expired — clear it
        setSubscription(null);
        if (user) {
          await setDoc(doc(db, 'users', user.uid, 'settings', 'push_subscription'), {});
        }
      }
    } catch {
      // Push failures are non-fatal
    }
  }, [subscription, user]);

  return (
    <PushContext.Provider value={{ permission, subscription, requesting, enable, sendPush }}>
      {children}
    </PushContext.Provider>
  );
}
