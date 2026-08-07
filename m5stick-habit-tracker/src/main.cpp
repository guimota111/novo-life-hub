// ============================================================
//  Habit Tracker de Bolso  -  M5StickC Plus2
//  Fala com as APIs do app (Firebase App Hosting):
//    GET  /api/device/summary?token=...   -> le as metricas de hoje
//    POST /api/device/action?token=...    -> incrementa (num) / define (bool)
//
//  Conectividade:
//    - Multi-rede: conecta em casa OU no hotspot do celular (o que estiver no ar).
//    - Modo offline: sem conexao, os incrementos ficam guardados na memoria
//      (NVS) e sobem sozinhos quando reconecta. Nada se perde.
//
//  Telas:
//    View 0        = Visao geral (todos os habitos; so leitura)
//    View 1..N     = Detalhe de um habito (edita)
//
//  Controles:
//    Botao A (frente) - clique : proxima tela   | segurar : force refresh
//    Botao B (topo)   - clique : incrementa/marca| segurar : decrementa (num)
//
//  Bateria: apos SCREEN_TIMEOUT_MS sem uso entra em LIGHT SLEEP (~1mA).
//  Qualquer botao acorda; o toque que acorda so liga a tela.
// ============================================================
#include <M5Unified.h>
#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "esp_sleep.h"
#include "driver/gpio.h"
#include "config.h"

#define BTN_A_GPIO  37
#define BTN_B_GPIO  39

enum MetricType { NUM = 0, BOOL = 1, READONLY = 2 };

struct Habit {
  const char* key;
  const char* label;
  uint16_t    color;
  MetricType  type;
  int         inc;
  int         atual;
  int         meta;
};

Habit habits[] = {
  { "agua",      "AGUA",      0x05DF, NUM,      INC_AGUA,      0, 1 },  // ciano
  { "academia",  "ACADEMIA",  0xFB90, BOOL,     0,             0, 1 },  // rose
  { "creatina",  "CREATINA",  0xB59F, BOOL,     0,             0, 1 },  // roxo
  { "estudo",    "ESTUDO",    0x9CDF, NUM,      INC_ESTUDO,    0, 1 },  // violeta
  { "meditacao", "MEDITACAO", 0x2EB7, NUM,      INC_MEDITACAO, 0, 1 },  // teal
  { "passos",    "PASSOS",    0x07E7, READONLY, 0,             0, 1 },  // verde
  { "leitura",   "LEITURA",   0xFD20, NUM,      INC_LEITURA,   0, 1 },  // ambar
};
const int HABIT_COUNT = sizeof(habits) / sizeof(habits[0]);

int  view = 0;
uint32_t lastSyncMs      = 0;
uint32_t lastActivityMs  = 0;
uint32_t lastReconnectMs = 0;
bool online        = false;
bool displayAsleep = false;
bool wakeSwallow   = false;

WiFiMulti   wifiMulti;
Preferences prefs;

// Fila offline (coalesce por metrica):
int    pendingDelta[16];   // NUM: soma dos incrementos nao enviados
int8_t pendingBool[16];    // BOOL: valor alvo nao enviado (-1 = nenhum)

static void render(bool flash = false);

// ============================================================
//  Fila offline (persistida em NVS)
// ============================================================
static void loadQueue() {
  if (prefs.getBytes("pd", pendingDelta, sizeof(pendingDelta)) != sizeof(pendingDelta))
    memset(pendingDelta, 0, sizeof(pendingDelta));
  if (prefs.getBytes("pb", pendingBool, sizeof(pendingBool)) != sizeof(pendingBool))
    memset(pendingBool, -1, sizeof(pendingBool));
}
static void saveQueue() {
  prefs.putBytes("pd", pendingDelta, sizeof(pendingDelta));
  prefs.putBytes("pb", pendingBool, sizeof(pendingBool));
}
static bool hasPending() {
  for (int i = 0; i < HABIT_COUNT; i++)
    if (pendingBool[i] >= 0 || pendingDelta[i] != 0) return true;
  return false;
}

// ============================================================
//  HTTP
// ============================================================
static int httpRequest(const char* method, const String& url,
                       const String& body, String& out) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, url)) return -1;
  if (body.length()) http.addHeader("Content-Type", "application/json");
  int code = body.length()
    ? http.sendRequest(method, (uint8_t*)body.c_str(), body.length())
    : http.sendRequest(method);
  out = (code > 0) ? http.getString() : "";
  http.end();
  return code;
}

static Habit* findHabit(const char* key) {
  for (int i = 0; i < HABIT_COUNT; i++)
    if (strcmp(habits[i].key, key) == 0) return &habits[i];
  return nullptr;
}

