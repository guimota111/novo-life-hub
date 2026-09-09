import Sidebar from '@/components/Sidebar';
import LeituraPage from '@/components/LeituraPage';
import { BookOpen } from 'lucide-react';

export default function Page() {
  return (
    <main className="min-h-screen bg-[#08101a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Sidebar />
        <section className="min-w-0 flex-1 space-y-5">
          <header className="flex items-center gap-3 rounded-[2rem] border border-white/10 bg-white/5 px-5 py-4 shadow-glow backdrop-blur-xl sm:px-7 sm:py-5">
            <BookOpen size={22} className="text-sky-400" />
            <div>
              <h1 className="text-lg font-semibold text-white sm:text-xl">Leitura</h1>
              <p className="text-xs text-slate-400 sm:text-sm">Livros, sessões e progresso de leitura.</p>
            </div>
          </header>
          <LeituraPage />
        </section>
      </div>
    </main>
  );
}
