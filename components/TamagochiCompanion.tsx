'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

type CompanionStage = {
  name: string;
  image: string;
  message: string;
  accent: string;
  animation: string;
  badge: string;
  glow: string;
};

type CompanionSignals = {
  waterProgress: number;
  readingDone: boolean;
  studyDone: boolean;
  meditationDone: boolean;
  gymDone: boolean;
  stepsDone: boolean;
  bestStreak: number;
};

function getStage(progress: number, hour: number, signals: CompanionSignals): CompanionStage {
  if (progress >= 90) {
    return {
      name: 'Árvore da Vida',
      image: '/mascot/tamagochi-life-tree.png',
      message: 'Florescemos juntos! Hoje sua rotina virou energia e vida.',
      accent: 'text-amber-300',
      animation: 'mascot-celebrate',
      badge: 'Evolução máxima',
      glow: 'from-amber-300/15 via-emerald-400/10 to-cyan-400/10',
    };
  }

  if (progress < 20 && hour >= 12) {
    return {
      name: 'Irritado',
      image: '/mascot/tamagochi-angry.png',
      message: 'Ei! Meus hábitos estão ficando para trás. Vamos reagir?',
      accent: 'text-orange-300',
      animation: 'mascot-grumble',
      badge: 'Estado crítico',
      glow: 'from-orange-400/15 via-rose-400/5 to-amber-300/10',
    };
  }

  if (hour >= 22 && progress < 50) {
    return {
      name: 'Sonolento',
      image: '/mascot/tamagochi-sleepy.png',
      message: 'O dia está acabando. Fechamos mais um cuidado antes de dormir?',
      accent: 'text-indigo-300',
      animation: 'mascot-yawn',
      badge: 'Fim do dia',
      glow: 'from-indigo-400/15 via-blue-400/5 to-violet-300/10',
    };
  }

  if (hour >= 10 && signals.waterProgress < 25 && progress < 65) {
    return {
      name: 'Sedento',
      image: '/mascot/tamagochi-thirsty.png',
      message: 'Minha folhinha está pedindo água. Que tal um copo agora?',
      accent: 'text-cyan-300',
      animation: 'mascot-wilt',
      badge: 'Precisa de água',
      glow: 'from-cyan-400/15 via-blue-400/5 to-emerald-300/10',
    };
  }

  if (signals.bestStreak >= 7 && progress >= 65) {
    return {
      name: 'Guardião da sequência',
      image: '/mascot/tamagochi-streak-guardian.png',
      message: `${signals.bestStreak} dias de constância despertaram uma forma rara!`,
      accent: 'text-yellow-300',
      animation: 'mascot-guardian',
      badge: 'Ramificação rara',
      glow: 'from-yellow-300/20 via-emerald-400/10 to-cyan-400/10',
    };
  }

  if (signals.readingDone && signals.studyDone && progress >= 45) {
    return {
      name: 'Focado',
      image: '/mascot/tamagochi-focused.png',
      message: 'Leitura e estudo completos. Minha mente está criando novas raízes!',
      accent: 'text-amber-200',
      animation: 'mascot-focus',
      badge: 'Mente ativa',
      glow: 'from-amber-300/15 via-cyan-400/5 to-emerald-300/10',
    };
  }

  if (signals.meditationDone && progress >= 40) {
    return {
      name: 'Zen',
      image: '/mascot/tamagochi-zen.png',
      message: 'A mente desacelerou e o corpo agradeceu. Respira comigo.',
      accent: 'text-teal-200',
      animation: 'mascot-meditate',
      badge: 'Equilíbrio',
      glow: 'from-teal-300/15 via-cyan-400/5 to-violet-300/10',
    };
  }

  if (signals.gymDone && signals.stepsDone && progress >= 50) {
    return {
      name: 'Fortalecido',
      image: '/mascot/tamagochi-strong.png',
      message: 'Treino e passos completos: hoje minhas raízes ganharam músculos!',
      accent: 'text-sky-300',
      animation: 'mascot-flex',
      badge: 'Corpo ativo',
      glow: 'from-sky-300/15 via-cyan-400/5 to-emerald-300/10',
    };
  }

  if (progress < 20) {
    return {
      name: 'Despertando',
      image: '/mascot/tamagochi-awakening.png',
      message: 'Estou acordando. Um pequeno cuidado já faz diferença.',
      accent: 'text-sky-300',
      animation: 'mascot-breathe',
      badge: 'Evolução inicial',
      glow: 'from-sky-400/10 via-cyan-400/5 to-emerald-300/10',
    };
  }

  if (progress < 40) {
    return {
      name: 'Brotando',
      image: '/mascot/tamagochi-sprouting.png',
      message: 'Cada hábito de hoje me ajuda a criar novas folhas.',
      accent: 'text-emerald-300',
      animation: 'mascot-float',
      badge: 'Evolução natural',
      glow: 'from-emerald-400/15 via-cyan-400/5 to-lime-300/10',
    };
  }

  if (progress < 60) {
    return {
      name: 'Crescendo',
      image: '/mascot/tamagochi-growing.png',
      message: 'Já estou cheio de energia. Vamos continuar crescendo!',
      accent: 'text-cyan-300',
      animation: 'mascot-float',
      badge: 'Evolução natural',
      glow: 'from-cyan-400/15 via-emerald-400/5 to-sky-300/10',
    };
  }

  if (progress < 75) {
    return {
      name: 'Fortalecido',
      image: '/mascot/tamagochi-strong.png',
      message: 'Os bons hábitos estão me deixando cada vez mais forte!',
      accent: 'text-sky-300',
      animation: 'mascot-flex',
      badge: 'Evolução natural',
      glow: 'from-sky-400/15 via-cyan-400/5 to-emerald-300/10',
    };
  }

  if (progress < 82) {
    return {
      name: 'Arvorezinha',
      image: '/mascot/tamagochi-tree.png',
      message: 'Criei raízes. Sua constância está virando vida de verdade.',
      accent: 'text-emerald-300',
      animation: 'mascot-sway',
      badge: 'Evolução avançada',
      glow: 'from-emerald-300/15 via-lime-400/5 to-amber-300/10',
    };
  }

  if (progress < 90) {
    return {
      name: 'Florescendo',
      image: '/mascot/tamagochi-flourishing.png',
      message: 'Uma flor nasceu! Falta pouco para transformar o dia por completo.',
      accent: 'text-lime-300',
      animation: 'mascot-celebrate',
      badge: 'Evolução avançada',
      glow: 'from-lime-300/15 via-emerald-400/10 to-amber-300/10',
    };
  }

  return {
    name: 'Árvore da Vida',
    image: '/mascot/tamagochi-life-tree.png',
    message: 'Florescemos juntos! Hoje sua rotina virou energia e vida.',
    accent: 'text-amber-300',
    animation: 'mascot-celebrate',
    badge: 'Evolução máxima',
    glow: 'from-amber-300/15 via-emerald-400/10 to-cyan-400/10',
  };
}