static bool fetchSummary() {
  String resp;
  int code = httpRequest("GET",
    String(API_BASE) + "/api/device/summary?token=" DEVICE_TOKEN, "", resp);
  if (code != 200) { Serial.printf("[api] summary falhou: %d\n", code); return false; }
  JsonDocument doc;
  if (deserializeJson(doc, resp)) { Serial.println("[api] JSON invalido"); return false; }

  JsonObject metrics = doc["metrics"];
  for (JsonPair kv : metrics) {
    Habit* h = findHabit(kv.key().c_str());
    if (!h) continue;
    // nao sobrescreve metrica com incremento offline ainda pendente
    int idx = h - habits;
    if (pendingBool[idx] >= 0 || pendingDelta[idx] != 0) {
      h->meta = kv.value()["meta"] | h->meta;
      continue;
    }
    h->atual = kv.value()["atual"] | h->atual;
    h->meta  = kv.value()["meta"]  | h->meta;
    if (h->meta < 1) h->meta = 1;
  }
  lastSyncMs = millis();
  Serial.println("[api] summary OK");
  return true;
}

// Envia uma acao ao servidor. val = alvo (0/1) p/ BOOL, delta p/ NUM.
static bool apiSend(int idx, int val) {
  Habit& h = habits[idx];
  String body = (h.type == BOOL)
    ? String("{\"metric\":\"") + h.key + "\",\"value\":" + val + "}"
    : String("{\"metric\":\"") + h.key + "\",\"amount\":" + val + "}";
  String resp;
  int code = httpRequest("POST",
    String(API_BASE) + "/api/device/action?token=" DEVICE_TOKEN, body, resp);
  if (code != 200) { Serial.printf("[api] action falhou: %d\n", code); return false; }
  JsonDocument doc;
  if (deserializeJson(doc, resp)) return false;
  h.atual = doc["atual"] | h.atual;
  h.meta  = doc["meta"]  | h.meta;
  if (h.meta < 1) h.meta = 1;
  return true;
}

// Envia tudo que estiver na fila. Retorna true se esvaziou.
static bool flushQueue() {
  bool all = true;
  for (int i = 0; i < HABIT_COUNT; i++) {
    if (habits[i].type == BOOL) {
      if (pendingBool[i] >= 0) {
        if (apiSend(i, pendingBool[i])) pendingBool[i] = -1; else all = false;
      }
    } else {
      if (pendingDelta[i] != 0) {
        if (apiSend(i, pendingDelta[i])) pendingDelta[i] = 0; else all = false;
      }
    }
  }
  saveQueue();
  return all;
}

// ============================================================
//  Estado dos habitos
// ============================================================
static bool habitDone(const Habit& h) {
  return (h.type == BOOL) ? (h.atual >= 1) : (h.atual >= h.meta);
}
static float habitPct(const Habit& h) {
  if (h.type == BOOL) return habitDone(h) ? 1.0f : 0.0f;
  return (float)h.atual / (float)h.meta;
}
static void applyLocal(int idx, int val) {
  Habit& h = habits[idx];
  if (h.type == BOOL) h.atual = val ? 1 : 0;
  else                h.atual = max(0, h.atual + val);
}

// ============================================================
//  UI (portrait 135x240)
// ============================================================
static const int W = 135;
static const int H = 240;

static void drawTopBar() {
  M5.Display.fillRect(0, 0, W, 22, TFT_BLACK);
  M5.Display.setTextSize(1);
  M5.Display.setTextDatum(top_left);
  M5.Display.setTextColor(online ? TFT_GREEN : TFT_RED, TFT_BLACK);
  M5.Display.drawString(online ? "WIFI" : "OFF", 4, 6);
  if (hasPending()) {   // ha dados aguardando sincronizar
    M5.Display.setTextColor(TFT_ORANGE, TFT_BLACK);
    M5.Display.drawString("*", online ? 34 : 26, 6);
  }
  int bat = M5.Power.getBatteryLevel();
  M5.Display.setTextDatum(top_right);
  uint16_t bc = bat > 40 ? TFT_GREEN : (bat > 15 ? TFT_YELLOW : TFT_RED);
  M5.Display.setTextColor(bc, TFT_BLACK);
  M5.Display.drawString(String(bat) + "%", W - 4, 6);
}

static void drawProgress(int y, float pct, uint16_t color) {
  const int x = 12, w = W - 24, h = 16;
  M5.Display.drawRoundRect(x, y, w, h, 4, TFT_DARKGREY);
  int fill = (int)((w - 4) * constrain(pct, 0.0f, 1.0f));
  if (fill > 0) M5.Display.fillRoundRect(x + 2, y + 2, fill, h - 4, 2, color);
}

