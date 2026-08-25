// ============================================================
//  Habit Display - ESP32-2432S032C (CYD 3.2" capacitivo)
//  Display ST7789 240x320 (paisagem 320x240) + GT911 (I2C).
//
//  Painel SOMENTE LEITURA dos habitos, com 4 visoes:
//    HOJE -> SEMANA -> MES -> ANO
//  - Toque em qualquer lugar da tela: alterna a visao
//    (as coordenadas do GT911 sao ignoradas de proposito -
//    a calibracao quebrada desta placa deixa de importar).
//  - Toque longo (segurar LONG_PRESS_MS): forca sincronizacao.
//
//  Dados:
//    GET /api/device/summary  -> hoje (a cada AUTO_SYNC_INTERVAL_MS)
//    GET /api/device/history  -> semana/mes/ano (boot, virada de dia
//                                e a cada HISTORY_SYNC_INTERVAL_MS)
//  As duas respostas ficam cacheadas na NVS: sem WiFi o painel liga
//  mostrando o ultimo estado conhecido.
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
#include <time.h>
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
// O driver Touch_GT911 da LovyanGFX falha nesta placa (issues #305/#306).
// Como agora so importa SE houve toque (nao onde), basta ler o status.
static const uint8_t GT911_ADDR = 0x5D;
static const int PIN_TOUCH_SDA = 33, PIN_TOUCH_SCL = 32;
static const int PIN_TOUCH_RST = 25, PIN_TOUCH_INT = 21;

static void gt911Reset() {
  pinMode(PIN_TOUCH_RST, OUTPUT); pinMode(PIN_TOUCH_INT, OUTPUT);
  digitalWrite(PIN_TOUCH_RST, LOW); digitalWrite(PIN_TOUCH_INT, LOW); delay(11);
  digitalWrite(PIN_TOUCH_RST, HIGH); delay(11);
  pinMode(PIN_TOUCH_INT, INPUT); delay(50);
}

static bool gt911Touched() {
  Wire.beginTransmission(GT911_ADDR);
  Wire.write(0x81); Wire.write(0x4E);          // registrador de status
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)GT911_ADDR, 1, true) != 1) return false;
  uint8_t status = Wire.read();
  if (!(status & 0x80)) return false;
  uint8_t points = status & 0x0F;
  // limpa o status para o chip liberar a proxima leitura
  Wire.beginTransmission(GT911_ADDR);
  Wire.write(0x81); Wire.write(0x4E); Wire.write((uint8_t)0x00);
  Wire.endTransmission();
  return points > 0;
}

// O GT911 so marca "buffer pronto" a cada ciclo de scan (~10ms); com o dedo
// parado ha polls em que nada novo chegou. Considera "soltou" apos varias
// leituras vazias seguidas para nao picotar o toque longo.
static bool touchDown() {
  static uint8_t offCount = 0;
  static bool down = false;
  if (gt911Touched()) { offCount = 0; down = true; }
  else if (down && ++offCount >= 5) { down = false; offCount = 0; }
  return down;
}

// ---------- Cores (RGB565) ----------
static const uint16_t C_WHITE=0xFFFF, C_BLACK=0x0000, C_GREY=0x8410,
                      C_DGREY=0x39E7, C_TILE=0x10A2, C_GREEN=0x07E0,
                      C_ORANGE=0xFD20, C_RED=0xF800, C_ACCENT=0x7cdf;
// escala de "calor" (0..7 habitos feitos no dia), estilo GitHub
static const uint16_t HEAT[5] = { 0x2104, 0x0200, 0x03C0, 0x05C0, 0x07E0 };
static uint16_t heatColor(int score) {
  if (score <= 0) return HEAT[0];
  if (score <= 2) return HEAT[1];
  if (score <= 4) return HEAT[2];
  if (score <= 6) return HEAT[3];
  return HEAT[4];
}

// ---------- Modelo ----------
enum MetricType { NUM = 0, BOOL = 1, READONLY = 2 };
struct Habit { const char* key; const char* label; uint16_t color; MetricType type; };
Habit habits[] = {
  { "agua",      "Agua",      0x05DF, NUM },
  { "academia",  "Academia",  0xFB90, BOOL },
  { "creatina",  "Creatina",  0xB59F, BOOL },
  { "estudo",    "Estudo",    0x9CDF, NUM },
  { "meditacao", "Meditacao", 0x2EB7, NUM },
  { "passos",    "Passos",    0x07E7, READONLY },
  { "leitura",   "Leitura",   0xFD20, NUM },
};
const int HABIT_COUNT = sizeof(habits) / sizeof(habits[0]);

