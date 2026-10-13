'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

type CompanionStage = {
  name: string;
  image: string;
  message: string;
  accent: string;
  animation: string;
};

function getStage(progress: number, hour: number): CompanionStage {
  if (progress < 20 && hour >= 12) {
    return {
      name: 'Irritado',
      image: '/mascot/tamagochi-angry.png',
      message: 'Ei! Meus hábitos estão ficando para trás. Vamos reagir?',
      accent: 'text-orange-300',
      animation: 'mascot-grumble',
    };
  }

  if (progress < 20) {
    return {
      name: 'Despertando',
      image: '/mascot/tamagochi-awakening.png',
      message: 'Estou acordando. Um pequeno cuidado já faz diferença.',
      accent: 'text-sky-300',
      animation: 'mascot-breathe',
    };
  }

  if (progress < 40) {
    return {
      name: 'Brotando',
      image: '/mascot/tamagochi-sprouting.png',
      message: 'Cada hábito de hoje me ajuda a criar novas folhas.',
      accent: 'text-emerald-300',
      animation: 'mascot-float',
    };
  }

  if (progress < 60) {
    return {
      name: 'Crescendo',
      image: '/mascot/tamagochi-growing.png',
      message: 'Já estou cheio de energia. Vamos continuar crescendo!',
      accent: 'text-cyan-300',
      animation: 'mascot-float',
    };
  }

  if (progress < 75) {
    return {
      name: 'Fortalecido',
      image: '/mascot/tamagochi-strong.png',
      message: 'Os bons hábitos estão me deixando cada vez mais forte!',
      accent: 'text-sky-300',
      animation: 'mascot-flex',
    };
  }

  if (progress < 90) {
    return {
      name: 'Arvorezinha',
      image: '/mascot/tamagochi-tree.png',
      message: 'Criei raízes. Sua constância está virando vida de verdade.',
      accent: 'text-emerald-300',
      animation: 'mascot-sway',
    };
  }

  return {
    name: 'Árvore da Vida',
    image: '/mascot/tamagochi-life-tree.png',
    message: 'Florescemos juntos! Hoje sua rotina virou energia e vida.',
    accent: 'text-amber-300',
    animation: 'mascot-celebrate',
  };
}

export default function TamagochiCompanion({
  progress,
  completed,
  total,
}: {
  progress: number;
  completed: number;
  total: number;
}) {
  const [hour, setHour] = useState(0);

  useEffect(() => {
    setHour(new Date().getHours());
  }, []);

  const stage = getStage(progress, hour);

  return (
    <aside
      className="relative isolate min-h-52 overflow-hidden rounded-[1.75rem] border border-emerald-300/15 bg-gradient-to-br from-cyan-400/10 via-emerald-400/5 to-amber-300/10 p-4"
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">Seu Tamagochi</p>
          <p className={`mt-1 text-lg font-semibold ${stage.accent}`}>{stage.name}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">{stage.message}</p>
          <p className="mt-2 text-[11px] text-slate-500">{completed} de {total} cuidados completos</p>
        </div>
      </div>
    </aside>
  );
}