static void drawOverview() {
  M5.Display.fillScreen(TFT_BLACK);
  drawTopBar();
  const int startY = 25;
  const int rowH = (H - startY) / HABIT_COUNT;
  for (int i = 0; i < HABIT_COUNT; i++) {
    Habit& h = habits[i];
    bool done = habitDone(h);
    uint16_t accent = done ? TFT_GREEN : h.color;
    int y = startY + i * rowH;

    M5.Display.setTextSize(1);
    M5.Display.setTextDatum(top_left);
    M5.Display.setTextColor(accent, TFT_BLACK);
    M5.Display.drawString(h.label, 6, y);

    M5.Display.setTextDatum(top_right);
    M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
    String val = (h.type == BOOL) ? (done ? "OK" : "--")
                                   : (String(h.atual) + "/" + String(h.meta));
    M5.Display.drawString(val, W - 6, y);

    int bx = 6, by = y + 11, bw = W - 12, bh = 5;
    M5.Display.drawRoundRect(bx, by, bw, bh, 2, TFT_DARKGREY);
    int fill = (int)((bw - 2) * constrain(habitPct(h), 0.0f, 1.0f));
    if (fill > 0) M5.Display.fillRoundRect(bx + 1, by + 1, fill, bh - 2, 1, accent);
  }
}