struct SummaryData {
  char date[11];                 // AAAA-MM-DD
  int  atual[7], meta[7];
  bool valid;
};
struct HistoryData {
  char    today[11];
  char    weekLabels[7][2];      // letra do dia, coluna 0 = 6 dias atras
  uint8_t weekPct[7][7];         // [habito][dia] 0-100
  char    monthLabel[12];
  uint8_t monthDays, monthFirstDow;
  int8_t  monthScore[31];        // -1 = dia futuro
  uint8_t yearStartDow;
  int16_t yearLen;
  uint8_t yearScore[365];        // habitos feitos por dia (0-7)
  bool    valid;
};
SummaryData summ = {};
HistoryData hist = {};

int  view = 0;                   // 0 hoje, 1 semana, 2 mes, 3 ano
bool online = false;
uint32_t lastSummaryMs = 0, lastHistoryMs = 0, lastHistoryTryMs = 0;
uint32_t lastReconnectMs = 0, lastClockMs = 0;
uint32_t lastSyncEpoch = 0;      // epoch da ultima sync ok (persistido)
WiFiMulti   wifiMulti;
Preferences prefs;

// ---------- Estado de hoje (vem do summary) ----------
static int pctToday(int i) {
  if (!summ.valid) return 0;
  int meta = max(1, summ.meta[i]);
  return (int)min(100L, 100L * summ.atual[i] / meta);
}
static bool doneToday(int i) { return pctToday(i) >= 100; }
static int todayScore() {
  int n = 0;
  for (int i = 0; i < HABIT_COUNT; i++) if (doneToday(i)) n++;
  return n;
}
static bool timeValid() { return time(nullptr) > 1700000000; }

// ---------- Parse / cache (NVS) ----------
static bool parseSummary(const char* json) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  if (!doc["metrics"].is<JsonObject>()) return false;
  strlcpy(summ.date, doc["date"] | "", sizeof(summ.date));
  for (int i = 0; i < HABIT_COUNT; i++) {
    JsonObject m = doc["metrics"][habits[i].key];
    summ.atual[i] = m["atual"] | 0;
    summ.meta[i]  = max(1, (int)(m["meta"] | 1));
  }
  summ.valid = true;
  return true;
}

static bool parseHistory(const char* json) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  if (!doc["year"]["score"].is<JsonArray>()) return false;
  strlcpy(hist.today, doc["today"] | "", sizeof(hist.today));
  JsonArray labels = doc["week"]["labels"];
  for (int d = 0; d < 7; d++)
    strlcpy(hist.weekLabels[d], labels[d] | "?", sizeof(hist.weekLabels[d]));
  for (int i = 0; i < HABIT_COUNT; i++) {
    JsonArray arr = doc["week"]["pct"][habits[i].key];
    for (int d = 0; d < 7; d++) hist.weekPct[i][d] = arr[d] | 0;
  }
  strlcpy(hist.monthLabel, doc["month"]["label"] | "MES", sizeof(hist.monthLabel));
  hist.monthDays     = doc["month"]["days"]     | 30;
  hist.monthFirstDow = doc["month"]["firstDow"] | 0;
  JsonArray ms = doc["month"]["score"];
  for (int i = 0; i < 31; i++)
    hist.monthScore[i] = (i < hist.monthDays) ? (int8_t)(ms[i] | -1) : -1;
  hist.yearStartDow = doc["year"]["startDow"] | 0;
  JsonArray ys = doc["year"]["score"];
  hist.yearLen = min((int)ys.size(), 365);
  for (int i = 0; i < hist.yearLen; i++) hist.yearScore[i] = ys[i] | 0;
  hist.valid = true;
  return true;
}

static void loadCachedJson(const char* key, bool (*parse)(const char*), size_t cap) {
  size_t n = prefs.getBytesLength(key);
  if (n < 2 || n > cap) return;
  char* buf = (char*)malloc(n + 1);
  if (!buf) return;
  prefs.getBytes(key, buf, n);
  buf[n] = 0;
  parse(buf);
  free(buf);
}

// ---------- HTTP ----------
static int httpRequest(const String& url, String& out) {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS); http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, url)) return -1;
  int code = http.GET();
  out = (code > 0) ? http.getString() : "";
  http.end();
  return code;
}

