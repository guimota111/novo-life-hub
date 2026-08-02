'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { usePush } from '@/contexts/PushContext';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import {
  computeRecords, checkTrophies, diffTrophies, diffRecords,
  emptyRecords, type Records, type DailyData, type Goals,
} from '@/lib/achievements';
import {
  Trophy, Medal, Crown, Star, Target, Zap, HeartPulse, Droplet, Flame,
  BookOpen, Film, Pill, GraduationCap, Footprints, Sparkles, Brain,
  Dumbbell, Rocket, Coffee, Sun, Shield, Gem, Activity, Timer, Moon,
  Bell, BellOff, RefreshCw,
  Heart, TrendingUp, Mountain, Layers, Repeat, CheckCircle2,
  Waves, Leaf, Swords, Ruler,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

const DEFAULT_GOALS: Goals = {
  water_ml: 4000, steps: 10000, reading_pages: 10,
  gym_days_per_week: 5, study_minutes: 120, meditation_minutes: 10,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtL(ml: number)    { return ml >= 1000 ? `${(ml / 1000).toFixed(1)} L` : `${ml} ml`; }
function fmtSteps(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)} k` : `${n}`; }
function fmtKm(km: number)   { return `${km.toFixed(1)} km`; }
function fmtH(m: number)     { return m >= 60 ? `${(m / 60).toFixed(1)} h` : `${m} min`; }
function fmtDias(n: number)  { return `${n} ${n === 1 ? 'dia' : 'dias'}`; }
function fmtPags(n: number)  { return `${n} pág${n !== 1 ? 's' : ''}`; }

// ── Trophy definitions ────────────────────────────────────────────────────────

interface TrophyDef {
  key: string;
  nome: string;
  req: string;
  cat: string;
  icon: LucideIcon;
  canCheck: boolean;
}

const TROPHIES: TrophyDef[] = [
  // ── Hidratação (10) ──────────────────────────────────────────────────────
  { key: 'primeira_gota',      nome: 'Primeira Gota',       req: 'Registre qualquer quantidade de água',              cat: 'Hidratação', icon: Droplet,      canCheck: true  },
  { key: 'fonte_eterna',       nome: 'Fonte Eterna',        req: 'Beba 3 L em um único dia',                          cat: 'Hidratação', icon: Droplet,      canCheck: true  },
  { key: 'marejado',           nome: 'Marejado',            req: 'Beba 5 L em um único dia',                          cat: 'Hidratação', icon: Waves,        canCheck: true  },
  { key: 'tsunami',            nome: 'Tsunami',             req: 'Beba 6 L em um único dia',                          cat: 'Hidratação', icon: Waves,        canCheck: true  },
  { key: 'sereia_cerrado',     nome: 'Sereia do Cerrado',   req: '7 dias seguidos com meta de água atingida',          cat: 'Hidratação', icon: Droplet,      canCheck: true  },
  { key: 'bem_hidratado',      nome: 'Bem Hidratado',       req: '14 dias seguidos com meta de água atingida',         cat: 'Hidratação', icon: Droplet,      canCheck: true  },
  { key: 'rio_sem_fim',        nome: 'Rio Sem Fim',         req: '30 dias com meta de hidratação atingida',            cat: 'Hidratação', icon: Droplet,      canCheck: true  },
  { key: 'oceano_vivo',        nome: 'Oceano Vivo',         req: '50 dias com meta de hidratação atingida',            cat: 'Hidratação', icon: Waves,        canCheck: true  },
  { key: 'cem_dias_hidratado', nome: 'Cem Dias Hidratado',  req: '100 dias com meta de água atingida',                 cat: 'Hidratação', icon: Medal,        canCheck: true  },
  { key: 'fonte_da_juventude', nome: 'Fonte da Juventude',  req: '365 dias com meta de hidratação atingida',           cat: 'Hidratação', icon: Crown,        canCheck: true  },

  // ── Passos (10) ──────────────────────────────────────────────────────────
  { key: 'primeiro_passo',     nome: 'Primeiro Passo',      req: 'Registre qualquer número de passos',                 cat: 'Passos',     icon: Footprints,   canCheck: true  },
  { key: 'nomade_digital',     nome: 'Nômade Digital',      req: 'Caminhe 12.500 passos em um único dia',              cat: 'Passos',     icon: Footprints,   canCheck: true  },
  { key: 'caminhante',         nome: 'Caminhante',          req: '7 dias consecutivos atingindo a meta de passos',     cat: 'Passos',     icon: Footprints,   canCheck: true  },
  { key: 'pes_de_vento',       nome: 'Pés de Vento',        req: '30 dias atingindo a meta de passos',                 cat: 'Passos',     icon: Rocket,       canCheck: true  },
  { key: 'cem_dias_andando',   nome: 'Cem Dias Andando',    req: '100 dias atingindo a meta de passos',                cat: 'Passos',     icon: Medal,        canCheck: true  },
  { key: 'explorador_nato',    nome: 'Explorador Nato',     req: 'Acumule 125.000 passos em um único mês',             cat: 'Passos',     icon: Mountain,     canCheck: true  },
  { key: 'trekker',            nome: 'Trekker',             req: 'Acumule 250.000 passos em um único mês',             cat: 'Passos',     icon: Mountain,     canCheck: true  },
  { key: 'maratonista',        nome: 'Maratonista',         req: 'Acumule 52.500 passos em uma única semana',          cat: 'Passos',     icon: Trophy,       canCheck: true  },
  { key: 'ultra_runner',       nome: 'Ultra Runner',        req: 'Acumule 87.500 passos em uma única semana',          cat: 'Passos',     icon: Zap,          canCheck: true  },
  { key: 'road_warrior',       nome: 'Road Warrior',        req: 'Acumule 1.250.000 passos no total',                  cat: 'Passos',     icon: Crown,        canCheck: true  },

  // ── Exercícios (10) ──────────────────────────────────────────────────────
  { key: 'ferro_frio',         nome: 'Ferro Frio',          req: 'Registre um treino antes das 6h',                   cat: 'Exercícios', icon: Dumbbell,     canCheck: false },
  { key: 'primeiro_treino',    nome: 'Primeiro Treino',     req: 'Registre seu primeiro treino na academia',           cat: 'Exercícios', icon: Dumbbell,     canCheck: true  },
  { key: 'sete_dias_de_ferro', nome: '7 Dias de Ferro',     req: '7 treinos consecutivos registrados',                 cat: 'Exercícios', icon: Flame,        canCheck: true  },
  { key: 'musculos_titanio',   nome: 'Músculos de Titânio', req: '30 treinos consecutivos registrados',                cat: 'Exercícios', icon: Shield,       canCheck: true  },
  { key: 'guerreiro',          nome: 'Guerreiro das Madrugadas', req: '10 treinos realizados antes das 7h',            cat: 'Exercícios', icon: Moon,         canCheck: false },
  { key: 'atleta',             nome: 'Atleta',              req: '50 treinos registrados no total',                    cat: 'Exercícios', icon: Star,         canCheck: true  },
  { key: 'ironman',            nome: 'Ironman',             req: '100 treinos registrados no total',                   cat: 'Exercícios', icon: Gem,          canCheck: true  },
  { key: 'gladiador',          nome: 'Gladiador',           req: '200 treinos registrados no total',                   cat: 'Exercícios', icon: Swords,       canCheck: true  },
  { key: 'ferro_velho',        nome: 'Ferro Velho',         req: '365 treinos registrados no total',                   cat: 'Exercícios', icon: Medal,        canCheck: true  },
  { key: 'incansavel',         nome: 'Incansável',          req: '500 treinos registrados no total',                   cat: 'Exercícios', icon: Crown,        canCheck: true  },

  // ── Leitura (10) ─────────────────────────────────────────────────────────
  { key: 'primeira_pagina',    nome: 'Primeira Página',     req: 'Registre sua primeira sessão de leitura',            cat: 'Leitura',    icon: BookOpen,     canCheck: true  },
  { key: 'madrugada_literaria',nome: 'Madrugada Literária', req: 'Leia 50 páginas em um único dia',                   cat: 'Leitura',    icon: Moon,         canCheck: true  },
  { key: 'devorando_paginas',  nome: 'Devorando Páginas',   req: 'Leia 100 páginas em um único dia',                   cat: 'Leitura',    icon: Zap,          canCheck: true  },
  { key: 'leitor_assiduo',     nome: 'Leitor Assíduo',      req: '7 dias seguidos de leitura',                        cat: 'Leitura',    icon: BookOpen,     canCheck: true  },
  { key: 'worm_de_papel',      nome: 'Worm de Papel',       req: '30 dias seguidos de leitura',                       cat: 'Leitura',    icon: Star,         canCheck: true  },
  { key: 'bibliofilo',         nome: 'Bibliófilo Assumido', req: 'Conclua 10 livros',                                  cat: 'Leitura',    icon: Crown,        canCheck: false },
  { key: 'biblioteca_viva',    nome: 'Biblioteca Viva',     req: '100 dias atingindo a meta diária de leitura',        cat: 'Leitura',    icon: Medal,        canCheck: true  },
  { key: 'mil_paginas',        nome: 'Mil Páginas',         req: 'Acumule 1.000 páginas lidas no total',               cat: 'Leitura',    icon: Trophy,       canCheck: true  },
  { key: 'dez_mil_paginas',    nome: 'Dez Mil Páginas',     req: 'Acumule 10.000 páginas lidas no total',              cat: 'Leitura',    icon: Gem,          canCheck: true  },
  { key: 'iluminado',          nome: 'Iluminado',           req: 'Conclua 50 livros ao longo da jornada',              cat: 'Leitura',    icon: Sparkles,     canCheck: false },

  // ── Estudo (10) ──────────────────────────────────────────────────────────
  { key: 'primeiro_estudo',    nome: 'Primeiro Estudo',     req: 'Registre sua primeira sessão de estudo',             cat: 'Estudo',     icon: GraduationCap,canCheck: true  },
  { key: 'foco_total',         nome: 'Foco Total',          req: 'Estude 4h em um único dia',                          cat: 'Estudo',     icon: Target,       canCheck: true  },
  { key: 'modo_neurofilo',     nome: 'Modo Neurofilo',      req: 'Estude 8h em um único dia',                          cat: 'Estudo',     icon: Brain,        canCheck: true  },
  { key: 'semana_produtiva',   nome: 'Semana Produtiva',    req: '7 dias consecutivos com estudo registrado',          cat: 'Estudo',     icon: TrendingUp,   canCheck: true  },
  { key: 'eterno_aprendiz',    nome: 'Eterno Aprendiz',     req: '14 dias consecutivos com estudo registrado',         cat: 'Estudo',     icon: Star,         canCheck: true  },
  { key: 'algoritmo_humano',   nome: 'Algoritmo Humano',    req: '30 dias consecutivos com estudo registrado',         cat: 'Estudo',     icon: GraduationCap,canCheck: true  },
  { key: 'cinquenta_horas',    nome: '50 Horas de Estudo',  req: 'Acumule 50h de estudo no total',                     cat: 'Estudo',     icon: Timer,        canCheck: true  },
  { key: 'mestre_jedi',        nome: 'Mestre Jedi',         req: 'Acumule 100h de estudo no total',                    cat: 'Estudo',     icon: Gem,          canCheck: true  },
  { key: 'cerebro_overflow',   nome: 'Cérebro Overflow',    req: 'Acumule 500h de estudo no total',                    cat: 'Estudo',     icon: Zap,          canCheck: true  },
  { key: 'mil_horas',          nome: 'Mil Horas',           req: 'Acumule 1.000h de estudo no total',                  cat: 'Estudo',     icon: Crown,        canCheck: true  },

  // ── Meditação (10) ───────────────────────────────────────────────────────
  { key: 'primeiro_respiro',   nome: 'Primeiro Respiro',    req: 'Registre sua primeira sessão de meditação',          cat: 'Meditação',  icon: Leaf,         canCheck: true  },
  { key: 'meditador_hardcore', nome: 'Meditador Hardcore',  req: 'Medite por 60 min em um único dia',                  cat: 'Meditação',  icon: Brain,        canCheck: true  },
  { key: 'mente_calma',        nome: 'Mente Calma',         req: '7 dias seguidos de meditação registrada',            cat: 'Meditação',  icon: Heart,        canCheck: true  },
  { key: 'zen_iniciante',      nome: 'Zen Iniciante',       req: '30 dias seguidos de meditação registrada',           cat: 'Meditação',  icon: Leaf,         canCheck: true  },
  { key: 'mestre_zen',         nome: 'Mestre Zen',          req: '60 dias seguidos de meditação registrada',           cat: 'Meditação',  icon: Sparkles,     canCheck: true  },
  { key: 'mindful_basico',     nome: 'Mindful Básico',      req: '30 dias com meditação registrada',                   cat: 'Meditação',  icon: HeartPulse,   canCheck: true  },
  { key: 'guru_da_meditacao',  nome: 'Guru da Meditação',   req: '100 dias com meta de meditação atingida',            cat: 'Meditação',  icon: Star,         canCheck: true  },
  { key: 'transcendente',      nome: 'Transcendente',       req: '200 dias com meditação registrada',                  cat: 'Meditação',  icon: Crown,        canCheck: true  },
  { key: 'cinquenta_horas_zen',nome: '50h de Paz Interior', req: 'Acumule 50h de meditação no total',                  cat: 'Meditação',  icon: Timer,        canCheck: true  },
  { key: 'cem_horas_zen',      nome: '100h de Silêncio',    req: 'Acumule 100h de meditação no total',                 cat: 'Meditação',  icon: Gem,          canCheck: true  },

  // ── Creatina (6) ─────────────────────────────────────────────────────────
  { key: 'primeira_dose',      nome: 'Primeira Dose',       req: 'Tome creatina pela primeira vez',                    cat: 'Creatina',   icon: Pill,         canCheck: true  },
  { key: 'consistencia_creatina', nome: 'Consistência',     req: '60 dias com creatina registrada',                    cat: 'Creatina',   icon: Repeat,       canCheck: true  },
  { key: 'suplementado',       nome: 'Suplementado',        req: '30 dias seguidos tomando creatina',                  cat: 'Creatina',   icon: Activity,     canCheck: true  },
  { key: 'protocolado',        nome: 'Protocolado',         req: '90 dias no protocolo de creatina',                   cat: 'Creatina',   icon: Shield,       canCheck: true  },
  { key: 'semestre_suplementado', nome: 'Meio Ano de Protocolo', req: '180 dias seguidos de creatina',                 cat: 'Creatina',   icon: Medal,        canCheck: true  },
  { key: 'ano_de_creatina',    nome: 'Ano de Creatina',     req: '365 dias seguidos no protocolo',                     cat: 'Creatina',   icon: Crown,        canCheck: true  },

  // ── Filmes (3) ───────────────────────────────────────────────────────────
  { key: 'cinefilo',           nome: 'Cinéfilo de Plantão', req: 'Assista 3 filmes em um único dia',                   cat: 'Filmes',     icon: Film,         canCheck: false },
  { key: 'critico',            nome: 'Crítico de Poltronagem', req: '50 filmes catalogados',                           cat: 'Filmes',     icon: Star,         canCheck: false },
  { key: 'maratonista_tela',   nome: 'Maratonista de Tela', req: '24h de conteúdo assistido no total',                 cat: 'Filmes',     icon: Trophy,       canCheck: false },

  // ── Geral (22) ───────────────────────────────────────────────────────────
  { key: 'primeiro_nivel',     nome: 'Primeiro Nível',      req: 'Registre sua primeira entrada em qualquer seção',    cat: 'Geral',      icon: Target,       canCheck: true  },
  { key: 'relogio_suico',      nome: 'Relógio Suíço',       req: 'Registre atividades todo dia por 14 dias seguidos',  cat: 'Geral',      icon: Timer,        canCheck: true  },
  { key: 'velocidade_cruzeiro',nome: 'Velocidade de Cruzeiro', req: '21 dias seguidos com alguma atividade',           cat: 'Geral',      icon: Rocket,       canCheck: true  },
  { key: 'tamagochi_feliz',    nome: 'Tamagochi Feliz',     req: 'Todas as métricas no verde por 3 dias seguidos',     cat: 'Geral',      icon: Sparkles,     canCheck: true  },
  { key: 'semana_imparavel',   nome: 'Semana Imparável',    req: '7 dias atingindo todas as metas diárias',            cat: 'Geral',      icon: Zap,          canCheck: true  },
  { key: 'mes_perfeito',       nome: 'Mês Perfeito',        req: '30 dias sem falhar nenhuma meta',                    cat: 'Geral',      icon: Star,         canCheck: true  },
  { key: 'modo_deus',          nome: 'Modo Deus',           req: '100 dias consecutivos com todas as metas',           cat: 'Geral',      icon: Crown,        canCheck: true  },
  { key: 'cem_dias_ativo',     nome: 'Cem Dias Ativo',      req: '100 dias com qualquer atividade registrada',         cat: 'Geral',      icon: Medal,        canCheck: true  },
  { key: 'duzentos_dias_ativo',nome: 'Duzentos Dias Ativo', req: '200 dias com qualquer atividade registrada',         cat: 'Geral',      icon: Trophy,       canCheck: true  },
  { key: 'um_ano_ativo',       nome: 'Um Ano Ativo',        req: '365 dias com qualquer atividade registrada',         cat: 'Geral',      icon: Crown,        canCheck: true  },
  { key: 'equilibrista',       nome: 'Equilibrista',        req: 'Registre 5 hábitos diferentes em um mesmo dia',      cat: 'Geral',      icon: Layers,       canCheck: true  },
  { key: 'polifatico',         nome: 'Polifático',          req: 'Registre 6 hábitos diferentes em um mesmo dia',      cat: 'Geral',      icon: Layers,       canCheck: true  },
  { key: 'harmonioso',         nome: 'Harmonioso',          req: 'Registre todos os 7 hábitos em um mesmo dia',        cat: 'Geral',      icon: Gem,          canCheck: true  },
  { key: 'all_in',             nome: 'All In',              req: 'Bata todas as 7 metas em um mesmo dia',              cat: 'Geral',      icon: Sparkles,     canCheck: true  },
  { key: 'rotineiro',          nome: 'Rotineiro',           req: '30 dias com 5 ou mais metas atingidas',              cat: 'Geral',      icon: Repeat,       canCheck: true  },
  { key: 'cinco_estrelas',     nome: 'Cinco Estrelas',      req: '30 dias com score acima de 80%',                     cat: 'Geral',      icon: Star,         canCheck: true  },
  { key: 'cinquenta_dias_perfeitos', nome: '50 Dias Perfeitos', req: '50 dias com todas as metas batidas',             cat: 'Geral',      icon: Trophy,       canCheck: true  },
  { key: 'centuriao',          nome: 'Centurião',           req: '100 dias com todas as metas batidas',                cat: 'Geral',      icon: Medal,        canCheck: true  },
  { key: 'consistencia_total', nome: 'Consistência Total',  req: '7 dias seguidos com 6+ metas atingidas',             cat: 'Geral',      icon: TrendingUp,   canCheck: true  },
  { key: 'lendario',           nome: 'Lendário',            req: 'Desbloqueie todas as outras conquistas avaliáveis',  cat: 'Geral',      icon: Crown,        canCheck: true  },
  { key: 'manhazeiro',         nome: 'Manhãzeiro',          req: 'Complete todas as metas antes do meio-dia',          cat: 'Geral',      icon: Sun,          canCheck: false },
  { key: 'cafeinado',          nome: 'Cafeinado',           req: 'Registre atividade às 5h da manhã por 5 dias',       cat: 'Geral',      icon: Coffee,       canCheck: false },

  // ── Combo (8) ────────────────────────────────────────────────────────────
  { key: 'atletico',           nome: 'Atlético',            req: '20 dias com academia + meta de passos',              cat: 'Combo',      icon: Dumbbell,     canCheck: true  },
  { key: 'mente_e_corpo',      nome: 'Mente e Corpo',       req: '20 dias com academia + meta de estudo',              cat: 'Combo',      icon: Brain,        canCheck: true  },
  { key: 'corpo_mente_espirito',nome: 'Corpo, Mente, Espírito', req: '10 dias com academia + estudo + meditação nas metas', cat: 'Combo', icon: Heart,       canCheck: true  },
  { key: 'duplo_combo',        nome: 'Duplo Combo',         req: '14 dias seguidos com água + passos nas metas',       cat: 'Combo',      icon: CheckCircle2, canCheck: true  },
  { key: 'acordado_e_focado',  nome: 'Acordado e Focado',   req: '7 dias seguidos com estudo + meditação nas metas',   cat: 'Combo',      icon: Sparkles,     canCheck: true  },
  { key: 'total_health',       nome: 'Total Health',        req: '7 dias com academia + passos + água + estudo nas metas', cat: 'Combo', icon: HeartPulse,   canCheck: true  },
  { key: 'trilha',             nome: 'Trilha',              req: '20 dias com passos + leitura nas metas',             cat: 'Combo',      icon: Mountain,     canCheck: true  },
  { key: 'guerreiro_completo', nome: 'Guerreiro Completo',  req: '7 dias seguidos com 4+ metas atingidas',             cat: 'Combo',      icon: Swords,       canCheck: true  },

  // ── Meta (3) ─────────────────────────────────────────────────────────────
  { key: 'medalhista',         nome: 'Medalhista',          req: 'Desbloqueie 10 troféus',                             cat: 'Meta',       icon: Medal,        canCheck: true  },
  { key: 'campeao',            nome: 'Campeão',             req: 'Desbloqueie 25 troféus',                             cat: 'Meta',       icon: Trophy,       canCheck: true  },
  { key: 'el_campeon',         nome: 'El Campeón',          req: 'Desbloqueie 50 troféus',                             cat: 'Meta',       icon: Crown,        canCheck: true  },
];

const CAT_STYLE: Record<string, { border: string; bg: string; text: string; iconBg: string }> = {
  'Hidratação': { border: 'border-blue-500/25',    bg: 'bg-blue-500/10',    text: 'text-blue-300',    iconBg: 'bg-blue-500/20'    },
  'Passos':     { border: 'border-emerald-500/25', bg: 'bg-emerald-500/10', text: 'text-emerald-300', iconBg: 'bg-emerald-500/20' },
  'Exercícios': { border: 'border-pink-500/25',    bg: 'bg-pink-500/10',    text: 'text-pink-300',    iconBg: 'bg-pink-500/20'    },
  'Leitura':    { border: 'border-amber-500/25',   bg: 'bg-amber-500/10',   text: 'text-amber-300',   iconBg: 'bg-amber-500/20'   },
  'Estudo':     { border: 'border-violet-500/25',  bg: 'bg-violet-500/10',  text: 'text-violet-300',  iconBg: 'bg-violet-500/20'  },
  'Meditação':  { border: 'border-teal-500/25',    bg: 'bg-teal-500/10',    text: 'text-teal-300',    iconBg: 'bg-teal-500/20'    },
  'Filmes':     { border: 'border-orange-500/25',  bg: 'bg-orange-500/10',  text: 'text-orange-300',  iconBg: 'bg-orange-500/20'  },
  'Creatina':   { border: 'border-cyan-500/25',    bg: 'bg-cyan-500/10',    text: 'text-cyan-300',    iconBg: 'bg-cyan-500/20'    },
  'Geral':      { border: 'border-yellow-500/25',  bg: 'bg-yellow-500/10',  text: 'text-yellow-300',  iconBg: 'bg-yellow-500/20'  },
  'Combo':      { border: 'border-rose-500/25',    bg: 'bg-rose-500/10',    text: 'text-rose-300',    iconBg: 'bg-rose-500/20'    },
  'Meta':       { border: 'border-purple-500/25',  bg: 'bg-purple-500/10',  text: 'text-purple-300',  iconBg: 'bg-purple-500/20'  },
};

// ── Record row definitions ────────────────────────────────────────────────────

interface RecordRow {
  id: string;
  label: string;
  icon: LucideIcon;
  cor: string;
  day:   (r: Records) => string;
  week:  (r: Records) => string | null;
  month: (r: Records) => string | null;
  special?: (r: Records) => string;
}

const RECORD_ROWS: RecordRow[] = [
  {
    id: 'passos', label: 'Passos', icon: Footprints, cor: 'text-emerald-400',
    day:   r => fmtSteps(r.steps_day),
    week:  r => fmtSteps(r.steps_week),
    month: r => fmtSteps(r.steps_month),
  },
  {
    id: 'distancia', label: 'Distância', icon: Ruler, cor: 'text-cyan-400',
    day:   r => fmtKm(r.km_day),
    week:  r => fmtKm(r.km_week),
    month: r => fmtKm(r.km_month),
  },
  {
    id: 'hidra', label: 'Hidratação', icon: Droplet, cor: 'text-blue-400',
    day:   r => fmtL(r.water_day),
    week:  r => fmtL(r.water_week),
    month: r => fmtL(r.water_month),
  },
  {
    id: 'leitura', label: 'Leitura', icon: BookOpen, cor: 'text-amber-400',
    day:   r => fmtPags(r.reading_day),
    week:  r => fmtPags(r.reading_week),
    month: r => fmtPags(r.reading_month),
  },
  {
    id: 'estudo', label: 'Estudo', icon: GraduationCap, cor: 'text-violet-400',
    day:   r => fmtH(r.study_day),
    week:  r => fmtH(r.study_week),
    month: r => fmtH(r.study_month),
  },
  {
    id: 'meditacao', label: 'Meditação', icon: HeartPulse, cor: 'text-teal-400',
    day:   r => fmtH(r.meditation_day),
    week:  r => fmtH(r.meditation_week),
    month: r => fmtH(r.meditation_month),
  },
  {
    id: 'academia', label: 'Academia', icon: Dumbbell, cor: 'text-rose-400',
    day:   r => fmtDias(r.gym_streak),
    week:  () => null,
    month: () => null,
  },
  {
    id: 'creatina', label: 'Creatina', icon: Pill, cor: 'text-purple-400',
    day:   r => fmtDias(r.creatine_streak),
    week:  () => null,
    month: () => null,
  },
  {
    id: 'streak', label: 'Sequência Perfeita', icon: Flame, cor: 'text-orange-400',
    day:   r => fmtDias(r.general_streak),
    week:  () => null,
    month: () => null,
  },
  {
    id: 'dia_perfeito', label: 'Dias Perfeitos', icon: CheckCircle2, cor: 'text-yellow-400',
    day:   r => fmtDias(r.perfect_day_count),
    week:  () => null,
    month: () => null,
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function RecordesPage() {
  const { user } = useAuth();
  const { permission, subscription, requesting, enable, sendPush } = usePush();

  const [logs, setLogs]       = useState<Record<string, DailyData>>({});
  const [goals, setGoals]     = useState<Goals>(DEFAULT_GOALS);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  // Stored achievements (from Firestore) — used to detect NEW ones
  const [storedRecords, setStoredRecords]   = useState<Records>(emptyRecords());
  const [storedTrophies, setStoredTrophies] = useState<string[]>([]);

  // Trophy tooltip opened by tap (touch has no hover) — null means none open
  const [openTrophy, setOpenTrophy] = useState<string | null>(null);

  const checkedRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      const [logsSnap, goalsSnap, achievementsSnap] = await Promise.all([
        getDocs(collection(db, 'users', user.uid, 'daily_logs')),
        getDoc(doc(db, 'users', user.uid, 'settings', 'goals')),
        getDoc(doc(db, 'users', user.uid, 'stats', 'achievements')),
      ]);
      const data: Record<string, DailyData> = {};
      logsSnap.forEach(d => { data[d.id] = d.data() as DailyData; });
      setLogs(data);
      if (goalsSnap.exists()) setGoals({ ...DEFAULT_GOALS, ...(goalsSnap.data() as Partial<Goals>) });
      if (achievementsSnap.exists()) {
        const a = achievementsSnap.data();
        if (a.records) setStoredRecords(a.records as Records);
        if (a.trophies) setStoredTrophies(a.trophies as string[]);
      }
      setLoading(false);
    };
    load();
  }, [user]);

  // Compute live records + trophies from loaded data
  const records = useMemo(() => computeRecords(logs, goals), [logs, goals]);
  const earnedKeys = useMemo(() => checkTrophies(logs, goals, records), [logs, goals, records]);

  const totals = useMemo(() => {
    const days = Object.values(logs);
    return {
      water_l:     +(days.reduce((s, d) => s + (d.water_ml ?? 0), 0) / 1000).toFixed(1),
      steps:       days.reduce((s, d) => s + (d.steps ?? 0), 0),
      km:          +days.reduce((s, d) => s + (d.walking_distance_km ?? 0), 0).toFixed(1),
      pages:       days.reduce((s, d) => s + (d.reading_pages ?? 0), 0),
      study_h:     +(days.reduce((s, d) => s + (d.study_minutes ?? 0), 0) / 60).toFixed(1),
      meditation_h:+(days.reduce((s, d) => s + (d.meditation_minutes ?? 0), 0) / 60).toFixed(1),
      gym_days:    days.filter(d => d.gym_done).length,
      creatine_days: days.filter(d => d.creatine_done).length,
      active_days: days.filter(d =>
        (d.water_ml ?? 0) > 0 || (d.steps ?? 0) > 0 || (d.reading_pages ?? 0) > 0 ||
        d.gym_done || d.creatine_done || (d.study_minutes ?? 0) > 0 || (d.meditation_minutes ?? 0) > 0
      ).length,
    };
  }, [logs]);

  const totalTrophies   = TROPHIES.length;
  const earnedCount     = TROPHIES.filter(t => t.canCheck && earnedKeys.has(t.key)).length;
  const lockedCount     = TROPHIES.filter(t => t.canCheck && !earnedKeys.has(t.key)).length;
  const newRecordsCount = useMemo(
    () => diffRecords(storedRecords, records).length,
    [storedRecords, records],
  );
  const newTrophiesCount = useMemo(
    () => diffTrophies(storedTrophies, earnedKeys).length,
    [storedTrophies, earnedKeys],
  );

  // Check + notify for new achievements; save to Firestore
  const checkAndNotify = async () => {
    if (!user || checking) return;
    setChecking(true);
    try {
      const newTrophyKeys = diffTrophies(storedTrophies, earnedKeys);
      const newRecordFields = diffRecords(storedRecords, records);

      // Send push for each new trophy
      for (const key of newTrophyKeys) {
        const def = TROPHIES.find(t => t.key === key);
        if (def) {
          await sendPush(`🏆 Troféu desbloqueado!`, `"${def.nome}" — ${def.req}`, '/recordes');
        }
      }

      // Send push for new records (batch into one notification if multiple)
      if (newRecordFields.length > 0) {
        const label = newRecordFields.length === 1
          ? `Novo recorde: ${newRecordFields[0].field.replace(/_/g, ' ')}`
          : `${newRecordFields.length} novos recordes batidos!`;
        await sendPush('🎉 Novo Recorde!', label, '/recordes');
      }

      // Persist updated achievements
      await setDoc(doc(db, 'users', user.uid, 'stats', 'achievements'), {
        records,
        trophies: [...earnedKeys],
        updatedAt: new Date().toISOString(),
      });

      setStoredRecords(records);
      setStoredTrophies([...earnedKeys]);
      setLastChecked(new Date());
    } finally {
      setChecking(false);
    }
  };

  // Auto-check once after data loads (without notifications on first visit)
  useEffect(() => {
    if (loading || checkedRef.current || !user) return;
    checkedRef.current = true;
    if (storedTrophies.length === 0 && Object.keys(logs).length > 0) {
      // First visit — just save without notifying
      setDoc(doc(db, 'users', user.uid, 'stats', 'achievements'), {
        records,
        trophies: [...earnedKeys],
        updatedAt: new Date().toISOString(),
      }).then(() => {
        setStoredRecords(records);
        setStoredTrophies([...earnedKeys]);
      });
    }
  }, [loading, user, logs, records, earnedKeys, storedTrophies]);

  const notifBtnLabel = () => {
    if (permission === 'unsupported') return 'Notificações não suportadas';
    if (permission === 'granted') return subscription ? 'Notificações ativas' : 'Reconectar notificações';
    if (permission === 'denied')  return 'Notificações bloqueadas no browser';
    return 'Ativar notificações no celular';
  };

  // ── Render ──────────────────────────────────────────────────────────────────

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
                  <h1 className="text-2xl font-semibold text-white">Recordes &amp; Troféus</h1>
                  <p className="text-sm text-slate-400">Supere seus próprios limites. Cada dia é uma nova chance.</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Notification button */}
                <button
                  onClick={enable}
                  disabled={requesting || permission === 'granted' && !!subscription || permission === 'denied' || permission === 'unsupported'}
                  className={[
                    'flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium transition disabled:cursor-default disabled:opacity-50',
                    permission === 'granted' && subscription
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-tamagochi-400/40 hover:bg-tamagochi-500/10 hover:text-tamagochi-300',
                  ].join(' ')}
                >
                  {permission === 'granted' && subscription ? <Bell size={15} /> : <BellOff size={15} />}
                  {notifBtnLabel()}
                </button>

                {/* Check achievements button */}
                <button
                  onClick={checkAndNotify}
                  disabled={checking || loading || !subscription}
                  title={!subscription ? 'Ative as notificações primeiro' : undefined}
                  className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-tamagochi-400/40 hover:bg-tamagochi-500/10 hover:text-tamagochi-300 disabled:cursor-default disabled:opacity-40"
                >
                  <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
                  {checking ? 'Verificando...' : 'Verificar conquistas'}
                </button>

                {/* Stats */}
                <div className="flex items-center gap-0 rounded-2xl border border-white/5 bg-slate-900/60">
                  <div className="px-4 py-2 text-center">
                    <p className="text-xl font-bold text-white">{loading ? '—' : earnedCount}</p>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500">Troféus</p>
                  </div>
                  <div className="border-l border-white/10 px-4 py-2 text-center">
                    <p className="text-xl font-bold text-slate-400">{totalTrophies}</p>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500">Total</p>
                  </div>
                </div>
              </div>
            </div>

            {/* New achievements banner */}
            {!loading && (newRecordsCount > 0 || newTrophiesCount > 0) && (
              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-yellow-500/25 bg-yellow-500/10 px-4 py-3">
                <Sparkles size={16} className="shrink-0 text-yellow-400" />
                <p className="text-sm text-yellow-200">
                  {newTrophiesCount > 0 && `${newTrophiesCount} troféu${newTrophiesCount > 1 ? 's' : ''} novo${newTrophiesCount > 1 ? 's' : ''}!`}
                  {newTrophiesCount > 0 && newRecordsCount > 0 && ' · '}
                  {newRecordsCount > 0 && `${newRecordsCount} recorde${newRecordsCount > 1 ? 's' : ''} batido${newRecordsCount > 1 ? 's' : ''}!`}
                  {' '}Clique em "Verificar conquistas" para notificar.
                </p>
              </div>
            )}
          </header>

          {/* Records table */}
          <div className="rounded-[2rem] border border-white/10 bg-white/5 shadow-glow backdrop-blur-xl overflow-hidden">
            <div className="hidden items-center gap-4 border-b border-white/10 px-5 py-3 sm:grid sm:grid-cols-[1fr_auto_auto_auto]">
              <span className="text-xs font-medium uppercase tracking-widest text-slate-500">Métrica</span>
              <span className="w-28 text-center text-xs font-medium uppercase tracking-widest text-slate-500">Melhor dia</span>
              <span className="w-28 text-center text-xs font-medium uppercase tracking-widest text-slate-500">Melhor semana</span>
              <span className="w-28 text-center text-xs font-medium uppercase tracking-widest text-slate-500">Melhor mês</span>
            </div>

            {RECORD_ROWS.map((row, i) => {
              const Icon = row.icon;
              const separator = i < RECORD_ROWS.length - 1 ? 'border-b border-white/5' : '';
              const dayVal   = loading ? '—' : row.day(records);
              const weekVal  = row.week(records);
              const monthVal = row.month(records);

              const isStreak = weekVal === null;
              const streakLabel = row.id === 'dia_perfeito' ? 'Total' : 'Melhor sequência';

              if (isStreak) {
                return (
                  <div key={row.id} className={`flex items-center gap-4 px-5 py-3.5 transition hover:bg-white/5 ${separator}`}>
                    <div className="flex flex-1 items-center gap-3 min-w-0">
                      <Icon size={16} className={row.cor} />
                      <span className="truncate text-sm font-medium text-slate-200">{row.label}</span>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900/50 px-4 py-1.5">
                      <span className="text-xs text-slate-500">{streakLabel}</span>
                      <span className={`text-sm font-semibold ${loading ? 'text-slate-600' : 'text-white'}`}>{dayVal}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div key={row.id} className={`flex flex-col gap-3 px-5 py-3.5 transition hover:bg-white/5 sm:grid sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-4 ${separator}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon size={16} className={row.cor} />
                    <span className="truncate text-sm font-medium text-slate-200">{row.label}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:contents">
                    {[
                      { label: 'Dia', v: dayVal },
                      { label: 'Semana', v: loading ? '—' : weekVal! },
                      { label: 'Mês', v: loading ? '—' : monthVal! },
                    ].map(({ label, v }, j) => (
                      <div key={j} className="rounded-xl border border-white/5 bg-slate-900/50 px-3 py-1.5 text-center sm:w-28">
                        <p className={`text-sm font-semibold ${loading || v === '0' ? 'text-slate-600' : 'text-white'}`}>{v}</p>
                        <p className="mt-0.5 text-[9px] uppercase tracking-widest text-slate-600 sm:hidden">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Totals */}
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
            <h2 className="mb-4 text-lg font-semibold text-white">Totais Acumulados</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {[
                { label: 'Passos',      value: loading ? '—' : totals.steps.toLocaleString('pt-BR'),  icon: Footprints, cor: 'text-emerald-400', iconBg: 'bg-emerald-500/15' },
                { label: 'Distância',   value: loading ? '—' : `${totals.km} km`,                     icon: Ruler,      cor: 'text-cyan-400',    iconBg: 'bg-cyan-500/15'    },
                { label: 'Água',        value: loading ? '—' : `${totals.water_l} L`,                  icon: Droplet,    cor: 'text-blue-400',    iconBg: 'bg-blue-500/15'    },
                { label: 'Páginas',     value: loading ? '—' : totals.pages.toLocaleString('pt-BR'),   icon: BookOpen,   cor: 'text-amber-400',   iconBg: 'bg-amber-500/15'   },
                { label: 'Estudo',      value: loading ? '—' : `${totals.study_h} h`,                  icon: GraduationCap, cor: 'text-violet-400', iconBg: 'bg-violet-500/15' },
                { label: 'Meditação',   value: loading ? '—' : `${totals.meditation_h} h`,             icon: HeartPulse, cor: 'text-teal-400',    iconBg: 'bg-teal-500/15'    },
                { label: 'Academia',    value: loading ? '—' : fmtDias(totals.gym_days),               icon: Dumbbell,   cor: 'text-rose-400',    iconBg: 'bg-rose-500/15'    },
                { label: 'Creatina',    value: loading ? '—' : fmtDias(totals.creatine_days),          icon: Pill,       cor: 'text-purple-400',  iconBg: 'bg-purple-500/15'  },
                { label: 'Dias Ativos', value: loading ? '—' : fmtDias(totals.active_days),            icon: Activity,   cor: 'text-yellow-400',  iconBg: 'bg-yellow-500/15'  },
              ].map(({ label, value, icon: Icon, cor, iconBg }) => (
                <div key={label} className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-slate-900/50 p-3">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-xl ${iconBg}`}>
                    <Icon size={13} className={cor} />
                  </div>
                  <p className={`text-base font-bold leading-none ${loading ? 'text-slate-600' : 'text-white'}`}>{value}</p>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Trophy gallery */}
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Galeria de Troféus</h2>
                {lastChecked && (
                  <p className="mt-0.5 text-xs text-slate-600">
                    Verificado às {lastChecked.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">{earnedCount} / {totalTrophies} desbloqueados</span>
                {loading && <RefreshCw size={14} className="animate-spin text-slate-600" />}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-11">
              {TROPHIES.map((t) => {
                const Icon  = t.icon;
                const style = CAT_STYLE[t.cat] ?? CAT_STYLE['Geral'];
                const earned = t.canCheck ? earnedKeys.has(t.key) : false;
                const isNew  = earned && !storedTrophies.includes(t.key) && storedTrophies.length > 0;

                const tooltipOpen = openTrophy === t.key;

                return (
                  <div
                    key={t.key}
                    onClick={() => setOpenTrophy((prev) => (prev === t.key ? null : t.key))}
                    className={[
                      'group relative flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-center transition hover:z-10 hover:scale-105',
                      tooltipOpen ? 'z-10' : '',
                      earned
                        ? `${style.border} ${style.bg}`
                        : 'border-white/5 bg-slate-900/40 opacity-40 hover:opacity-60',
                      isNew ? 'ring-2 ring-yellow-400/60 ring-offset-2 ring-offset-[#08101a]' : '',
                    ].join(' ')}
                  >
                    {isNew && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                        <span className="relative inline-flex h-3 w-3 rounded-full bg-yellow-400" />
                      </span>
                    )}

                    <div className={`flex h-8 w-8 items-center justify-center rounded-full ${earned ? style.iconBg : 'bg-slate-800'}`}>
                      <Icon size={14} className={earned ? style.text : 'text-slate-600'} />
                    </div>

                    <p className={`text-[10px] font-medium leading-tight ${earned ? 'text-white' : 'text-slate-600'}`}>
                      {t.nome}
                    </p>

                    {!t.canCheck && (
                      <span className="text-[8px] text-slate-700">sem dados</span>
                    )}

                    {/* Tooltip — hover on desktop, tap-to-toggle on touch (no hover) */}
                    <div className={`pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-50 w-44 -translate-x-1/2 rounded-xl border border-white/10 bg-[#0d1b2a] px-3 py-2 shadow-xl transition-opacity duration-150 group-hover:opacity-100 ${tooltipOpen ? 'opacity-100' : 'opacity-0'}`}>
                      <p className={`mb-1 text-[10px] font-semibold uppercase tracking-widest ${style.text}`}>{t.cat}</p>
                      <p className="text-xs leading-snug text-slate-300">{t.req}</p>
                      {!t.canCheck && (
                        <p className="mt-1 text-[10px] text-slate-600">Requer dados não rastreados ainda</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tapping outside a trophy closes its tooltip on touch devices */}
            {openTrophy && (
              <div className="fixed inset-0 z-0" onClick={() => setOpenTrophy(null)} />
            )}
          </div>

          {/* Push notification info card */}
          {permission !== 'granted' && permission !== 'unsupported' && (
            <div className="rounded-[2rem] border border-tamagochi-400/20 bg-tamagochi-500/5 p-6 backdrop-blur-xl">
              <div className="flex items-start gap-4">
                <Bell className="mt-0.5 shrink-0 text-tamagochi-300" size={20} />
                <div>
                  <p className="font-semibold text-white">Receba notificações no celular</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Clique em "Ativar notificações" acima para receber um push no celular quando bater um recorde ou desbloquear um troféu.
                    No Android, funciona em background. No iOS, adicione o app à tela inicial primeiro (Safari → Compartilhar → Adicionar à Tela de Início).
                  </p>
                </div>
              </div>
            </div>
          )}

        </section>
      </div>
    </main>
  );
}
