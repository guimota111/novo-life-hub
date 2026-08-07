// ============================================================
//  Habit Tracker - ESP32-2432S032C (CYD 3.2" capacitivo)
//  Display ST7789 240x320 + Toque GT911 (I2C, leitura direta via Wire -
//  o driver Touch_GT911 da LovyanGFX nao funciona nesta placa, ver README).
//  Fala com as mesmas APIs do app (mesmo token do aparelho de bolso):
//    GET  /api/device/summary   POST /api/device/action
//
//  Toque:
//    - Nos habitos numericos: botoes [-] e [+] na direita.
//    - Nos habitos feito/nao (academia, creatina): botao que alterna.
//    - Passos: so leitura (vem do relogio).
//    - Botao SYNC no topo: forca a sincronizacao.
// ============================================================
#define LGFX_USE_V1
#include <LovyanGFX.hpp>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "config.h"

// ---------- Display (ESP32-2432S032C) ----------
class LGFX : public lgfx::LGFX_Device {
  lgfx::Panel_ST7789  _panel;
  lgfx::Bus_SPI       _bus;
  lgfx::Light_PWM     _light;
public:
  LGFX() {
    { auto c = _bus.config();
      c.spi_host   = SPI2_HOST;      // pinos 13/14/15 = HSPI
      c.spi_mode   = 0;
      c.freq_write = 40000000;
      c.freq_read  = 16000000;
      c.spi_3wire  = false;
      c.use_lock   = true;
      c.dma_channel = SPI_DMA_CH_AUTO;
      c.pin_sclk = 14; c.pin_mosi = 13; c.pin_miso = 12; c.pin_dc = 2;
      _bus.config(c); _panel.setBus(&_bus);
    }
    { auto c = _panel.config();
      c.pin_cs = 15; c.pin_rst = -1; c.pin_busy = -1;
      c.memory_width = 240; c.memory_height = 320;
      c.panel_width  = 240; c.panel_height  = 320;
      c.offset_x = 0; c.offset_y = 0; c.offset_rotation = 0;
      c.readable = true; c.invert = true;      // INVERSION_ON
      c.rgb_order = false;                       // BGR
      c.dlen_16bit = false; c.bus_shared = true;
      _panel.config(c);
    }
    { auto c = _light.config();
      c.pin_bl = 27; c.invert = false; c.freq = 44100; c.pwm_channel = 7;
      _light.config(c); _panel.setLight(&_light);
    }
    setPanel(&_panel);
  }
};
LGFX lcd;

// ---------- Touch GT911 (I2C direto via Wire) ----------
// O driver Touch_GT911 embutido na LovyanGFX falha nesta placa (a mesma
// escrita/leitura de registrador funciona via Wire puro, mas nao pelo
// driver da lib - bug conhecido e sem fix nas issues #305/#306 do
// LovyanGFX). Por isso a leitura e feita aqui manualmente.
static const uint8_t GT911_ADDR = 0x5D;
static const int PIN_TOUCH_SDA = 33, PIN_TOUCH_SCL = 32;
static const int PIN_TOUCH_RST = 25, PIN_TOUCH_INT = 21;

static void gt911Reset() {
  pinMode(PIN_TOUCH_RST, OUTPUT); pinMode(PIN_TOUCH_INT, OUTPUT);
  digitalWrite(PIN_TOUCH_RST, LOW); digitalWrite(PIN_TOUCH_INT, LOW); delay(11);
  digitalWrite(PIN_TOUCH_RST, HIGH); delay(11);
  pinMode(PIN_TOUCH_INT, INPUT); delay(50);
}