static void markSynced() {
  if (timeValid()) {
    lastSyncEpoch = (uint32_t)time(nullptr);
    prefs.putULong("syncEpoch", lastSyncEpoch);
  }
}

// retorna true se sincronizou; changed indica se os dados mudaram
static bool fetchSummary(bool& changed) {
  changed = false;
  String resp;
  int code = httpRequest(String(API_BASE) + "/api/device/summary?token=" DEVICE_TOKEN, resp);
  if (code != 200) { Serial.printf("[api] summary %d\n", code); return false; }
  SummaryData old = summ;
  if (!parseSummary(resp.c_str())) return false;
  lastSummaryMs = millis();
  markSynced();
  changed = memcmp(&old, &summ, sizeof(summ)) != 0;
  if (changed) prefs.putBytes("summ", resp.c_str(), resp.length());
  return true;
}

static bool fetchHistory() {
  String resp;
  int code = httpRequest(String(API_BASE) + "/api/device/history?token=" DEVICE_TOKEN, resp);
  if (code != 200) { Serial.printf("[api] history %d\n", code); return false; }
  if (!parseHistory(resp.c_str())) return false;
  lastHistoryMs = millis();
  markSynced();
  prefs.putBytes("hist", resp.c_str(), resp.length());
  Serial.println("[api] history OK");
  return true;
}

// ---------- Desenho ----------
static const int W = 320, H = 240, HEADER_H = 26;

static void drawCenter(const char* s, int x, int y, uint16_t fg, float size) {
  lcd.setTextSize(size);
  lcd.setTextColor(fg);
  lcd.setTextDatum(lgfx::textdatum_t::middle_center);
  lcd.drawString(s, x, y);
}

static String syncAgeStr() {
  if (!lastSyncEpoch || !timeValid()) return "";
  long mins = ((long)time(nullptr) - (long)lastSyncEpoch) / 60;
  if (mins < 1)  return "agora";
  if (mins < 60) return String(mins) + "min";
  if (mins < 1440) return String(mins / 60) + "h";
  return String(mins / 1440) + "d";
}

static void drawHeader() {
  lcd.fillRect(0, 0, W, HEADER_H, C_BLACK);
  const char* title = (view == 0) ? "HOJE"
                    : (view == 1) ? "SEMANA"
                    : (view == 2) ? (hist.valid ? hist.monthLabel : "MES")
                                  : "ANO";
  lcd.setTextDatum(lgfx::textdatum_t::middle_left);
  lcd.setTextSize(2); lcd.setTextColor(C_ACCENT);
  lcd.drawString(title, 8, HEADER_H / 2);

  for (int v = 0; v < 4; v++)                           // indicador de pagina
    lcd.fillCircle(W / 2 - 21 + v * 14, HEADER_H / 2, 3, v == view ? C_WHITE : C_DGREY);

  lcd.fillCircle(W - 12, HEADER_H / 2, 4, online ? C_GREEN : C_RED);
  lcd.setTextDatum(lgfx::textdatum_t::middle_right);
  lcd.setTextSize(1);
  if (online && timeValid()) {
    time_t now = time(nullptr); struct tm tmv; localtime_r(&now, &tmv);
    char buf[6]; strftime(buf, sizeof(buf), "%H:%M", &tmv);
    lcd.setTextColor(C_WHITE);
    lcd.drawString(buf, W - 22, HEADER_H / 2);
  } else if (!online) {
    String age = syncAgeStr();
    lcd.setTextColor(C_ORANGE);
    lcd.drawString(age.length() ? ("off " + age) : "off", W - 22, HEADER_H / 2);
  }
}

// ----- HOJE: grade 4x2 de blocos -----
static void drawDayTile(int i, int x, int y, int cw, int ch) {
  Habit& hb = habits[i];
  bool done = summ.valid && doneToday(i);
  uint16_t accent = done ? C_GREEN : hb.color;

  lcd.fillRoundRect(x + 2, y + 2, cw - 4, ch - 4, 8, C_TILE);
  lcd.setTextDatum(lgfx::textdatum_t::top_left);
  lcd.setTextSize(1); lcd.setTextColor(accent);
  lcd.drawString(hb.label, x + 8, y + 9);

  String big, small;
  if (!summ.valid)            { big = "--"; }
  else if (hb.type == BOOL)   { big = done ? "FEITO" : "---"; }
  else                        { big = String(summ.atual[i]); small = String("/ ") + summ.meta[i]; }
  lcd.setTextSize(2); lcd.setTextColor(done ? C_GREEN : C_WHITE);
  lcd.drawString(big, x + 8, y + 30);
  if (small.length()) {
    lcd.setTextSize(1); lcd.setTextColor(C_GREY);
    lcd.drawString(small, x + 8, y + 52);
  }
  if (hb.type == READONLY) {
    lcd.setTextSize(1); lcd.setTextColor(C_DGREY);
    lcd.drawString("relogio", x + 8, y + 66);
  }

  int bx = x + 8, bw = cw - 16, by = y + ch - 18, bh = 6;
  lcd.drawRect(bx, by, bw, bh, C_DGREY);
  int fill = (bw - 2) * pctToday(i) / 100;
  if (fill > 0) lcd.fillRect(bx + 1, by + 1, fill, bh - 2, accent);
}

