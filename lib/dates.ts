// Helpers de data — fonte unica de verdade para "hoje" no fuso do Brasil.
// O servidor (App Hosting) roda em UTC; sem forcar o fuso, apos ~21h os
// registros caem no dia seguinte. Sempre use isto no lado servidor.

// "Hoje" em America/Sao_Paulo no formato AAAA-MM-DD (en-CA => ISO).
export function getTodaySP(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