// le a posicao do primeiro ponto tocado; retorna false se nao ha toque
static bool gt911GetTouch(int16_t& x, int16_t& y) {
  Wire.beginTransmission(GT911_ADDR);
  Wire.write(0x81); Wire.write(0x4E);          // registrador de status
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)GT911_ADDR, 1, true) != 1) return false;
  uint8_t status = Wire.read();

  bool touched = false;
  if (status & 0x80) {
    uint8_t points = status & 0x0F;
    if (points > 0) {
      Wire.beginTransmission(GT911_ADDR);
      Wire.write(0x81); Wire.write(0x50);      // ponto 1: id,xL,xH,yL,yH,szL,szH
      if (Wire.endTransmission(false) == 0 && Wire.requestFrom((int)GT911_ADDR, 7, true) == 7) {
        Wire.read();                            // track id
        uint8_t xl = Wire.read(), xh = Wire.read();
        uint8_t yl = Wire.read(), yh = Wire.read();
        Wire.read(); Wire.read();               // size, ignorado
        x = (int16_t)(xh | (xl << 8));
        y = (int16_t)(yh | (yl << 8));
        touched = true;
        Serial.printf("[gt911] status=0x%02X pts=%u xy_bytes=%02X %02X %02X %02X -> x=%d y=%d\n",
          status, points, xl, xh, yl, yh, x, y);
      }
    }
    // limpa o status para o chip liberar a proxima leitura
    Wire.beginTransmission(GT911_ADDR);
    Wire.write(0x81); Wire.write(0x4E); Wire.write((uint8_t)0x00);
    Wire.endTransmission();
  }
  return touched;
}

// A config de fabrica deste modulo vem com a resolucao errada (maxX=320,
// maxY=0), o que faz o chip comprimir o eixo Y quase todo perto de 0 (por
// isso quase todo toque batia no cabecalho/SYNC). Corrige o bloco de config
// (0x8047..0x8100) e recalcula o checksum, igual ao _freshConfig() da
// LovyanGFX (que so mexe no numero de pontos, nao na resolucao).
static void gt911FixResolution() {
  uint8_t cfg[184];
  Wire.beginTransmission(GT911_ADDR);
  Wire.write(0x80); Wire.write(0x47);
  if (Wire.endTransmission(false) != 0) return;
  if (Wire.requestFrom((int)GT911_ADDR, 184, true) != 184) return;
  for (int i = 0; i < 184; i++) cfg[i] = Wire.read();

  cfg[1] = 240 & 0xFF; cfg[2] = (240 >> 8) & 0xFF;   // maxX = 240 (largura)
  cfg[3] = 320 & 0xFF; cfg[4] = (320 >> 8) & 0xFF;   // maxY = 320 (altura)

  uint8_t ccsum = 0;
  for (int i = 0; i < 184; i++) ccsum += cfg[i];
  uint8_t checksum = (uint8_t)((~ccsum) + 1);   // 0x80FF checksum

  // Escreve em pedacos pequenos (o buffer TX do Wire no ESP32 e' de so 128
  // bytes - um unico write de 186+ bytes trunca silenciosamente o final,
  // que e' justamente onde ficam o checksum e o flag de "aplicar config").
  const int CHUNK = 16;
  for (int off = 0; off < 184; off += CHUNK) {
    int len = min(CHUNK, 184 - off);
    uint16_t reg = 0x8047 + off;
    Wire.beginTransmission(GT911_ADDR);
    Wire.write((uint8_t)(reg >> 8)); Wire.write((uint8_t)(reg & 0xFF));
    Wire.write(&cfg[off], len);
    uint8_t err = Wire.endTransmission();
    Serial.printf("[gt911fix] chunk off=%d len=%d err=%u\n", off, len, err);
    if (err != 0) return;
  }

  Serial.printf("[gt911fix] checksum=0x%02X\n", checksum);
  Wire.beginTransmission(GT911_ADDR);
  Wire.write(0x80); Wire.write(0xFF);
  Wire.write(checksum);
  Wire.write((uint8_t)0x01);              // 0x8100 config fresh
  uint8_t err2 = Wire.endTransmission();
  Serial.printf("[gt911fix] fresh-flag err=%u\n", err2);
  delay(10);
}

// ---------- Cores (RGB565) ----------
static const uint16_t C_WHITE=0xFFFF, C_BLACK=0x0000, C_GREY=0x8410,
                      C_DGREY=0x39E7, C_TILE=0x10A2, C_GREEN=0x07E0, C_ORANGE=0xFD20;

// ---------- Modelo ----------
enum MetricType { NUM = 0, BOOL = 1, READONLY = 2 };
struct Habit {
  const char* key; const char* label; uint16_t color; MetricType type; int inc; int atual; int meta;
};
Habit habits[] = {
  { "agua",      "Agua",      0x05DF, NUM,      INC_AGUA,      0, 1 },
  { "academia",  "Academia",  0xFB90, BOOL,     0,             0, 1 },
  { "creatina",  "Creatina",  0xB59F, BOOL,     0,             0, 1 },
  { "estudo",    "Estudo",    0x9CDF, NUM,      INC_ESTUDO,    0, 1 },
  { "meditacao", "Meditacao", 0x2EB7, NUM,      INC_MEDITACAO, 0, 1 },
  { "passos",    "Passos",    0x07E7, READONLY, 0,             0, 1 },
  { "leitura",   "Leitura",   0xFD20, NUM,      INC_LEITURA,   0, 1 },
};
const int HABIT_COUNT = sizeof(habits) / sizeof(habits[0]);