static void drawInfoTile(int x, int y, int cw, int ch) {
  lcd.fillRoundRect(x + 2, y + 2, cw - 4, ch - 4, 8, C_BLACK);
  lcd.drawRoundRect(x + 2, y + 2, cw - 4, ch - 4, 8, C_TILE);
  lcd.setTextDatum(lgfx::textdatum_t::top_left);
  lcd.setTextSize(1); lcd.setTextColor(C_GREY);
  lcd.drawString("hoje", x + 8, y + 9);

  char dm[6] = "--/--";
  if (summ.valid && strlen(summ.date) == 10) {
    dm[0] = summ.date[8]; dm[1] = summ.date[9]; dm[2] = '/';
    dm[3] = summ.date[5]; dm[4] = summ.date[6]; dm[5] = 0;
  }
  lcd.setTextSize(2); lcd.setTextColor(C_WHITE);
  lcd.drawString(dm, x + 8, y + 30);

  lcd.setTextSize(1);
  lcd.setTextColor(online ? C_GREEN : C_ORANGE);
  lcd.drawString(online ? "wifi ok" : "offline", x + 8, y + 56);
  String age = syncAgeStr();
  if (age.length()) {
    lcd.setTextColor(C_GREY);
    lcd.drawString("sync " + age, x + 8, y + 70);
  }
}

static void drawDayView() {
  int y0 = HEADER_H, cw = W / 4, ch = (H - y0) / 2;
  for (int i = 0; i < HABIT_COUNT; i++)
    drawDayTile(i, (i % 4) * cw, y0 + (i / 4) * ch, cw, ch);
  drawInfoTile(3 * cw, y0 + ch, cw, ch);
}

// ----- SEMANA: 7 habitos x 7 dias -----
static void drawWeekView() {
  int y0 = HEADER_H, LW = 92;
  int colw = (W - LW - 4) / 7;
  int yR = y0 + 16, rowh = (H - y0 - 16) / 7;

  lcd.setTextDatum(lgfx::textdatum_t::middle_center);
  lcd.setTextSize(1);
  for (int d = 0; d < 7; d++) {
    lcd.setTextColor(d == 6 ? C_WHITE : C_GREY);
    lcd.drawString(hist.valid ? hist.weekLabels[d] : "?", LW + d * colw + colw / 2, y0 + 8);
  }
  for (int i = 0; i < HABIT_COUNT; i++) {
    Habit& hb = habits[i];
    int ry = yR + i * rowh;
    lcd.setTextDatum(lgfx::textdatum_t::middle_left);
    lcd.setTextSize(1); lcd.setTextColor(hb.color);
    lcd.drawString(hb.label, 6, ry + rowh / 2);
    for (int d = 0; d < 7; d++) {
      int pct = (d == 6) ? pctToday(i) : (hist.valid ? hist.weekPct[i][d] : 0);
      int cx = LW + d * colw + 2, cy = ry + 2, cw2 = colw - 4, ch2 = rowh - 4;
      lcd.fillRect(cx, cy, cw2, ch2, C_BLACK);
      lcd.drawRect(cx, cy, cw2, ch2, d == 6 ? C_GREY : C_DGREY);
      int fh = (ch2 - 2) * min(pct, 100) / 100;
      if (fh > 0)
        lcd.fillRect(cx + 1, cy + 1 + (ch2 - 2 - fh), cw2 - 2, fh,
                     pct >= 100 ? C_GREEN : hb.color);
    }
  }
}

