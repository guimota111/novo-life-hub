# Tamagochi Me

Projeto inicial de tracker de hábitos usando:

- Next.js App Router
- TypeScript
- Tailwind CSS
- Firebase Auth, Firestore e Hosting
- Lucide Icons

## Estrutura

- `app/` - interface App Router e página inicial
- `components/` - Sidebar, upload de Health JSON
- `lib/firebase.ts` - configuração do Firebase client
- `app/api/water/increment/route.ts` - endpoint para incremento de água
- `app/api/creatine/increment/route.ts` - endpoint para incremento de creatina
- `app/api/health/upload/route.ts` - endpoint para envio de Health JSON

## Funcionalidades

- **Dashboard**: Visão geral com cards de progresso
- **Hidratação**: Controle via NFC/iOS Shortcuts (POST /api/water/increment)
- **Creatina**: Controle de suplementação via NFC/entrada manual (POST /api/creatine/increment)
- **Saúde**: Importação de dados do Health Auto Export
- **Conhecimento**: Leitura e estudos
- **Lazer**: Controle de filmes assistidos

## Configuração

Copie variáveis do Firebase para `.env.local`:

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

## Rodando localmente

```bash
npm install
npm run dev
```