static void drawDetail(int idx, bool flash) {
  Habit& h = habits[idx];
  bool done = habitDone(h);
  uint16_t accent = done ? TFT_GREEN : h.color;

  M5.Display.fillScreen(flash ? accent : TFT_BLACK);
  if (flash) { delay(90); M5.Display.fillScreen(TFT_BLACK); }
  drawTopBar();

  M5.Display.setTextDatum(top_center);
  M5.Display.setTextColor(TFT_DARKGREY, TFT_BLACK);
  M5.Display.setTextSize(1);
  M5.Display.drawString(String(idx + 1) + "/" + String(HABIT_COUNT), W / 2, 30);

  M5.Display.setTextColor(accent, TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.drawString(h.label, W / 2, 48);

  M5.Display.setTextDatum(middle_center);
  if (h.type == BOOL) {
    M5.Display.setTextSize(4);
    M5.Display.setTextColor(done ? TFT_GREEN : TFT_DARKGREY, TFT_BLACK);
    M5.Display.drawString(done ? "FEITO" : "FALTA", W / 2, 112);
  } else {
    M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
    M5.Display.setTextSize(5);
    M5.Display.drawString(String(h.atual), W / 2, 108);
    M5.Display.setTextSize(2);
    M5.Display.setTextColor(TFT_DARKGREY, TFT_BLACK);
    M5.Display.drawString("/ " + String(h.meta), W / 2, 148);
  }

  drawProgress(172, habitPct(h), accent);
  M5.Display.setTextDatum(top_center);
  M5.Display.setTextColor(accent, TFT_BLACK);
  M5.Display.setTextSize(1);
  int pctInt = (int)(constrain(habitPct(h), 0.0f, 1.0f) * 100);
  if (done) M5.Display.drawString("COMPLETO!", W / 2, 196);
  else      M5.Display.drawString(String(pctInt) + "%", W / 2, 196);

  M5.Display.setTextColor(TFT_DARKGREY, TFT_BLACK);
  if (h.type == READONLY) M5.Display.drawString("A:nav  (auto)", W / 2, 222);
  else if (h.type == BOOL) M5.Display.drawString("A:nav  B:marcar", W / 2, 222);
  else M5.Display.drawString("A:nav  B:+", W / 2, 222);
}

static void render(bool flash) {
  if (view == 0) drawOverview();
  else           drawDetail(view - 1, flash);
}

static void showStatus(const String& msg, uint16_t color = TFT_WHITE) {
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextDatum(middle_center);
  M5.Display.setTextColor(color, TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.drawString(msg, W / 2, H / 2);
}

static void beep(int freq = 4000, int ms = 60) { M5.Speaker.tone(freq, ms); }

// ============================================================
//  WiFi (multi-rede)
// ============================================================
static bool connectWiFi() {
  showStatus("WiFi...", TFT_CYAN);
  uint32_t t0 = millis();
  while (wifiMulti.run() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(300);
    M5.Display.print(".");
  }
  online = (WiFi.status() == WL_CONNECTED);
  if (online) WiFi.setSleep(true);
  Serial.println(online ? "[wifi] conectado" : "[wifi] falhou");
  return online;
}

// ============================================================
//  Sleep / wake (light sleep)
// ============================================================
static void registerActivity() { lastActivityMs = millis(); }

static void enterLightSleep() {
  Serial.println("[power] light sleep");
  Serial.flush();
  M5.Display.setBrightness(0);
  M5.Display.sleep();
  displayAsleep = true;
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  online = false;

  gpio_wakeup_enable((gpio_num_t)BTN_A_GPIO, GPIO_INTR_LOW_LEVEL);
  gpio_wakeup_enable((gpio_num_t)BTN_B_GPIO, GPIO_INTR_LOW_LEVEL);
  esp_sleep_enable_gpio_wakeup();
  esp_light_sleep_start();            // dorme ate apertar botao

  M5.Display.wakeup();
  M5.Display.setBrightness(BRIGHTNESS);
  displayAsleep = false;
  wakeSwallow = true;
  registerActivity();
  WiFi.mode(WIFI_STA);                // radio de volta; loop reconecta
  lastReconnectMs = 0;
  render();
  Serial.println("[power] acordou");
}

// ============================================================
//  Acoes
// ============================================================
static void actionNext() {
  view = (view + 1) % (HABIT_COUNT + 1);
  beep(3000, 30);
  render();
}

// Aplica local (otimista), enfileira e tenta enviar se online.
static void doAction(int idx, int val) {
  applyLocal(idx, val);
  if (habits[idx].type == BOOL) pendingBool[idx] = habits[idx].atual ? 1 : 0;
  else                          pendingDelta[idx] += val;
  saveQueue();
  render();

  if (online && flushQueue()) {
    render();                          // valor autoritativo do servidor
  } else {
    showStatus("OFFLINE", TFT_ORANGE);
    beep(2500, 60);
    delay(500);
    render();
  }
}

static void actionButtonB(int sign) {   // +1 clique, -1 segurar
  if (view == 0) { beep(1500, 40); return; }
  int idx = view - 1;
  Habit& h = habits[idx];

  if (h.type == READONLY) {
    showStatus("SO LEITURA", TFT_YELLOW);
    beep(1500, 80); delay(600); render();
    return;
  }

  int val = (h.type == BOOL) ? (habitDone(h) ? 0 : 1) : (h.inc * sign);
  beep(h.type == BOOL ? 4200 : (sign > 0 ? 4500 : 2000), 60);
  doAction(idx, val);
}

static void actionForceRefresh() {
  showStatus("SYNC...", TFT_YELLOW);
  beep(3500, 40);
  bool ok = online && flushQueue();
  if (online) ok = fetchSummary() || ok;
  render(ok);
  if (!online) { showStatus("OFFLINE", TFT_ORANGE); delay(700); render(); }
}

// ============================================================
//  Setup / Loop
// ============================================================
void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(0);
  M5.Display.setBrightness(BRIGHTNESS);
  M5.Speaker.begin();
  M5.Speaker.setVolume(180);
  M5.BtnA.setHoldThresh(HOLD_MS);
  M5.BtnB.setHoldThresh(HOLD_MS);
  Serial.begin(115200);

  prefs.begin("habit", false);
  loadQueue();

  WiFi.mode(WIFI_STA);
  wifiMulti.addAP(WIFI_SSID,  WIFI_PASSWORD);
  wifiMulti.addAP(WIFI_SSID2, WIFI_PASSWORD2);

  showStatus("Habit\nTracker", TFT_CYAN);
  delay(600);

  if (connectWiFi()) {
    showStatus("Sync...", TFT_CYAN);
    flushQueue();
    if (fetchSummary()) beep(5000, 80);
    else { showStatus("API ERRO", TFT_RED); delay(1200); }
  } else {
    showStatus("Offline", TFT_ORANGE);
    delay(1000);
  }
  registerActivity();
  render();
}

void loop() {
  M5.update();

  if (wakeSwallow) {
    if (!M5.BtnA.isPressed() && !M5.BtnB.isPressed()) wakeSwallow = false;
  } else {
    if (M5.BtnA.wasHold())          { registerActivity(); actionForceRefresh(); }
    else if (M5.BtnA.wasClicked())  { registerActivity(); actionNext(); }
    if (M5.BtnB.wasHold())          { registerActivity(); actionButtonB(-1); }
    else if (M5.BtnB.wasClicked())  { registerActivity(); actionButtonB(+1); }
  }

  if (SCREEN_TIMEOUT_MS && !wakeSwallow &&
      millis() - lastActivityMs > SCREEN_TIMEOUT_MS) {
    enterLightSleep();
    return;
  }

  // Conectividade + sincronizacao
  if (WiFi.status() == WL_CONNECTED) {
    if (!online) {                     // acabou de (re)conectar
      online = true;
      WiFi.setSleep(true);
      flushQueue();
      fetchSummary();
      render();
    }
  } else {
    if (online) { online = false; drawTopBar(); }
    if (millis() - lastReconnectMs > RECONNECT_INTERVAL_MS) {
      lastReconnectMs = millis();
      wifiMulti.run();                 // tenta reconectar (bloqueia ~2s)
    }
  }

  // Re-sync automatico enquanto acordado e online
  if (AUTO_SYNC_INTERVAL_MS && online &&
      millis() - lastSyncMs > AUTO_SYNC_INTERVAL_MS) {
    if (fetchSummary()) render();
  }

  delay(10);
}
