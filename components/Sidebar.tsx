'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  Droplet, Film, HeartPulse, Home, Sparkles, BookOpen, Pill,
  LogOut, Calendar, Trophy, Target, Camera, KeyRound, X, Check,
  Footprints, GraduationCap, Menu, Wind,
} from 'lucide-react';
import { updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/contexts/AuthContext';

const navItems = [
  { label: 'Dashboard',        href: '/',          icon: Home },
  { label: 'Passos e Distância', href: '/passos',   icon: Footprints },
  { label: 'Exercícios',        href: '/exercicios', icon: HeartPulse },
  { label: 'Leitura',           href: '/leitura',    icon: BookOpen },
  { label: 'Estudo',            href: '/estudo',     icon: GraduationCap },
  { label: 'Meditação',         href: '/meditacao',  icon: Wind },
  { label: 'Filmes',            href: '/filmes',     icon: Film },
  { label: 'Hidratação',        href: '/hidratacao', icon: Droplet },
  { label: 'Creatina',          href: '/creatina',   icon: Pill },
  { label: 'Calendário',        href: '/calendario', icon: Calendar },
  { label: 'Recordes',          href: '/recordes',   icon: Trophy },
];

// Bottom bar shows 4 primary items + Menu button
const primaryNav = [
  { label: 'Início',      href: '/',           icon: Home },
  { label: 'Passos',      href: '/passos',      icon: Footprints },
  { label: 'Exercícios',  href: '/exercicios',  icon: HeartPulse },
  { label: 'Leitura',     href: '/leitura',     icon: BookOpen },
];

export default function Sidebar() {
  const { logout, user } = useAuth();
  const pathname = usePathname();

  // desktop profile dropdown
  const [menuOpen,      setMenuOpen]      = useState(false);
  const [passwordMode,  setPasswordMode]  = useState(false);
  const [currentPw,     setCurrentPw]     = useState('');
  const [newPw,         setNewPw]         = useState('');
  const [pwStatus,      setPwStatus]      = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [pwError,       setPwError]       = useState('');
  const [uploading,     setUploading]     = useState(false);
  const [photoURL,      setPhotoURL]      = useState(user?.photoURL ?? null);

  // mobile drawer
  const [mobileOpen, setMobileOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // close desktop dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setPasswordMode(false);
      }
    };
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  // lock body scroll when mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const storage = getStorage();
      const fileRef = storageRef(storage, `avatars/${user.uid}`);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      await updateProfile(user, { photoURL: url });
      setPhotoURL(url);
      setMenuOpen(false);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePasswordChange = async () => {
    if (!user?.email || !currentPw || !newPw) return;
    setPwStatus('loading');
    setPwError('');
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPw);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPw);
      setPwStatus('ok');
      setTimeout(() => {
        setPwStatus('idle');
        setPasswordMode(false);
        setCurrentPw('');
        setNewPw('');
        setMenuOpen(false);
      }, 1500);
    } catch (err: unknown) {
      setPwStatus('error');
      const code = (err as { code?: string }).code;
      setPwError(code === 'auth/wrong-password' ? 'Senha atual incorreta' : 'Erro ao alterar senha');
    }
  };

  function isActive(href: string) {
    return href === '/' ? pathname === '/' : pathname.startsWith(href);
  }

  return (
    <>
      {/* ── Desktop sidebar ──────────────────────────────────────────────── */}
      <aside className="hidden w-[320px] shrink-0 flex-col rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl md:flex">
        <div ref={containerRef} className="relative mb-10 flex items-center gap-4">
          <button
            onClick={() => { setMenuOpen((v) => !v); setPasswordMode(false); }}
            className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-tamagochi-500 via-tamagochi-400 to-tamagochi-300 text-slate-950 shadow-lg transition hover:opacity-90"
          >
            {photoURL ? (
              <Image src={photoURL} alt="avatar" fill className="object-cover" />
            ) : (
              <Sparkles size={24} />
            )}
          </button>
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-tamagochi-300">Tamagochi Me</p>
          </div>

          {menuOpen && (
            <div className="absolute left-0 top-[4.5rem] z-50 w-60 rounded-2xl border border-white/10 bg-[#0d1b2a] p-3 shadow-xl">
              {!passwordMode ? (
                <>
                  <Link
                    href="/metas"
                    onClick={() => setMenuOpen(false)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-200 transition hover:bg-white/10"
                  >
                    <Target size={16} className="text-tamagochi-300" />
                    Metas
                  </Link>
                  <div className="my-1 border-t border-white/10" />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-200 transition hover:bg-white/10"
                  >
                    <Camera size={16} className="text-tamagochi-300" />
                    {uploading ? 'Enviando…' : 'Alterar foto'}
                  </button>
                  <button
                    onClick={() => setPasswordMode(true)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-200 transition hover:bg-white/10"
                  >
                    <KeyRound size={16} className="text-tamagochi-300" />
                    Alterar senha
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                </>
              ) : (
                <div className="space-y-2 px-1">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-widest text-tamagochi-300">Alterar senha</span>
                    <button onClick={() => setPasswordMode(false)} className="text-slate-400 transition hover:text-white">
                      <X size={14} />
                    </button>
                  </div>
                  <input
                    type="password"
                    placeholder="Senha atual"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-tamagochi-500/50"
                  />
                  <input
                    type="password"
                    placeholder="Nova senha"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-tamagochi-500/50"
                  />
                  {pwError && <p className="text-xs text-red-400">{pwError}</p>}
                  <button
                    onClick={handlePasswordChange}
                    disabled={pwStatus === 'loading' || pwStatus === 'ok'}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-tamagochi-500/30 bg-tamagochi-500/20 py-2 text-sm font-medium text-tamagochi-300 transition hover:bg-tamagochi-500/30"
                  >
                    {pwStatus === 'loading' ? 'Salvando…' : pwStatus === 'ok' ? <><Check size={14} /> Salvo!</> : 'Salvar'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-3xl border px-4 py-3 text-sm font-medium transition ${
                  active
                    ? 'border-tamagochi-500/30 bg-tamagochi-500/10 text-tamagochi-300'
                    : 'border-transparent text-slate-200 hover:border-tamagochi-500/30 hover:bg-white/10'
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-3xl border border-transparent px-4 py-3 text-sm font-medium text-red-400 transition hover:border-red-500/30 hover:bg-red-500/10"
          >
            <LogOut size={18} />
            Sair
          </button>
        </nav>
      </aside>

      {/* ── Mobile bottom bar ────────────────────────────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t border-white/10 bg-[#08101a]/95 backdrop-blur-xl">
        <div className="flex items-center justify-around px-1 pt-2 pb-3">
          {primaryNav.map(({ label, href, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link key={href} href={href}
                className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-2xl transition ${
                  active ? 'text-tamagochi-300' : 'text-slate-500 hover:text-slate-300'
                }`}>
                <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
                <span className="text-[10px] font-medium">{label}</span>
              </Link>
            );
          })}

          {/* Menu button */}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-2xl text-slate-500 hover:text-slate-300 transition">
            <Menu size={22} strokeWidth={1.8} />
            <span className="text-[10px] font-medium">Menu</span>
          </button>
        </div>
      </div>

      {/* ── Mobile drawer ────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />

          {/* Sheet */}
          <div className="absolute bottom-0 left-0 right-0 rounded-t-[2rem] border-t border-white/10 bg-[#0d1b2a] shadow-2xl">
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-white/20" />
            </div>

            {/* Profile row */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5">
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-tamagochi-500 via-tamagochi-400 to-tamagochi-300">
                {photoURL
                  ? <Image src={photoURL} alt="avatar" fill className="object-cover" />
                  : <Sparkles size={18} className="absolute inset-0 m-auto text-slate-950" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user?.displayName ?? user?.email ?? 'Usuário'}</p>
                <p className="text-xs text-slate-500 truncate uppercase tracking-widest">Tamagochi Me</p>
              </div>
              <button onClick={() => setMobileOpen(false)}
                className="text-slate-500 hover:text-white transition p-1">
                <X size={18} />
              </button>
            </div>

            {/* Nav grid */}
            <div className="grid grid-cols-4 gap-1 p-4">
              {navItems.map(({ label, href, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link key={href} href={href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center transition ${
                      active
                        ? 'bg-tamagochi-500/15 text-tamagochi-300 border border-tamagochi-500/30'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
                    }`}>
                    <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
                    <span className="text-[10px] font-medium leading-tight">{label}</span>
                  </Link>
                );
              })}
            </div>

            {/* Footer actions */}
            <div className="flex gap-3 border-t border-white/5 px-4 py-3 pb-6">
              <Link href="/metas"
                onClick={() => setMobileOpen(false)}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10">
                <Target size={16} />
                Metas
              </Link>
              <button onClick={() => { setMobileOpen(false); logout(); }}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 py-2.5 text-sm font-medium text-red-400 transition hover:bg-red-500/20">
                <LogOut size={16} />
                Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
