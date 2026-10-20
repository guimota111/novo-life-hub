'use client';

import Image from 'next/image';
import { useEffect, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';

const mascotForms = [
  {
    name: 'Despertando',
    image: '/mascot/tamagochi-awakening.png',
    category: 'Evolução natural',
    tone: 'text-sky-300',
    condition: 'De 0% a 19% de progresso, antes do meio-dia.',
    description: 'A forma inicial: uma pequena ação já começa a acordá-lo.',
  },
  {
    name: 'Irritado',
    image: '/mascot/tamagochi-angry.png',
    category: 'Estado crítico',
    tone: 'text-orange-300',
    condition: 'Menos de 20% de progresso a partir do meio-dia.',
    description: 'Ele cobra uma reação quando os cuidados do dia estão ficando para trás.',
  },
  {
    name: 'Sonolento',
    image: '/mascot/tamagochi-sleepy.png',
    category: 'Estado do dia',
    tone: 'text-indigo-300',
    condition: 'Depois das 22h, com menos de 50% de progresso.',
    description: 'O dia está terminando e ele lembra dos últimos cuidados antes de dormir.',
  },
  {
    name: 'Sedento',
    image: '/mascot/tamagochi-thirsty.png',
    category: 'Necessidade urgente',
    tone: 'text-cyan-300',
    condition: 'Após as 10h, água abaixo de 25% e progresso geral abaixo de 65%.',
    description: 'A folhinha murcha para avisar que está na hora de beber água.',
  },
  {
    name: 'Brotando',
    image: '/mascot/tamagochi-sprouting.png',
    category: 'Evolução natural',
    tone: 'text-emerald-300',
    condition: 'De 20% a 39% de progresso, sem um estado especial ativo.',
    description: 'Os primeiros hábitos completos fazem surgir novas folhas.',
  },
  {
    name: 'Crescendo',
    image: '/mascot/tamagochi-growing.png',
    category: 'Evolução natural',
    tone: 'text-cyan-300',
    condition: 'De 40% a 59% de progresso, sem um estado especial ativo.',
    description: 'Mais energia e presença conforme o dia ganha ritmo.',
  },
  {
    name: 'Focado',
    image: '/mascot/tamagochi-focused.png',
    category: 'Ramificação da mente',
    tone: 'text-amber-200',
    condition: 'Metas de leitura e estudo completas, com pelo menos 45% de progresso.',
    description: 'Livro e óculos aparecem quando conhecimento vira parte do cuidado.',
  },
  {
    name: 'Zen',
    image: '/mascot/tamagochi-zen.png',
    category: 'Ramificação do equilíbrio',
    tone: 'text-teal-200',
    condition: 'Meta de meditação completa, com pelo menos 40% de progresso.',
    description: 'Uma forma tranquila que celebra presença, pausa e respiração.',
  },
  {
    name: 'Fortalecido',
    image: '/mascot/tamagochi-strong.png',
    category: 'Ramificação do corpo',
    tone: 'text-sky-300',
    condition: 'Treino e passos completos com 50% ou mais; também surge naturalmente entre 60% e 74%.',
    description: 'O movimento transforma suas raízes em força.',
  },
  {
    name: 'Guardião da sequência',
    image: '/mascot/tamagochi-streak-guardian.png',
    category: 'Ramificação rara',
    tone: 'text-yellow-300',
    condition: 'Sequência de 7 dias ou mais em qualquer hábito e pelo menos 65% de progresso.',
    description: 'Uma evolução dourada despertada pela constância.',
  },
  {
    name: 'Arvorezinha',
    image: '/mascot/tamagochi-tree.png',
    category: 'Evolução avançada',
    tone: 'text-emerald-300',
    condition: 'De 75% a 81% de progresso, sem uma ramificação especial ativa.',
    description: 'O cuidado cria raízes e o mascote começa a virar árvore.',
  },
  {
    name: 'Florescendo',
    image: '/mascot/tamagochi-flourishing.png',
    category: 'Evolução avançada',
    tone: 'text-lime-300',
    condition: 'De 82% a 89% de progresso, sem uma ramificação especial ativa.',
    description: 'O broto ganha uma flor dourada quando o dia está quase completo.',
  },
  {
    name: 'Árvore da Vida',
    image: '/mascot/tamagochi-life-tree.png',
    category: 'Evolução máxima',
    tone: 'text-amber-300',
    condition: '90% ou mais de progresso geral no dia.',
    description: 'A forma máxima: uma árvore completa, viva e cheia de frutos.',
  },
] as const;

export default function MascotGalleryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="mascot-gallery-title">
      <button className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} aria-label="Fechar galeria" />

      <section className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#0a1724] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-7 sm:py-5">
          <div>
            <div className="flex items-center gap-2 text-tamagochi-300">
              <Sparkles size={17} />
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em]">Coleção do Tamagochi</p>
            </div>
            <h2 id="mascot-gallery-title" className="mt-1 text-xl font-semibold text-white sm:text-2xl">Todas as formas do mascote</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400 sm:text-sm">
              O estado atual segue uma ordem de prioridade: necessidades urgentes, ramificações especiais e evolução natural.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="shrink-0 rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-tamagochi-400"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </header>

        <div className="overflow-y-auto overscroll-contain p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mascotForms.map((form) => (
              <article key={form.name} className="group overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] transition hover:border-tamagochi-400/30 hover:bg-white/[0.055]">
                <div className="relative h-44 overflow-hidden bg-gradient-to-br from-cyan-400/10 via-emerald-400/5 to-amber-300/10 sm:h-48">
                  <Image
                    src={form.image}
                    alt={`Mascote ${form.name}`}
                    fill
                    sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 30vw"
                    className="object-contain p-3 transition duration-300 group-hover:scale-[1.035]"
                  />
                </div>
                <div className="space-y-2 p-4">
                  <div>
                    <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${form.tone}`}>{form.category}</p>
                    <h3 className="mt-1 text-lg font-semibold text-white">{form.name}</h3>
                  </div>
                  <p className="text-xs font-medium leading-relaxed text-slate-300">{form.condition}</p>
                  <p className="text-xs leading-relaxed text-slate-500">{form.description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
