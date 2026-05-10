import Sidebar from '@/components/Sidebar';
import {
  Trophy, Medal, Crown, Star, Target, Zap, HeartPulse, Droplet, Flame,
  BookOpen, Film, Pill, GraduationCap, Footprints, Sparkles, Brain,
  Dumbbell, Rocket, Coffee, Sun, Shield, Gem, Activity, Timer, Moon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Metric {
  id: string;
  label: string;
  icon: LucideIcon;
  cor: string;
  diario: string;
  semanal: string;
  mensal: string;
}

interface Trofeu {
  nome: string;
  req: string;
  cat: string;
  icon: LucideIcon;
  desbloqueado: boolean;
}

const metrics: Metric[] = [
  { id: 'passos',    label: 'Passos e Distância', icon: Footprints,    cor: 'text-emerald-400', diario: '0 km',    semanal: '0 km',    mensal: '0 km'   },
  { id: 'exercicio', label: 'Exercícios',          icon: HeartPulse,    cor: 'text-pink-400',    diario: '0 min',   semanal: '0 min',   mensal: '0 min'  },
  { id: 'hidra',     label: 'Hidratação',          icon: Droplet,       cor: 'text-blue-400',    diario: '0 copos', semanal: '0 L',     mensal: '0 L'    },
  { id: 'leitura',   label: 'Leitura',             icon: BookOpen,      cor: 'text-amber-400',   diario: '0 págs',  semanal: '0 págs',  mensal: '0 págs' },
  { id: 'estudo',    label: 'Estudo',              icon: GraduationCap, cor: 'text-violet-400',  diario: '0 h',     semanal: '0 h',     mensal: '0 h'    },
  { id: 'filmes',    label: 'Filmes',              icon: Film,          cor: 'text-orange-400',  diario: '0',       semanal: '0',       mensal: '0'      },
  { id: 'creatina',  label: 'Creatina',            icon: Pill,          cor: 'text-cyan-400',    diario: '0 dias',  semanal: '',        mensal: ''       },
  { id: 'streak',    label: 'Sequência Geral',     icon: Flame,         cor: 'text-red-400',     diario: '---',     semanal: '---',     mensal: '0 dias' },
];

const trofeus: Trofeu[] = [
  // Hidratação
  { nome: 'Fonte Eterna',      req: 'Beba 3L em um único dia',                        cat: 'Hidratação', icon: Droplet,       desbloqueado: false },
  { nome: 'Sereia do Cerrado', req: '7 dias seguidos com meta de água atingida',       cat: 'Hidratação', icon: Droplet,       desbloqueado: false },
  { nome: 'Rio Sem Fim',       req: '30 dias com meta de hidratação atingida',         cat: 'Hidratação', icon: Droplet,       desbloqueado: false },

  // Passos
  { nome: 'Nômade Digital',   req: 'Caminhe 10 km em um único dia',                   cat: 'Passos', icon: Footprints, desbloqueado: false },
  { nome: 'Pés de Vento',     req: '30 dias atingindo a meta de passos',               cat: 'Passos', icon: Footprints, desbloqueado: false },
  { nome: 'Explorador Nato',  req: '100 km acumulados em um único mês',                cat: 'Passos', icon: Rocket,     desbloqueado: false },
  { nome: 'Maratonista',      req: 'Complete 42 km em uma semana',                     cat: 'Passos', icon: Trophy,     desbloqueado: false },

  // Exercícios
  { nome: 'Ferro Frio',              req: 'Conclua um treino antes das 6h da manhã',   cat: 'Exercícios', icon: Dumbbell,   desbloqueado: false },
  { nome: 'Músculos de Titânio',     req: '30 treinos consecutivos registrados',        cat: 'Exercícios', icon: Shield,     desbloqueado: false },
  { nome: 'Guerreiro das Madrugadas',req: '10 treinos realizados antes das 7h',         cat: 'Exercícios', icon: Moon,       desbloqueado: false },
  { nome: 'Ferro Velho',             req: '365 treinos registrados no total',           cat: 'Exercícios', icon: Medal,      desbloqueado: false },

  // Leitura
  { nome: 'Devorando Páginas',   req: 'Leia 100 páginas em um único dia',              cat: 'Leitura', icon: BookOpen,  desbloqueado: false },
  { nome: 'Bibliófilo Assumido', req: 'Conclua 10 livros',                             cat: 'Leitura', icon: Crown,     desbloqueado: false },
  { nome: 'Worm de Papel',       req: '30 dias seguidos de leitura',                   cat: 'Leitura', icon: Star,      desbloqueado: false },
  { nome: 'Iluminado',           req: 'Conclua 50 livros ao longo da jornada',         cat: 'Leitura', icon: Sparkles,  desbloqueado: false },

  // Estudo
  { nome: 'Modo Neurofilo',    req: '8h de estudo em um único dia',                    cat: 'Estudo', icon: Brain,         desbloqueado: false },
  { nome: 'Algoritmo Humano',  req: '30 dias de estudo consecutivos',                  cat: 'Estudo', icon: GraduationCap, desbloqueado: false },
  { nome: 'Mestre Jedi',       req: '100h de estudo acumuladas',                       cat: 'Estudo', icon: Gem,           desbloqueado: false },
  { nome: 'Cérebro Overflow',  req: '500h de estudo no total',                         cat: 'Estudo', icon: Zap,           desbloqueado: false },

  // Filmes
  { nome: 'Cinéfilo de Plantão',   req: 'Assista 3 filmes em um único dia',            cat: 'Filmes', icon: Film,   desbloqueado: false },
  { nome: 'Crítico de Poltronagem',req: '50 filmes catalogados',                       cat: 'Filmes', icon: Star,   desbloqueado: false },
  { nome: 'Maratonista de Tela',   req: '24h de conteúdo assistido no total',          cat: 'Filmes', icon: Trophy, desbloqueado: false },

  // Creatina
  { nome: 'Suplementado', req: '30 dias seguidos tomando creatina',                    cat: 'Creatina', icon: Pill,     desbloqueado: false },
  { nome: 'Protocolado',  req: '90 dias no protocolo de creatina',                     cat: 'Creatina', icon: Activity, desbloqueado: false },

  // Geral
  { nome: 'Semana Imparável', req: '7 dias atingindo todas as metas diárias',          cat: 'Geral', icon: Zap,      desbloqueado: false },
  { nome: 'Mês Perfeito',     req: '30 dias sem falhar nenhuma meta',                  cat: 'Geral', icon: Star,     desbloqueado: false },
  { nome: 'Modo Deus',        req: '100 dias consecutivos com todas as metas',         cat: 'Geral', icon: Crown,    desbloqueado: false },
  { nome: 'Tamagochi Feliz',  req: 'Todas as métricas no verde por 3 dias seguidos',   cat: 'Geral', icon: Sparkles, desbloqueado: false },
  { nome: 'Primeiro Nível',   req: 'Registre sua primeira entrada em qualquer seção',  cat: 'Geral', icon: Target,   desbloqueado: false },
  { nome: 'Lendário',         req: 'Desbloqueie todas as outras conquistas',           cat: 'Geral', icon: Trophy,   desbloqueado: false },
  { nome: 'Manhãzeiro',       req: 'Complete todas as metas antes do meio-dia',        cat: 'Geral', icon: Sun,      desbloqueado: false },
  { nome: 'Cafeinado',        req: 'Registre atividade às 5h da manhã por 5 dias',    cat: 'Geral', icon: Coffee,   desbloqueado: false },
  { nome: 'Relógio Suíço',    req: 'Registre atividades todo dia por 14 dias seguidos',cat: 'Geral', icon: Timer,   desbloqueado: false },
];

const catStyle: Record<string, { border: string; bg: string; text: string; iconBg: string }> = {
  'Hidratação': { border: 'border-blue-500/25',    bg: 'bg-blue-500/10',    text: 'text-blue-300',    iconBg: 'bg-blue-500/20'    },
  'Passos':     { border: 'border-emerald-500/25', bg: 'bg-emerald-500/10', text: 'text-emerald-300', iconBg: 'bg-emerald-500/20' },
  'Exercícios': { border: 'border-pink-500/25',    bg: 'bg-pink-500/10',    text: 'text-pink-300',    iconBg: 'bg-pink-500/20'    },
  'Leitura':    { border: 'border-amber-500/25',   bg: 'bg-amber-500/10',   text: 'text-amber-300',   iconBg: 'bg-amber-500/20'   },
  'Estudo':     { border: 'border-violet-500/25',  bg: 'bg-violet-500/10',  text: 'text-violet-300',  iconBg: 'bg-violet-500/20'  },
  'Filmes':     { border: 'border-orange-500/25',  bg: 'bg-orange-500/10',  text: 'text-orange-300',  iconBg: 'bg-orange-500/20'  },
  'Creatina':   { border: 'border-cyan-500/25',    bg: 'bg-cyan-500/10',    text: 'text-cyan-300',    iconBg: 'bg-cyan-500/20'    },
  'Geral':      { border: 'border-yellow-500/25',  bg: 'bg-yellow-500/10',  text: 'text-yellow-300',  iconBg: 'bg-yellow-500/20'  },
};

export default function RecordesPage() {
  const totalTrofeus = trofeus.length;
  const desbloqueados = trofeus.filter((t) => t.desbloqueado).length;

  return (
    <main className="min-h-screen bg-[#08101a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Sidebar />

        <section className="flex-1 space-y-5">
          {/* Header */}
          <header className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Trophy className="text-yellow-400" size={28} />
                <div>
                  <h1 className="text-2xl font-semibold text-white">Recordes Pessoais</h1>
                  <p className="text-sm text-slate-400">Supere seus próprios limites. Cada dia é uma nova chance.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl bg-slate-900/60 px-5 py-3 border border-white/5">
                <div className="text-center pr-4 border-r border-white/10">
                  <p className="text-xl font-bold text-white">0</p>
                  <p className="text-xs uppercase tracking-widest text-slate-400">Recordes</p>
                </div>
                <div className="text-center px-4 border-r border-white/10">
                  <p className="text-xl font-bold text-yellow-400">{desbloqueados}</p>
                  <p className="text-xs uppercase tracking-widest text-slate-400">Troféus</p>
                </div>
                <div className="text-center pl-4">
                  <p className="text-xl font-bold text-slate-300">{totalTrofeus}</p>
                  <p className="text-xs uppercase tracking-widest text-slate-400">Total</p>
                </div>
              </div>
            </div>
          </header>

          {/* Records Table */}
          <div className="rounded-[2rem] border border-white/10 bg-white/5 shadow-glow backdrop-blur-xl overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-white/10 px-5 py-3">
              <span className="text-xs font-medium uppercase tracking-widest text-slate-500">Métrica</span>
              <span className="w-24 text-center text-xs font-medium uppercase tracking-widest text-slate-500">Diário</span>
              <span className="w-24 text-center text-xs font-medium uppercase tracking-widest text-slate-500">Semanal</span>
              <span className="w-24 text-center text-xs font-medium uppercase tracking-widest text-slate-500">Mensal</span>
            </div>

            {/* Rows */}
            {metrics.map((m, i) => {
              const Icon = m.icon;
              const separator = i !== metrics.length - 1 ? 'border-b border-white/5' : '';

              if (m.id === 'creatina') {
                return (
                  <div key={m.id} className={`flex items-center gap-4 px-5 py-3.5 transition hover:bg-white/5 ${separator}`}>
                    <div className="flex flex-1 items-center gap-3 min-w-0">
                      <Icon size={16} className={m.cor} />
                      <span className="truncate text-sm font-medium text-slate-200">{m.label}</span>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900/50 px-4 py-1.5">
                      <span className="text-xs text-slate-500">Melhor sequência</span>
                      <span className="text-sm font-semibold text-white">{m.diario}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-3.5 transition hover:bg-white/5 ${separator}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon size={16} className={m.cor} />
                    <span className="truncate text-sm font-medium text-slate-200">{m.label}</span>
                  </div>
                  <div className="w-24 rounded-xl border border-white/5 bg-slate-900/50 px-3 py-1.5 text-center">
                    <p className="text-sm font-semibold text-white">{m.diario}</p>
                  </div>
                  <div className="w-24 rounded-xl border border-white/5 bg-slate-900/50 px-3 py-1.5 text-center">
                    <p className="text-sm font-semibold text-white">{m.semanal}</p>
                  </div>
                  <div className="w-24 rounded-xl border border-white/5 bg-slate-900/50 px-3 py-1.5 text-center">
                    <p className="text-sm font-semibold text-white">{m.mensal}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Trophy Gallery */}
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Galeria de Troféus</h2>
              <span className="text-xs text-slate-500">{desbloqueados} / {totalTrofeus} desbloqueados</span>
            </div>

            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-11">
              {trofeus.map((t, i) => {
                const Icon = t.icon;
                const style = catStyle[t.cat] ?? catStyle['Geral'];
                return (
                  <div
                    key={i}
                    className={`group relative flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-center transition hover:scale-105 hover:z-10 ${
                      t.desbloqueado
                        ? `${style.border} ${style.bg}`
                        : 'border-white/5 bg-slate-900/40 opacity-50 hover:opacity-70'
                    }`}
                  >
                    {/* Icon */}
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full ${t.desbloqueado ? style.iconBg : 'bg-slate-800'}`}>
                      <Icon size={14} className={t.desbloqueado ? style.text : 'text-slate-500'} />
                    </div>

                    {/* Name */}
                    <p className={`text-[10px] font-medium leading-tight ${t.desbloqueado ? 'text-white' : 'text-slate-500'}`}>
                      {t.nome}
                    </p>

                    {/* Tooltip */}
                    <div className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-50 w-44 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0d1b2a] px-3 py-2 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
                      <p className={`mb-1 text-[10px] font-semibold uppercase tracking-widest ${style.text}`}>{t.cat}</p>
                      <p className="text-xs leading-snug text-slate-300">{t.req}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