export default function TamagochiCompanion({
  progress,
  completed,
  total,
  signals,
}: {
  progress: number;
  completed: number;
  total: number;
  signals: CompanionSignals;
}) {
  const [hour, setHour] = useState(0);

  useEffect(() => {
    setHour(new Date().getHours());
  }, []);

  const stage = getStage(progress, hour, signals);

  return (
    <aside
      className={`relative isolate min-h-52 overflow-hidden rounded-[1.75rem] border border-emerald-300/15 bg-gradient-to-br ${stage.glow} p-4 transition-colors duration-700`}
      aria-label={`Seu Tamagochi está ${stage.name.toLowerCase()}`}
    >
      <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-cyan-300/10 blur-2xl" />
      <div className="absolute -bottom-10 -left-4 h-28 w-28 rounded-full bg-emerald-300/10 blur-2xl" />

      <div className="relative z-10 flex h-full items-center gap-3 sm:gap-5 lg:flex-col lg:justify-between lg:text-center">
        <div className={`relative h-36 w-36 shrink-0 sm:h-40 sm:w-40 lg:h-32 lg:w-32 ${stage.animation}`}>
          <Image
            key={stage.image}
            src={stage.image}
            alt={`Mascote no estágio ${stage.name}`}
            fill
            priority
            sizes="(max-width: 640px) 144px, 160px"
            className="object-contain drop-shadow-[0_14px_24px_rgba(48,187,255,0.2)]"
          />
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">{stage.badge}</p>
          <p className={`mt-1 text-lg font-semibold ${stage.accent}`}>{stage.name}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">{stage.message}</p>
          <p className="mt-2 text-[11px] text-slate-500">{completed} de {total} cuidados completos</p>
        </div>
      </div>
    </aside>
  );
}
