'use client';

import Sidebar from '@/components/Sidebar';
import { Calendar, ChevronLeft, ChevronRight, Sparkles, Zap, Flame } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

export default function CalendarioPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<Record<string, any>>({});
  const META_DIARIA = 2000;

  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const dataAtual = new Date();
  const anoAtual = dataAtual.getFullYear();
  const mesAtual = dataAtual.getMonth();

  useEffect(() => {
    if (!user) return;
    
    const fetchLogs = async () => {
      try {
        const logsRef = collection(db, 'users', user.uid, 'daily_logs');
        const snap = await getDocs(logsRef);
        const data: Record<string, any> = {};
        snap.forEach(doc => {
          data[doc.id] = doc.data();
        });
        setLogs(data);
      } catch (error) {
        console.error("Erro ao buscar logs do calendário:", error);
      }
    };
    
    fetchLogs();
  }, [user]);

  const diasDaSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  
  // Lógica para montar o calendário do mês atual
  const primeiroDiaDoMes = new Date(anoAtual, mesAtual, 1).getDay(); // 0 a 6
  const totalDiasDoMes = new Date(anoAtual, mesAtual + 1, 0).getDate();
  const totalCelulas = Math.ceil((primeiroDiaDoMes + totalDiasDoMes) / 7) * 7; // Múltiplo de 7

  const diasDoMes = Array.from({ length: totalCelulas }).map((_, index) => {
    const diaReal = index - primeiroDiaDoMes + 1;
    const isCurrentMonth = diaReal > 0 && diaReal <= totalDiasDoMes;
    const dia = isCurrentMonth ? diaReal : '';
    
    let energia = null;
    
    if (isCurrentMonth) {
      // Formata a data para YYYY-MM-DD local
      const mesStr = String(mesAtual + 1).padStart(2, '0');
      const diaStr = String(diaReal).padStart(2, '0');
      const dateStr = `${anoAtual}-${mesStr}-${diaStr}`;
      
      if (logs[dateStr]) {
        const water = logs[dateStr].water_ml || 0;
        energia = Math.min((water / META_DIARIA) * 100, 100);
      }
    }

    return { dia, isCurrentMonth, energia };
  });

  const getEnergyColor = (energia: number | null) => {
    if (energia === null) return 'bg-slate-900/40 border-white/5';
    if (energia >= 80) return 'bg-gradient-to-br from-tamagochi-400 to-tamagochi-600 border-tamagochi-400/50 text-slate-950 shadow-[0_0_15px_rgba(56,189,248,0.3)]';
    if (energia >= 50) return 'bg-white/10 border-white/20 text-white';
    return 'bg-red-500/10 border-red-500/20 text-red-200';
  };

  // Calcular sequência atual baseada nos últimos dias
  let sequencia = 0;
  let dataCheck = new Date(); // Começa por hoje
  
  while(true) {
    const ano = dataCheck.getFullYear();
    const mes = String(dataCheck.getMonth() + 1).padStart(2, '0');
    const dia = String(dataCheck.getDate()).padStart(2, '0');
    const dateStr = `${ano}-${mes}-${dia}`;
    
    // Se o dia não existe no log e não for hoje (talvez hoje não bebeu nada ainda), quebra a sequência
    if (logs[dateStr]) {
       const w = logs[dateStr].water_ml || 0;
       if (w >= META_DIARIA) {
         sequencia++;
         dataCheck.setDate(dataCheck.getDate() - 1);
       } else {
         break;
       }
    } else {
       // Permite que o dia de "hoje" ainda não esteja na meta sem quebrar a sequência anterior
       const isToday = dateStr === `${anoAtual}-${String(mesAtual+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`;
       if (isToday) {
         dataCheck.setDate(dataCheck.getDate() - 1);
       } else {
         break;
       }
    }
  }

  return (
    <main className="min-h-screen bg-[#08101a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Sidebar />
        
        <section className="flex-1 space-y-6">
          <header className="flex flex-col items-start justify-between gap-4 rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-glow backdrop-blur-xl sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-3">
                <Calendar className="text-tamagochi-300" size={28} />
                <h1 className="text-3xl font-semibold text-white">Histórico e Calendário</h1>
              </div>
              <p className="mt-2 text-slate-400">Acompanhe a sua evolução diária e o nível de energia do seu Tamagochi ao longo do tempo.</p>
            </div>
            
            <div className="flex items-center gap-4 rounded-3xl bg-slate-900/80 px-4 py-2 border border-white/5">
              <button className="rounded-full p-2 hover:bg-white/10 transition"><ChevronLeft size={20} /></button>
              <span className="font-medium text-white">{meses[mesAtual]} {anoAtual}</span>
              <button className="rounded-full p-2 hover:bg-white/10 transition"><ChevronRight size={20} /></button>
            </div>
          </header>

          <div className="grid gap-6 xl:grid-cols-[1fr_350px]">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-glow backdrop-blur-xl">
              <div className="grid grid-cols-7 gap-4 mb-4">
                {diasDaSemana.map((dia) => (
                  <div key={dia} className="text-center text-sm font-medium uppercase tracking-wider text-slate-500">
                    {dia}
                  </div>
                ))}
              </div>
              
              <div className="grid grid-cols-7 gap-4">
                {diasDoMes.map((item, i) => (
                  <div 
                    key={i} 
                    className={`group relative flex h-24 flex-col justify-between rounded-2xl border p-3 transition-transform hover:scale-105 ${getEnergyColor(item.energia)}`}
                  >
                    <span className="text-sm font-semibold opacity-80">{item.dia}</span>
                    
                    {item.energia !== null && (
                      <div className="flex items-center gap-1">
                        <Zap size={14} className={item.energia >= 80 ? 'text-slate-950' : 'text-tamagochi-300'} />
                        <span className="text-xs font-bold">{item.energia.toFixed(0)}%</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <aside className="space-y-6">
              <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-tamagochi-900/40 to-slate-900/60 p-6 shadow-glow backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-6">
                  <Flame className="text-orange-400" size={24} />
                  <h2 className="text-xl font-semibold text-white">Sequência Perfeita</h2>
                </div>
                
                <div className="text-center">
                  <p className="text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-tamagochi-300">
                    {sequencia} <span className="text-2xl text-slate-400">dias</span>
                  </p>
                  <p className="mt-4 text-sm text-slate-400">Batendo a meta diária (2L). Você está indo muito bem! Continue atingindo suas metas para não perder o combo.</p>
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
                <h3 className="text-sm uppercase tracking-widest text-slate-400 mb-4">Legenda de Energia</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 rounded-full bg-gradient-to-br from-tamagochi-400 to-tamagochi-600 shadow-[0_0_10px_rgba(56,189,248,0.5)]"></div>
                    <span className="text-sm text-slate-300">Excelente (+80%)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 rounded-full bg-white/20 border border-white/30"></div>
                    <span className="text-sm text-slate-300">Regular (50% - 79%)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 rounded-full bg-red-500/20 border border-red-500/30"></div>
                    <span className="text-sm text-slate-300">Baixa (Menos de 50%)</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