// ----- MES: calendario com intensidade por dia -----
static void drawMonthView() {
  int y0 = HEADER_H;
  int cellw = 44, x0 = (W - 7 * cellw) / 2;
  int yR = y0 + 14, cellh = (H - yR - 2) / 6;
  static const char* DL[7] = { "D", "S", "T", "Q", "Q", "S", "S" };

  lcd.setTextDatum(lgfx::textdatum_t::middle_center);
  lcd.setTextSize(1); lcd.setTextColor(C_GREY);
  for (int c = 0; c < 7; c++)
    lcd.drawString(DL[c], x0 + c * cellw + cellw / 2, y0 + 7);

  if (!hist.valid) { drawCenter("sem historico (segure p/ sync)", W / 2, H / 2, C_GREY, 1); return; }

  int todayDom = (summ.valid && strlen(summ.date) == 10)
               ? (summ.date[8] - '0') * 10 + (summ.date[9] - '0') : 0;
  lcd.setTextDatum(lgfx::textdatum_t::top_left);
  for (int day = 1; day <= hist.monthDays; day++) {
    int pos = hist.monthFirstDow + day - 1, col = pos % 7, row = pos / 7;
    int x = x0 + col * cellw, y = yR + row * cellh;
    int score = (day == todayDom && summ.valid) ? todayScore() : hist.monthScore[day - 1];
    uint16_t numColor;
    if (score < 0) {                                   // dia futuro
      lcd.fillRoundRect(x + 2, y + 2, cellw - 4, cellh - 4, 4, C_BLACK);
      lcd.drawRoundRect(x + 2, y + 2, cellw - 4, cellh - 4, 4, C_TILE);
      numColor = C_DGREY;
    } else {
      lcd.fillRoundRect(x + 2, y + 2, cellw - 4, cellh - 4, 4, heatColor(score));
      numColor = (score >= 5) ? C_BLACK : C_WHITE;
    }
    if (day == todayDom)
      lcd.drawRoundRect(x + 1, y + 1, cellw - 2, cellh - 2, 5, C_WHITE);
    lcd.setTextSize(1); lcd.setTextColor(numColor);
    lcd.drawString(String(day), x + 6, y + 5);
  }
}

// ----- ANO: heatmap 53x7 + estatisticas -----
static void drawStat(const char* value, const char* label, int cx, int y) {
  drawCenter(value, cx, y, C_WHITE, 3);
  drawCenter(label, cx, y + 26, C_GREY, 1);
}

static void drawYearView() {
  if (!hist.valid) { drawCenter("sem historico (segure p/ sync)", W / 2, H / 2, C_GREY, 1); return; }
  int y0 = HEADER_H + 6;
  int n = hist.yearLen, startDow = hist.yearStartDow;
  int cols = (startDow + n + 6) / 7;
  int x0 = (W - (cols * 6 - 1)) / 2;

  long sum = 0, perfect = 0, last30 = 0;
  for (int i = 0; i < n; i++) {
    int score = (i == n - 1 && summ.valid) ? todayScore() : hist.yearScore[i];
    int pos = startDow + i;
    lcd.fillRect(x0 + (pos / 7) * 6, y0 + (pos % 7) * 6, 5, 5, heatColor(score));
    sum += score;
    if (score >= 7) perfect++;
    if (i >= n - 30) last30 += score;
  }
  int avg = n ? (int)(sum * 100 / (7L * n)) : 0;
  int l30 = (int)(last30 * 100 / (7L * min(n, 30)));

  int ys = y0 + 42 + 30;
  lcd.fillRect(0, ys - 14, W, H - (ys - 14), C_BLACK);   // limpa area dos numeros
  drawStat((String(avg) + "%").c_str(),  "media ano",   W / 6,     ys + 12);
  drawStat(String((int)perfect).c_str(), "dias 100%",   W / 2,     ys + 12);
  drawStat((String(l30) + "%").c_str(),  "ultimos 30d", 5 * W / 6, ys + 12);

  // legenda
  int lx = W / 2 - 44, ly = H - 18;
  lcd.setTextDatum(lgfx::textdatum_t::middle_right);
  lcd.setTextSize(1); lcd.setTextColor(C_GREY);
  lcd.drawString("menos", lx - 6, ly + 4);
  for (int l = 0; l < 5; l++) lcd.fillRect(lx + l * 12, ly, 8, 8, HEAT[l]);
  lcd.setTextDatum(lgfx::textdatum_t::middle_left);
  lcd.drawString("mais", lx + 5 * 12 + 2, ly + 4);
}

static void renderAll(bool clear = true) {
  if (clear) lcd.fillScreen(C_BLACK);
  drawHeader();
  switch (view) {
    case 0: drawDayView();   break;
    case 1: drawWeekView();  break;
    case 2: drawMonthView(); break;
    case 3: drawYearView();  break;
  }
}