uint32_t lastSyncMs = 0, lastReconnectMs = 0;
bool online = false;
WiFiMulti   wifiMulti;
Preferences prefs;
int    pendingDelta[16];
int8_t pendingBool[16];

// ---------- Fila offline (NVS) ----------
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

// ---------- HTTP ----------
static int httpRequest(const char* method, const String& url, const String& body, String& out) {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS); http.setTimeout(HTTP_TIMEOUT_MS);
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
  for (int i = 0; i < HABIT_COUNT; i++) if (!strcmp(habits[i].key, key)) return &habits[i];
  return nullptr;
}
static bool fetchSummary() {
  String resp;
  int code = httpRequest("GET", String(API_BASE) + "/api/device/summary?token=" DEVICE_TOKEN, "", resp);
  if (code != 200) { Serial.printf("[api] summary %d\n", code); return false; }
  JsonDocument doc;
  if (deserializeJson(doc, resp)) return false;
  for (JsonPair kv : doc["metrics"].as<JsonObject>()) {
    Habit* h = findHabit(kv.key().c_str()); if (!h) continue;
    int idx = h - habits;
    if (pendingBool[idx] >= 0 || pendingDelta[idx] != 0) { h->meta = kv.value()["meta"] | h->meta; continue; }
    h->atual = kv.value()["atual"] | h->atual;
    h->meta  = kv.value()["meta"]  | h->meta;
    if (h->meta < 1) h->meta = 1;
  }
  lastSyncMs = millis();
  Serial.println("[api] summary OK");
  return true;
}
static bool apiSend(int idx, int val) {
  Habit& h = habits[idx];
  String body = (h.type == BOOL)
    ? String("{\"metric\":\"") + h.key + "\",\"value\":" + val + "}"
    : String("{\"metric\":\"") + h.key + "\",\"amount\":" + val + "}";
  String resp;
  int code = httpRequest("POST", String(API_BASE) + "/api/device/action?token=" DEVICE_TOKEN, body, resp);
  if (code != 200) { Serial.printf("[api] action %d\n", code); return false; }
  JsonDocument doc;
  if (deserializeJson(doc, resp)) return false;
  h.atual = doc["atual"] | h.atual;
  h.meta  = doc["meta"]  | h.meta;
  if (h.meta < 1) h.meta = 1;
  return true;
}
static bool flushQueue() {
  bool all = true;
  for (int i = 0; i < HABIT_COUNT; i++) {
    if (habits[i].type == BOOL) {
      if (pendingBool[i] >= 0) { if (apiSend(i, pendingBool[i])) pendingBool[i] = -1; else all = false; }
    } else {
      if (pendingDelta[i] != 0) { if (apiSend(i, pendingDelta[i])) pendingDelta[i] = 0; else all = false; }
    }
  }
  saveQueue();
  return all;
}

// ---------- Estado ----------
static bool habitDone(const Habit& h) { return (h.type == BOOL) ? (h.atual >= 1) : (h.atual >= h.meta); }
static float habitPct(const Habit& h) { if (h.type == BOOL) return habitDone(h) ? 1 : 0; return (float)h.atual / h.meta; }
static void applyLocal(int idx, int val) {
  Habit& h = habits[idx];
  if (h.type == BOOL) h.atual = val ? 1 : 0; else h.atual = max(0, h.atual + val);
}

// ---------- Layout ----------
static const int W = 240, H = 320, HEADER_H = 40;
static int rowH() { return (H - HEADER_H) / HABIT_COUNT; }
static int rowY(int i) { return HEADER_H + i * rowH(); }
// zonas de toque dos botoes (x)
static const int BTN_MINUS_X = 150, BTN_MINUS_W = 40;   // 150..190
static const int BTN_PLUS_X  = 194, BTN_PLUS_W  = 42;   // 194..236

static void drawCenter(const char* s, int x, int y, uint16_t fg, uint16_t bg, float size) {
  lcd.setTextSize(size);
  lcd.setTextColor(fg, bg);
  lcd.setTextDatum(lgfx::textdatum_t::middle_center);
  lcd.drawString(s, x, y);
}

