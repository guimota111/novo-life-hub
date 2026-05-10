'use client';

import { useState } from 'react';

export default function HealthUpload() {
  const [status, setStatus] = useState<string>('Arraste um arquivo JSON do Health Auto Export ou selecione manualmente.');

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const response = await fetch('/api/health/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: 'demo-user', payload }),
      });

      if (!response.ok) {
        throw new Error('Falha ao enviar o arquivo');
      }

      setStatus('Arquivo carregado com sucesso! Os dados foram salvos no Firestore.');
    } catch (error) {
      setStatus('Erro ao processar o arquivo. Verifique o JSON e tente novamente.');
      console.error(error);
    }
  }

  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/70 p-6 text-slate-200 shadow-lg">
      <label className="flex cursor-pointer flex-col items-center gap-4 rounded-3xl border border-dashed border-slate-700 bg-slate-900/70 p-6 text-center transition hover:border-tamagochi-500/70">
        <span className="text-lg font-semibold text-white">Upload Health JSON</span>
        <span className="max-w-sm text-sm text-slate-400">Arquivo exportado do Health Auto Export será lido e enviado para o Firestore.</span>
        <input type="file" accept="application/json" className="hidden" onChange={handleFile} />
      </label>
      <p className="mt-4 text-sm text-slate-400">{status}</p>
    </div>
  );
}