static void toast(const char* msg, uint16_t color) {
  int w = 180, h = 46, x = (W - w) / 2, y = (H - h) / 2;
  lcd.fillRoundRect(x, y, w, h, 10, C_BLACK);
  lcd.drawRoundRect(x, y, w, h, 10, color);
  drawCenter(msg, W / 2, y + h / 2, color, 2);
}

// ---------- Sync ----------
static void forceSync() {
  toast("sync...", C_ACCENT);
  if (online) {
    bool changed;
    fetchSummary(changed);
    fetchHistory();
    renderAll();
  } else {
    toast("offline", C_ORANGE);
    delay(700);
    renderAll();
  }
}

// ---------- WiFi ----------
static bool connectWiFi() {
  uint32_t t0 = millis();
  while (wifiMulti.run() != WL_CONNECTED && millis() - t0 < 20000) delay(300);
  online = (WiFi.status() == WL_CONNECTED);
  if (online) {
    WiFi.setSleep(true);
    Serial.printf("[wifi] conectado rssi=%d ip=%s\n", WiFi.RSSI(), WiFi.localIP().toString().c_str());
  } else Serial.println("[wifi] falhou");
  return online;
}

// ---------- Setup / Loop ----------
void setup() {
  Serial.begin(115200);
  prefs.begin("habit", false);
  prefs.remove("pd"); prefs.remove("pb");     // fila do firmware antigo
  lastSyncEpoch = prefs.getULong("syncEpoch", 0);
  loadCachedJson("summ", parseSummary, 2048);
  loadCachedJson("hist", parseHistory, 8192);

  gt911Reset();
  Wire.begin(PIN_TOUCH_SDA, PIN_TOUCH_SCL, 400000);

  lcd.init();
  lcd.setRotation(1);                          // paisagem 320x240
  lcd.setBrightness(BRIGHTNESS);
  renderAll();                                 // mostra o cache na hora

  WiFi.mode(WIFI_STA);
  wifiMulti.addAP(WIFI_SSID,  WIFI_PASSWORD);
  wifiMulti.addAP(WIFI_SSID2, WIFI_PASSWORD2);
  if (connectWiFi()) {
    configTime(-3 * 3600, 0, "pool.ntp.org", "time.google.com");   // Sao Paulo
    bool changed;
    fetchSummary(changed);
    fetchHistory();
  }
  renderAll();
}

void loop() {
  // toque: solto = proxima visao; segurado = forca sync
  static bool wasDown = false, longFired = false;
  static uint32_t downT0 = 0;
  bool down = touchDown();
  if (down && !wasDown) { downT0 = millis(); longFired = false; }
  if (down && !longFired && millis() - downT0 >= LONG_PRESS_MS) { longFired = true; forceSync(); }
  if (!down && wasDown && !longFired) { view = (view + 1) % 4; renderAll(); }
  wasDown = down;

  // conectividade
  if (WiFi.status() == WL_CONNECTED) {
    if (!online) {
      online = true; WiFi.setSleep(true);
      if (!timeValid()) configTime(-3 * 3600, 0, "pool.ntp.org", "time.google.com");
      drawHeader();
    }
  } else {
    if (online) { online = false; drawHeader(); }
    if (millis() - lastReconnectMs > RECONNECT_INTERVAL_MS) { lastReconnectMs = millis(); wifiMulti.run(); }
  }

  // hoje: re-sync periodico
  if (online && (lastSummaryMs == 0 || millis() - lastSummaryMs > AUTO_SYNC_INTERVAL_MS)) {
    bool changed;
    if (fetchSummary(changed) && changed) renderAll(false);
    else if (lastSummaryMs == 0) lastSummaryMs = millis();  // evita marretar em falha
  }

  // historico: boot sem cache, virada de dia ou intervalo longo
  bool needHist = !hist.valid
               || (summ.valid && strcmp(summ.date, hist.today) != 0)
               || millis() - lastHistoryMs > HISTORY_SYNC_INTERVAL_MS;
  if (online && needHist && millis() - lastHistoryTryMs > 60000UL) {
    lastHistoryTryMs = millis();
    if (fetchHistory()) renderAll(false);
  }

  // relogio / idade do sync no cabecalho
  if (millis() - lastClockMs > 30000UL) { lastClockMs = millis(); drawHeader(); }

  delay(10);
}
