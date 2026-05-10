'use client';

import Sidebar from '@/components/Sidebar';
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { doc, setDoc, increment, onSnapshot } from 'firebase/firestore';
import { Droplet, CheckCircle2, History, Plus } from 'lucide-react';

export default function HidratacaoPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [showPassado, setShowPassado] = useState(false);
  
  // Real-time data
  const [waterToday, setWaterToday] = useState(0);
  const META_DIARIA = 2000;
  
  // Campos para inserção no passado
  const [mlPassado, setMlPassado] = useState('500');
  const [dataPassada, setDataPassada] = useState('');

  // Retorna a data de hoje no formato YYYY-MM-DD local
  const getTodayStr = () => {
    const today = new Date();
    const ano = today.getFullYear();
    const mes = String(today.getMonth() + 1).padStart(2, '0');
    const dia = String(today.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  };

  useEffect(() => {
    if (!user) return;
    
    // Escuta as mudanças no documento de hoje em tempo real
    const logRef = doc(db, 'users', user.uid, 'daily_logs', getTodayStr());
    const unsubscribe = onSnapshot(logRef, (docSnap) => {
      if (docSnap.exists()) {
        setWaterToday(docSnap.data().water_ml || 0);
      } else {
        setWaterToday(0);
      }
    });

    return () => unsubscribe();
  }, [user]);

  const addWater = async (ml: number, targetDateStr: string) => {
    if (!user) {
      setMensagem('Você precisa estar logado para gravar dados.');
      return;
    }
    
    setLoading(true);
    setMensagem('');
    
    try {
      const logRef = doc(db, 'users', user.uid, 'daily_logs', targetDateStr);
      
      await setDoc(logRef, {
        water_ml: increment(ml),
        updatedAt: new Date()
      }, { merge: true });

      setMensagem(`🎉 Sucesso! ${ml}ml adicionados para o dia ${targetDateStr.split('-').reverse().join('/')}.`);
      
      if (targetDateStr !== getTodayStr()) {
        setDataPassada('');
        setMlPassado('500');
        setShowPassado(false);
      }

      setTimeout(() => setMensagem(''), 6000);
    } catch (error) {
      console.error("Erro ao salvar água:", error);
      setMensagem('❌ Erro ao salvar. Verifique as regras do Firebase.');
    } finally {
      setLoading(false);
    }
  };

  const handlePassadoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dataPassada || !mlPassado) return;
    addWater(Number(mlPassado), dataPassada);
  };

  const botoesRapidos = [
    { label: 'Copo pequeno', ml: 250 },
    { label: 'Copo grande', ml: 500 },
    { label: 'Garrafa', ml: 750 },
    { label: 'Garrafa grande', ml: 1000 },
  ];

  const porcentagem = Math.min((waterToday / META_DIARIA) * 100, 100);

  return (
    <main className="min-h-screen bg-[#08101a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Sidebar />
        
        <section className="flex-1 space-y-6">
          <header className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-glow backdrop-blur-xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <Droplet className="text-blue-400" size={32} />
                  <h1 className="text-3xl font-semibold text-white">Hidratação</h1>
                </div>
                <p className="max-w-2xl text-slate-400">Registre rapidamente a quantidade de água que você bebeu. A hidratação é a base da sua energia!</p>
              </div>

              <div className="rounded-3xl bg-slate-900/60 p-5 min-w-[250px] border border-white/5">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-sm font-medium text-slate-400">Progresso de Hoje</span>
                  <span className="text-xl font-bold text-blue-400">{waterToday} / {META_DIARIA} ml</span>
                </div>
                <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500 ease-out"
                    style={{ width: `${porcentagem}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </header>

          {mensagem && (
            <div className={`flex items-center gap-3 rounded-2xl p-4 font-medium backdrop-blur-xl ${mensagem.includes('Erro') ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-tamagochi-500/10 border border-tamagochi-500/20 text-tamagochi-300'}`}>
              <CheckCircle2 size={20} />
              {mensagem}
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-glow backdrop-blur-xl">
              <h2 className="text-xl font-semibold text-white mb-6">Adicionar Hoje</h2>
              
              <div className="grid grid-cols-2 gap-4">
                {botoesRapidos.map((btn) => (
                  <button
                    key={btn.ml}
                    onClick={() => addWater(btn.ml, getTodayStr())}
                    disabled={loading}
                    className="group relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-3xl border border-white/10 bg-slate-900/50 p-6 transition hover:border-blue-500/30 hover:bg-blue-900/20 disabled:opacity-50"
                  >
                    <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-blue-500/20 blur-2xl transition group-hover:bg-blue-400/30"></div>
                    <Droplet className="text-blue-400 transition group-hover:scale-110" size={28} />
                    <div>
                      <p className="text-2xl font-bold text-white">+{btn.ml}</p>
                      <p className="text-xs font-medium text-slate-400">ml</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <button 
                onClick={() => setShowPassado(!showPassado)}
                className="flex items-center justify-between rounded-[2rem] border border-white/10 bg-slate-900/60 p-6 transition hover:bg-white/5"
              >
                <div className="flex items-center gap-3">
                  <History className="text-slate-400" size={24} />
                  <div className="text-left">
                    <h3 className="font-semibold text-white">Esqueceu de registrar?</h3>
                    <p className="text-sm text-slate-400">Adicione água a um dia anterior</p>
                  </div>
                </div>
                <Plus className={`text-slate-400 transition-transform ${showPassado ? 'rotate-45' : ''}`} size={24} />
              </button>

              {showPassado && (
                <form onSubmit={handlePassadoSubmit} className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-glow backdrop-blur-xl animate-in slide-in-from-top-4 fade-in duration-300">
                  <h3 className="text-lg font-semibold text-white mb-6">Registro Retroativo</h3>
                  
                  <div className="space-y-5">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-300">Data do consumo</label>
                      <input 
                        type="date" 
                        required
                        max={getTodayStr()}
                        value={dataPassada}
                        onChange={(e) => setDataPassada(e.target.value)}
                        className="w-full rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3 text-white focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                    
                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-300">Quantidade (ml)</label>
                      <input 
                        type="number" 
                        required
                        min="50"
                        step="50"
                        value={mlPassado}
                        onChange={(e) => setMlPassado(e.target.value)}
                        className="w-full rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3 text-white focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>

                    <button 
                      type="submit"
                      disabled={loading}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 py-3 font-semibold text-white transition hover:bg-blue-600 disabled:opacity-50"
                    >
                      <History size={18} />
                      Salvar no Histórico
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
