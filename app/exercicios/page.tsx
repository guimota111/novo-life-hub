import Sidebar from '@/components/Sidebar';

export default function ExerciciosPage() {
  return (
    <main className="min-h-screen bg-[#08101a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Sidebar />
        <section className="flex-1 rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-glow backdrop-blur-xl">
          <h1 className="text-3xl font-semibold text-white">Exercícios</h1>
          <p className="mt-4 text-slate-400">Registros de treinos, séries e evolução física.</p>
        </section>
      </div>
    </main>
  );
}
