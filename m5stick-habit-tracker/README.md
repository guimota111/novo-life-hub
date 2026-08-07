# Habit Tracker de Bolso — M5StickC Plus2

Display + interface de input que sincroniza 5 hábitos (água, academia, corridas,
creatina, estudo) com o **Firebase Realtime Database** em tempo real.

## Estrutura do projeto

```
m5stick-habit-tracker/
├── platformio.ini        # ambiente, board e libs
├── include/config.h      # WiFi + credenciais Firebase (edite aqui)
├── src/main.cpp          # firmware completo
└── README.md
```

## Controles

| Botão                      | Ação                                             |
|----------------------------|--------------------------------------------------|
| **A** (frente) — clique    | Navega entre os 5 hábitos (cicla)                |
| **A** (frente) — segurar 1s| Force refresh: GET completo do Firebase (pisca)  |
| **B** (topo) — clique      | Incrementa o hábito em foco (+1 → PATCH)         |
| **B** (topo) — segurar 1s  | Decrementa o hábito em foco (−1 → PATCH) *(bônus)*|

Cada ação toca um beep de confirmação. O display mostra bateria e status do WiFi
no topo, o valor grande `atual`, a meta, uma barra de progresso e a porcentagem
(verde = completo).

## Configuração

Copie `include/config.h.example` para `include/config.h` (ignorado pelo git,
fica só na sua máquina) e preencha os valores.

### 1. Firebase
No `include/config.h`:

- `FIREBASE_DB_HOST` — host do RTDB **sem** `https://` e **sem** barra final, ex:
  `meu-projeto-default-rtdb.firebaseio.com` ou `meu-projeto.sa-east1.firebasedatabase.app`
- `FIREBASE_API_KEY` — *Web API Key* (Console → Config do projeto → Geral)
- `FIREBASE_ROOT` — nó que agrupa os hábitos (padrão `habitos`)

O firmware faz **login anônimo** (Identity Toolkit) e renova o token
automaticamente. Habilite o provedor **Anônimo** em
*Authentication → Sign-in method*.

Regras do Realtime Database (permite usuário autenticado ler/escrever `habitos`):

```json
{
  "rules": {
    "habitos": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

Estrutura de dados esperada:

```json
{
  "habitos": {
    "agua":     { "atual": 8, "meta": 10 },
    "academia": { "atual": 3, "meta": 5 },
    "corridas": { "atual": 2, "meta": 4 },
    "creatina": { "atual": 1, "meta": 1 },
    "estudo":   { "atual": 1, "meta": 2 }
  }
}
```

### 2. WiFi
Ainda no `config.h`: `WIFI_SSID` e `WIFI_PASSWORD`.

## Build & Upload

Com o [PlatformIO](https://platformio.org/) instalado (VS Code ou CLI):

```bash
cd m5stick-habit-tracker
pio run                 # compila
pio run -t upload       # grava no StickC Plus2 (conecte via USB-C)
pio device monitor      # logs em 115200 baud
```

## Notas técnicas

- **Sem lib pesada de Firebase**: o firmware fala REST direto com o RTDB
  (`GET habitos.json` / `PATCH habitos/<key>.json`) usando `HTTPClient` +
  `WiFiClientSecure` + `ArduinoJson`. Leve e fácil de adaptar.
- **TLS**: usa `client.setInsecure()` (pula validação de certificado) para
  simplicidade de um dispositivo de hobby. Para produção, fixe o certificado raiz
  do Google.
- **Re-sync automático** a cada 60s (`AUTO_SYNC_INTERVAL_MS` no config).
- **Feedback otimista**: o incremento aparece na tela na hora; se o PATCH falhar,
  o valor é revertido e mostra `ERRO SYNC`.
- Rótulos no display são maiúsculos sem acento para evitar problemas de fonte na
  tela pequena; as **chaves** do Firebase seguem o schema (`agua`, `academia`, …).

## Próximos passos sugeridos

- Provisionamento de WiFi via portal cativo (WiFiManager) em vez de hardcode.
- Stream de eventos do RTDB (SSE) para atualização push em vez de polling.
- Fixar o certificado raiz do Google para TLS validado.
