import Sidebar from '@/components/Sidebar';
import EstudoPage from '@/components/EstudoPage';
import { GraduationCap } from 'lucide-react';

export default function Page() {
  return (
    <main className="min-h-screen bg-[#08101a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Sidebar />
        <section className="min-w-0 flex-1 space-y-5">
          <header className="flex items-center gap-3 rounded-[2rem] border border-white/10 bg-white/5 px-7 py-5 shadow-glow backdrop-blur-xl">
            <GraduationCap size={22} className="text-cyan-400" />
            <div>
              <h1 className="text-xl font-semibold text-white">Estudo</h1>
              <p className="text-sm text-slate-400">Sessões de estudo, áreas e progresso de aprendizado.</p>
            </div>
          </header>
          <EstudoPage />
        </section>
      </div>
    </main>
  );
}
