'use client';

import { useAuth } from '@/contexts/AuthContext';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';

export default function LoginPage() {
  const { loginWithEmail, registerWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Preencha todos os campos.');
      return;
    }

    try {
      if (isRegistering) {
        await registerWithEmail(email, password);
      } else {
        await loginWithEmail(email, password);
      }
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('E-mail ou senha incorretos.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('Este e-mail já está em uso.');
      } else if (err.code === 'auth/weak-password') {
        setError('A senha deve ter pelo menos 6 caracteres.');
      } else if (err.code === 'auth/operation-not-allowed') {
        setError('O login por E-mail e Senha não foi ativado no painel do Firebase.');
      } else if (err.code === 'auth/unauthorized-domain') {
        setError('Este domínio não está autorizado no painel do Firebase Authentication.');
      } else if (err.code === 'auth/invalid-email') {
        setError('O formato do e-mail é inválido.');
      } else {
        // Mostra o erro real do Firebase para ajudar a descobrir o problema
        setError(`Erro inesperado: ${err.message || err.code}`);
      }
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#08101a] p-4 text-slate-100">
      <div className="w-full max-w-md space-y-8 rounded-[2.5rem] border border-white/10 bg-white/5 p-10 shadow-glow backdrop-blur-xl sm:p-12">
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-[2rem] bg-gradient-to-br from-tamagochi-300 to-tamagochi-500 shadow-lg">
            <Sparkles size={36} className="text-slate-950" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Tamagochi Me
          </h1>
          <p className="mt-4 text-sm text-slate-400 sm:text-base">
            Faça login para acessar o seu painel pessoal de hábitos e saúde.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="space-y-4">
            <div>
              <label className="sr-only" htmlFor="email">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Seu e-mail"
                className="w-full rounded-2xl border border-white/10 bg-slate-900/50 px-5 py-4 text-white placeholder-slate-400 focus:border-tamagochi-300 focus:outline-none focus:ring-1 focus:ring-tamagochi-300"
              />
            </div>
            <div>
              <label className="sr-only" htmlFor="password">
                Senha
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Sua senha"
                className="w-full rounded-2xl border border-white/10 bg-slate-900/50 px-5 py-4 text-white placeholder-slate-400 focus:border-tamagochi-300 focus:outline-none focus:ring-1 focus:ring-tamagochi-300"
              />
            </div>
          </div>

          {error && <p className="text-sm font-medium text-red-400 text-center">{error}</p>}

          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-full bg-gradient-to-r from-tamagochi-400 to-tamagochi-500 px-6 py-4 text-sm font-semibold text-slate-950 transition-all hover:opacity-90 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-tamagochi-300/20 active:scale-95"
          >
            {isRegistering ? 'Criar conta' : 'Entrar'}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-slate-400">
          {isRegistering ? 'Já tem uma conta?' : 'Não tem uma conta?'}{' '}
          <button
            onClick={() => {
              setIsRegistering(!isRegistering);
              setError('');
            }}
            className="font-semibold text-tamagochi-300 hover:text-tamagochi-200"
          >
            {isRegistering ? 'Fazer login' : 'Criar agora'}
          </button>
        </div>
      </div>
    </main>
  );
}
