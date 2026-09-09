'use client';

import { useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { parseSmartGymExport } from '@/lib/smartgym';
import { buildImportPlan, fmtDatePt, writeImportPlan, type ImportPlan, type WorkoutData } from '@/lib/workouts';
import { AlertTriangle, Check, FileText, Loader2, Search, Upload, X } from 'lucide-react';

// Importação da exportação do SmartGym: cola o texto ou escolhe o .txt,
// analisa (parser + plano), mostra o que vai acontecer, e só então grava.

interface Props {
  existing: WorkoutData;
  onImported: (dates: string[]) => void | Promise<void>;
}

export default function WorkoutImport({ existing, onImported }: Props) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setPlan(null); setWarnings([]); setError(null); setDone(null); };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setText(await f.text());
    setFileName(f.name);
    reset();
    e.target.value = '';
  };

  const analyze = () => {
    reset();
    try {
      const parsed = parseSmartGymExport(text);
      setWarnings(parsed.warnings);
      if (!parsed.templates.length && !parsed.sessions.length) {
        setError('Não reconheci nenhuma ficha ou sessão nesse texto. Cole o email inteiro ou pelo menos um bloco com a linha "Objetivo:".');
        return;
      }
      setPlan(buildImportPlan(parsed, existing));
    } catch (err) {
      setError(`Erro ao analisar: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const doImport = async () => {
    if (!user || !plan) return;
    setImporting(true);
    setError(null);
    try {
      await writeImportPlan(db, user.uid, plan);
      const dates = Array.from(new Set(plan.sessions.map(s => s.date)));
      const s = plan.summary;
      setDone(`${s.sessionsNew} ${s.sessionsNew === 1 ? 'sessão nova' : 'sessões novas'}, ${s.sessionsUpdated} ${s.sessionsUpdated === 1 ? 'atualizada' : 'atualizadas'}, ${s.templates} fichas e ${s.exercisesNew} ${s.exercisesNew === 1 ? 'exercício novo' : 'exercícios novos'}.`);
      setPlan(null);
      setText('');
      setFileName(null);
      await onImported(dates);
    } catch (err) {
      setError(`Falha ao gravar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const s = plan?.summary;

  return (
    <div className="space-y-4">
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6">
        <p className="text-sm uppercase tracking-widest text-tamagochi-300">Importar do SmartGym</p>
        <p className="mt-1 text-sm text-slate-400">
          Cole o email da exportação (ou só o final dele, com as últimas sessões) ou escolha o arquivo .txt.
          Sessões com a mesma data e ficha são substituídas pelo que vier do SmartGym; o resto fica como está.
        </p>

        <textarea
          value={text}
          onChange={e => { setText(e.target.value); if (plan || done) reset(); }}
          rows={8}
          spellCheck={false}
          placeholder={'SmartGym\n\nFICHAS\n\nPush A\nUma vez por semana\n\n\nObjetivo:\n...'}
          className="mt-4 w-full resize-y rounded-2xl border border-white/10 bg-slate-950/60 p-3 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-tamagochi-400 focus:outline-none"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={handleFile} />
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/10"
          >
            <Upload size={15} /> Escolher .txt
          </button>
          {fileName && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
              <FileText size={13} /> {fileName}
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={analyze}
            disabled={!text.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-tamagochi-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-tamagochi-400 disabled:opacity-40"
          >
            <Search size={15} /> Analisar
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {done && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          <Check size={18} className="mt-0.5 shrink-0" />
          <p>Importado: {done}</p>
        </div>
      )}

      {plan && s && (
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6">
          <p className="text-sm uppercase tracking-widest text-tamagochi-300">O que vai entrar</p>
          {s.firstDate && s.lastDate && (
            <p className="mt-1 text-xs text-slate-500">
              Sessões de {fmtDatePt(s.firstDate, true)} a {fmtDatePt(s.lastDate, true)}
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Fichas',               value: s.templates,       hint: 'atualizadas' },
              { label: 'Sessões novas',        value: s.sessionsNew,     hint: 'não existiam' },
              { label: 'Sessões atualizadas',  value: s.sessionsUpdated, hint: 'mesma data + ficha' },
              { label: 'Exercícios novos',     value: s.exercisesNew,    hint: 'no catálogo' },
            ].map(t => (
              <div key={t.label} className="rounded-2xl border border-white/10 bg-slate-900/50 p-3 text-center">
                <p className="text-2xl font-bold text-white">{t.value}</p>
                <p className="text-[11px] text-slate-400">{t.label}</p>
                <p className="text-[10px] text-slate-600">{t.hint}</p>
              </div>
            ))}
          </div>

          {warnings.length > 0 && (
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200">
              <p className="mb-1 font-semibold">Avisos do parser</p>
              <ul className="list-inside list-disc space-y-0.5">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={doImport}
              disabled={importing || plan.sessions.length + plan.templates.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-tamagochi-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-tamagochi-400 disabled:opacity-40"
            >
              {importing ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Importar {plan.sessions.length} {plan.sessions.length === 1 ? 'sessão' : 'sessões'}
            </button>
            <button
              onClick={reset}
              disabled={importing}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10"
            >
              <X size={15} /> Cancelar
            </button>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Todos os dias com sessão são marcados como &quot;fui à academia&quot; no calendário.
          </p>
        </div>
      )}
    </div>
  );
}