static void drawHeader() {
  lcd.fillRect(0, 0, W, HEADER_H, C_BLACK);
  lcd.setTextDatum(lgfx::textdatum_t::top_left);
  lcd.setTextSize(2); lcd.setTextColor(0x7cdf, C_BLACK);
  lcd.drawString("TAMAGOCHI", 8, 12);
  lcd.fillCircle(150, 20, 5, online ? C_GREEN : 0xF800);      // wifi
  if (hasPending()) { lcd.setTextColor(C_ORANGE, C_BLACK); lcd.setTextSize(2); lcd.drawString("*", 162, 12); }
  lcd.drawRoundRect(178, 7, 56, 26, 6, 0x7cdf);              // botao SYNC
  drawCenter("SYNC", 206, 20, 0x7cdf, C_BLACK, 1);
}

static void drawRow(int i) {
  Habit& h = habits[i];
  bool done = habitDone(h);
  uint16_t accent = done ? C_GREEN : h.color;
  int y = rowY(i), rh = rowH();

  lcd.fillRoundRect(4, y + 2, W - 8, rh - 4, 6, C_TILE);
  lcd.fillRect(8, y + 8, 4, rh - 16, accent);                 // faixa lateral

  lcd.setTextDatum(lgfx::textdatum_t::top_left);
  lcd.setTextSize(2); lcd.setTextColor(accent, C_TILE);
  lcd.drawString(h.label, 18, y + 6);

  lcd.setTextSize(1); lcd.setTextColor(C_WHITE, C_TILE);
  String val = (h.type == BOOL) ? (done ? "feito" : "ainda nao")
                                 : (String(h.atual) + " / " + String(h.meta));
  lcd.drawString(val, 18, y + 25);

  // barra
  int bx = 18, bw = 120, by = y + rh - 10, bh = 4;
  lcd.drawRect(bx, by, bw, bh, C_DGREY);
  int fill = (int)((bw - 2) * constrain(habitPct(h), 0.0f, 1.0f));
  if (fill > 0) lcd.fillRect(bx + 1, by + 1, fill, bh - 2, accent);

  // botoes
  int by0 = y + 6, bh0 = rh - 12;
  if (h.type == READONLY) {
    lcd.setTextDatum(lgfx::textdatum_t::middle_right);
    lcd.setTextSize(1); lcd.setTextColor(C_GREY, C_TILE);
    lcd.drawString("auto (relogio)", W - 12, y + rh / 2);
  } else if (h.type == BOOL) {
    lcd.drawRoundRect(BTN_MINUS_X, by0, (W - 8) - BTN_MINUS_X - 4, bh0, 6, accent);
    drawCenter(done ? "desmarcar" : "marcar", BTN_MINUS_X + ((W - 8) - BTN_MINUS_X - 4) / 2, y + rh / 2, accent, C_TILE, 1);
  } else {
    lcd.drawRoundRect(BTN_MINUS_X, by0, BTN_MINUS_W, bh0, 6, C_DGREY);
    drawCenter("-", BTN_MINUS_X + BTN_MINUS_W / 2, y + rh / 2, C_WHITE, C_TILE, 3);
    lcd.fillRoundRect(BTN_PLUS_X, by0, BTN_PLUS_W, bh0, 6, accent);
    drawCenter("+", BTN_PLUS_X + BTN_PLUS_W / 2, y + rh / 2, C_BLACK, accent, 3);
  }
}

static void render() {
  lcd.fillScreen(C_BLACK);
  drawHeader();
  for (int i = 0; i < HABIT_COUNT; i++) drawRow(i);
}

static void toast(const char* msg, uint16_t color) {
  int w = 180, h = 46, x = (W - w) / 2, y = (H - h) / 2;
  lcd.fillRoundRect(x, y, w, h, 10, C_BLACK);
  lcd.drawRoundRect(x, y, w, h, 10, color);
  drawCenter(msg, W / 2, y + h / 2, color, C_BLACK, 2);
}

// ---------- Acoes ----------
static void doAction(int idx, int val) {
  applyLocal(idx, val);
  if (habits[idx].type == BOOL) pendingBool[idx] = habits[idx].atual ? 1 : 0;
  else                          pendingDelta[idx] += val;
  saveQueue();
  drawRow(idx);
  if (!(online && flushQueue())) { toast("offline", C_ORANGE); delay(500); }
  drawRow(idx);
  drawHeader();
}

