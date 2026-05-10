'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Droplet, Film, HeartPulse, Home, Sparkles, BookOpen, Pill, LogOut, Calendar, Trophy, Target, Camera, KeyRound, X, Check, Footprints, GraduationCap } from 'lucide-react';
import { updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/contexts/AuthContext';

const navItems = [
  { label: 'Dashboard', href: '/', icon: Home },
  { label: 'Passos e Distância', href: '/passos', icon: Footprints },
  { label: 'Exercícios', href: '/exercicios', icon: HeartPulse },
  { label: 'Leitura', href: '/leitura', icon: BookOpen },
  { label: 'Estudo', href: '/estudo', icon: GraduationCap },
  { label: 'Filmes', href: '/filmes', icon: Film },
  { label: 'Hidratação', href: '/hidratacao', icon: Droplet },
  { label: 'Creatina', href: '/creatina', icon: Pill },
  { label: 'Calendário', href: '/calendario', icon: Calendar },
  { label: 'Recordes', href: '/recordes', icon: Trophy },
];

export default function Sidebar() {
  const { logout, user } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordMode, setPasswordMode] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwStatus, setPwStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [pwError, setPwError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoURL, setPhotoURL] = useState(user?.photoURL ?? null);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
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
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-3xl border border-transparent px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-tamagochi-500/30 hover:bg-white/10"
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
  );
}