static void forceSync() {
  toast("sync...", 0x7cdf);
  bool ok = online && flushQueue();
  if (online) ok = fetchSummary() || ok;
  render();
  if (!online) { toast("offline", C_ORANGE); delay(600); render(); }
}

static void handleTap(int tx, int ty) {
  Serial.printf("[touch] %d,%d\n", tx, ty);
  if (ty < HEADER_H) { if (tx >= 178) forceSync(); return; }
  int i = (ty - HEADER_H) / rowH();
  if (i < 0 || i >= HABIT_COUNT) return;
  Habit& h = habits[i];
  if (h.type == READONLY) return;
  if (h.type == BOOL) { if (tx >= BTN_MINUS_X) doAction(i, habitDone(h) ? 0 : 1); return; }
  if (tx >= BTN_PLUS_X)              doAction(i, +h.inc);
  else if (tx >= BTN_MINUS_X)        doAction(i, -h.inc);
}

// ---------- WiFi ----------
static bool connectWiFi() {
  uint32_t t0 = millis();
  uint8_t last = 255;
  while (wifiMulti.run() != WL_CONNECTED && millis() - t0 < 25000) {
    uint8_t st = WiFi.status();
    if (st != last) { Serial.printf("[wifi] status=%d\n", st); last = st; }
    delay(300);
  }
  online = (WiFi.status() == WL_CONNECTED);
  if (online) { WiFi.setSleep(true); Serial.printf("[wifi] conectado rssi=%d ip=%s\n", WiFi.RSSI(), WiFi.localIP().toString().c_str()); }
  else Serial.println("[wifi] falhou");
  return online;
}

// ---------- Setup / Loop ----------
void setup() {
  Serial.begin(115200);
  prefs.begin("habit", false);
  loadQueue();

  gt911Reset();
  Wire.begin(PIN_TOUCH_SDA, PIN_TOUCH_SCL, 400000);
  gt911FixResolution();
  {
    uint8_t res[4] = {0};
    Wire.beginTransmission(GT911_ADDR);
    Wire.write(0x80); Wire.write(0x48);
    if (Wire.endTransmission(false) == 0 && Wire.requestFrom((int)GT911_ADDR, 4, true) == 4)
      for (int i = 0; i < 4; i++) res[i] = Wire.read();
    Serial.printf("[gt911] cfg maxX=%u maxY=%u\n",
      (unsigned)(res[0] | (res[1] << 8)), (unsigned)(res[2] | (res[3] << 8)));
  }

  lcd.init();
  lcd.setRotation(0);
  lcd.setBrightness(BRIGHTNESS);
  lcd.fillScreen(C_BLACK);
  drawCenter("Habit Tracker", W / 2, H / 2, 0x7cdf, C_BLACK, 2);

  WiFi.mode(WIFI_STA);
  int n = WiFi.scanNetworks();
  Serial.printf("[wifi] scan: %d redes\n", n);
  for (int i = 0; i < n && i < 14; i++)
    Serial.printf("   %-26s rssi=%d ch=%d\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.channel(i));
  wifiMulti.addAP(WIFI_SSID,  WIFI_PASSWORD);
  wifiMulti.addAP(WIFI_SSID2, WIFI_PASSWORD2);

  if (connectWiFi()) { flushQueue(); fetchSummary(); }
  render();
}

void loop() {
  // toque (deteccao de borda)
  static bool wasDown = false;
  int16_t tx, ty;
  bool down = gt911GetTouch(tx, ty);
  if (down && !wasDown) handleTap(tx, ty);
  wasDown = down;

  // conectividade
  if (WiFi.status() == WL_CONNECTED) {
    if (!online) { online = true; WiFi.setSleep(true); flushQueue(); fetchSummary(); render(); }
  } else {
    if (online) { online = false; drawHeader(); }
    if (millis() - lastReconnectMs > RECONNECT_INTERVAL_MS) { lastReconnectMs = millis(); wifiMulti.run(); }
  }

  // re-sync periodico
  if (AUTO_SYNC_INTERVAL_MS && online && millis() - lastSyncMs > AUTO_SYNC_INTERVAL_MS) {
    if (fetchSummary()) render();
  }

  delay(10);
}
