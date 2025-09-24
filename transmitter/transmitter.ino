/****************************************************
 * TEST_1_v3 – Emisor de Telemetría (Heltec Wireless Tracker)
 * - LoRa P2P (LoRaWan_APP.h)
 * - GNSS HT_TinyGPS++ con criterio de arranque GPS.time.second()!=0
 * - IMU LSM6DS3 (SparkFun) en polling
 * - Velocidad por reed: mediana + EMA + timeout
 * - Paquete binario compacto (18 bytes) + LittleFS
 * - TFT HT_st7735 (blanco sobre negro)
 * - Botón USER (GPIO 0) para iniciar/finalizar la recopilación
 ****************************************************/

 #include <Arduino.h>
 #include "LoRaWan_APP.h"       // Radio SX1262 (Heltec)
 #include "HT_st7735.h"         // TFT (Heltec)
 #include "HT_TinyGPS++.h"      // GNSS (Heltec)
 #include <SparkFunLSM6DS3.h>   // IMU
 #include <Wire.h>              // I2C
 #include <LittleFS.h>          // Flash FS
 #include <math.h>
 
 /*************** CONFIGURACIÓN (ajusta aquí) *****************/
 // Identidad y muestreo
 #define VEHICLE_ID               7          // (0..99) – ID de vehículo
 #define F_ENVIO_HZ               0.5        // (Hz) – Frecuencia de envío/escritura
 #define F_MEDICION_HZ            10         // (Hz) – Frecuencia de muestreo IMU/Vel
 
 // LoRa (P2P, NO LoRaWAN) – parámetros Heltec
 #define RF_FREQUENCY             915000000UL
 #define TX_OUTPUT_POWER          14
 #define LORA_BANDWIDTH           1          // 0=125kHz,1=250k,2=500k
 #define LORA_SPREADING_FACTOR    11         // 7..12
 #define LORA_CODINGRATE          1          // 1=4/5..4=4/8
 #define LORA_PREAMBLE_LENGTH     8
 #define LORA_IQ_INVERSION_ON     false
 #define LORA_TIMEOUT_MS          3000
 #define SYNC_WORD_PUBLIC         0x34       // SetPublicNetwork(true)
 
 // GNSS (Heltec)
 #define GPS_TX_PIN               33         // ESP32 TX -> RX GNSS
 #define GPS_RX_PIN               34         // ESP32 RX <- TX GNSS
 #define VGNSS_CTRL               3
 #define GPS_BAUD                 115200
 #define GNSS_START_TIMEOUT_MS    60000
 #define GNSS_WARMUP_MS           15000
 #define ORIGIN_LAT               (-34.639444)
 #define ORIGIN_LON               (-58.483056)
 
 // IMU / I2C
 #define I2C_SDA                  37
 #define I2C_SCL                  26
 #define LSM6DS3_ADDR             0x6B
 #define IMU_RANGE_ACC            2
 #define IMU_RANGE_GYRO           125
 
 // Velocímetro (reed)
 #define REED_PIN                 46
 #define D_m                      0.60f
 #define N_PULSOS                 1
 #define DEBOUNCE_us              10000
 #define MEDIAN_WINDOW            5
 #define EMA_ALPHA                0.25f
 #define TIMEOUT_NO_PULSE_ms      1200
 
 // LittleFS / Log
 #define LOG_FILENAME             "/log.bin"
 #define DELETE_ALL_ON_START      true
 #define FLUSH_INTERVAL_PKTS      10
 #define SERIAL_BAUD              115200
 #define USE_TFT                  1
 /*************************************************************/
 
 /* ====== Constantes derivadas ====== */
 static const uint32_t PERIOD_SEND_MS = (1000UL / F_ENVIO_HZ);
 static const uint32_t PERIOD_MEAS_MS = (1000UL / F_MEDICION_HZ);
 
 /* ====== Objetos globales ====== */
 HT_st7735 tft;
 TinyGPSPlus GPS;
 LSM6DS3 imu(I2C_MODE, LSM6DS3_ADDR);
 
 /* ====== Radio (Heltec) ====== */
 static RadioEvents_t RadioEvents;
 volatile bool txDone = false;
 
 /* ====== Estado / sesión ====== */
 enum RunState { ST_INIT, ST_IDLE, ST_CAPTURE, ST_FINISHED };
 RunState g_state = ST_INIT;
 
 File g_logFile;
 uint32_t g_pktCount = 0;
 uint32_t g_sessionStartMs = 0;
 
 /* ====== Botón USER (GPIO0) ====== */
 #define USER_BTN_PIN 0
 bool lastBtn = true;
 uint32_t lastBtnChangeMs = 0;
 const uint32_t BTN_DEBOUNCE_MS = 80;
 
 /* ====== Reed ISR ====== */
 volatile uint32_t tLast_us = 0;
 volatile uint32_t dt_us    = 0;
 volatile bool     newDt    = false;
 
 /* ====== Mediana ====== */
 uint32_t dtBuf[MEDIAN_WINDOW] = {0};
 int      dtIdx = 0;
 bool     bufFull = false;
 
 /* ====== Velocidad filtrada ====== */
 float    v_kmh_f = 0.0f;
 uint32_t lastPulseSeen_us = 0;
 
 /* ====== Acumuladores de promedios ====== */
 struct AvgAcc {
   double sum; uint16_t n;
   void add(float v){ sum += v; n++; }
   float mean() const { return n? (float)(sum / n) : 0.0f; }
   void reset(){ sum=0; n=0; }
 };
 AvgAcc acc_ax, acc_ay, acc_az;
 AvgAcc acc_gx, acc_gy, acc_gz;
 AvgAcc acc_vel;
 
 uint32_t lastMeasureMs = 0;
 uint32_t lastSendMs    = 0;
 uint32_t flushCounter  = 0;
 
 /* ====== Helpers TFT ====== */
 void tft_clear() {
 #if USE_TFT
   tft.st7735_fill_screen(ST7735_BLACK);
 #endif
 }
 void tft_msg(int x, int y, const String &s) {
 #if USE_TFT
   tft.st7735_write_str(x, y, s, Font_7x10, ST7735_WHITE, ST7735_BLACK);
 #endif
 }
 void tft_showInitOk()             { tft_clear(); tft_msg(0, 0, "Inicializacion OK"); }
 void tft_showInitError(String e)  { tft_clear(); tft_msg(0, 0, "ERROR: " + e); }
 void tft_showPressUser()          { tft_clear(); tft_msg(0, 0, "Presiona USER para iniciar"); }
 void tft_showCapturing(uint32_t p){ tft_clear(); tft_msg(0, 0, "Recopilando"); tft_msg(0,20,"Paquetes: "+String(p)); }
 void tft_showFinished()           { tft_clear(); tft_msg(0, 0, "Recopilacion finalizada"); }
 
 /* ====== Reed ISR ====== */
 void IRAM_ATTR onPulse() {
   uint32_t t = micros();
   uint32_t dt = t - tLast_us;
   if (dt >= DEBOUNCE_us) {
     dt_us = dt;
     tLast_us = t;
     newDt = true;
   }
 }
 
 /* ====== Botón (GPIO0) ====== */
 bool btnPressed(){
   bool v = digitalRead(USER_BTN_PIN)==LOW; // pull-up
   uint32_t now = millis();
   if(v != lastBtn && (now - lastBtnChangeMs) > BTN_DEBOUNCE_MS){
     lastBtn = v; lastBtnChangeMs = now;
     if(v==true) return true; // flanco de bajada
   }
   return false;
 }
 
 /* ====== GNSS init ====== */
 bool initGNSS() {
   pinMode(VGNSS_CTRL, OUTPUT);
   digitalWrite(VGNSS_CTRL, HIGH);
 
   Serial1.begin(GPS_BAUD, SERIAL_8N1, GPS_TX_PIN, GPS_RX_PIN);
 
   uint32_t startAttempt = millis();
   tft_clear(); tft_msg(0,0,"Esperando GNSS...");
 
   while (millis() - startAttempt < GNSS_START_TIMEOUT_MS) {
     while (Serial1.available()) {
       char c = Serial1.read();
       GPS.encode(c);
       if (GPS.time.second() != 0) {
         tft_clear(); tft_msg(0,0,"GNSS ACTIVADO");
         delay(GNSS_WARMUP_MS);
         return true;
       }
     }
   }
 
   // retry power-cycle
   digitalWrite(VGNSS_CTRL, LOW);
   delay(1000);
   digitalWrite(VGNSS_CTRL, HIGH);
   Serial1.flush();
   return false;
 }
 
 /* ====== LittleFS ====== */
 bool fsMount() {
   if (LittleFS.begin(false)) return true;
   return LittleFS.begin(true); // formatea si no pudo montar
 }
 
 bool fsPrepareSessionFile() {
   if (DELETE_ALL_ON_START) {
     File root = LittleFS.open("/", "r");
     if (root) {
       File f;
       while ((f = root.openNextFile())) {
         String name = f.name();
         f.close();
         LittleFS.remove(name);
       }
       root.close();
     }
   }
   if (LittleFS.exists(LOG_FILENAME)) LittleFS.remove(LOG_FILENAME);
   g_logFile = LittleFS.open(LOG_FILENAME, "w");
   return (bool)g_logFile;
 }
 
 /* ====== LoRa callbacks ====== */
 void OnTxDone(void)    { txDone = true; }
 void OnTxTimeout(void) { Serial.println("[LoRa] TX timeout"); txDone = true; }
 
 /* ====== IMU setup (rangos) ====== */
 void imuApplyRanges(){
   // Mantener defaults compatibles (±2g / ±125 dps) si tu fork no tiene setters.
 }
 
 /* ====== Medición Reed -> v_kmh_f ====== */
 void updateSpeedFromReed(){
   uint32_t dt_local = 0;
   bool hasNew = false;
   noInterrupts();
   if (newDt) {
     dt_local = dt_us;
     newDt = false;
     hasNew = true;
     lastPulseSeen_us = tLast_us;
   }
   interrupts();
 
   static uint32_t dt_lastAccepted = 0;
   if (hasNew) {
     bool accept = true;
     if (dt_lastAccepted > 0) {
       if (dt_local < (dt_lastAccepted * 4UL)/10UL ||
           dt_local > (dt_lastAccepted * 25UL)/10UL) {
         accept = false;
       }
     }
     if (accept) {
       dtBuf[dtIdx] = dt_local;
       dtIdx = (dtIdx + 1) % MEDIAN_WINDOW;
       if (dtIdx == 0) bufFull = true;
       dt_lastAccepted = dt_local;
     }
   }
 
   float v_kmh_inst = 0.0f;
   int n = bufFull ? MEDIAN_WINDOW : dtIdx;
   if (n > 0) {
     uint32_t tmp[MEDIAN_WINDOW];
     for(int i=0;i<n;i++) tmp[i]=dtBuf[i];
     for(int i=1;i<n;i++){
       uint32_t key = tmp[i]; int j=i-1;
       while(j>=0 && tmp[j]>key){ tmp[j+1]=tmp[j]; j--; }
       tmp[j+1]=key;
     }
     uint32_t dt_med = tmp[n/2];
     float T_s = dt_med / 1e6f;
     if (T_s > 0.0f) v_kmh_inst = (3.14159265f * D_m / (N_PULSOS * T_s)) * 3.6f;
   }
 
   uint32_t now_us = micros();
   if ((now_us - lastPulseSeen_us) > TIMEOUT_NO_PULSE_ms * 1000UL) v_kmh_inst = 0.0f;
 
   v_kmh_f = EMA_ALPHA * v_kmh_inst + (1.0f - EMA_ALPHA) * v_kmh_f;
 }
 
 /* ====== Bit Writer (MSB-first por campo) ====== */
 struct BitWriter {
   uint8_t* buf; int bits, capBits;
   void init(uint8_t* b, int cap){ buf=b; bits=0; capBits=cap; memset(buf,0,capBits/8); }
   void write(uint32_t val, int n){
     for(int i=n-1;i>=0;i--){
       uint8_t bit = (val>>i)&1U;
       int byteIdx = bits>>3;
       int bitInByte = 7 - (bits & 7);
       if (byteIdx < (capBits/8)) { if (bit) buf[byteIdx] |= (1<<bitInByte); }
       bits++;
     }
   }
 };
 
 /* ====== Saturación helper ====== */
 inline bool saturateIfOut(uint32_t maxMag, uint32_t mag, uint32_t &magOut){
   if (mag > maxMag){ magOut = 0; return true; }
   magOut = mag; return false;
 }
 
 /* ====== Empaquetado Layout V3 (18 bytes) ====== */
 void buildPacket(uint8_t out[18],
                  uint8_t vehicleId,
                  uint32_t time_s,
                  double lat, double lon,
                  float ax_g, float ay_g, float az_g,
                  float gx_dps, float gy_dps, float gz_dps,
                  float v_kmh,
                  bool &satFlag)
 {
   satFlag = false;
   BitWriter bw; bw.init(out, 144);
 
   // ID (9)
   bw.write((vehicleId & 0x1FF), 9);
 
   // t (15)
   if (time_s > 32767U) { satFlag = true; time_s = 0; }
   bw.write(time_s, 15);
 
   // ΔLat / ΔLon (1+15) escala 1e-6
   auto packDelta = [&](double coord, double origin){
     double delta = coord - origin;
     uint8_t sign = (delta >= 0.0) ? 1 : 0;
     uint32_t mag = (uint32_t)llround(fabs(delta) * 1e6);
     uint32_t magOut; if (saturateIfOut(32767U, mag, magOut)) satFlag = true;
     bw.write(sign, 1);
     bw.write(magOut, 15);
   };
   packDelta(lat, ORIGIN_LAT);
   packDelta(lon, ORIGIN_LON);
 
   // Accels: g*100 -> 1+8
   auto packAccel = [&](float g){
     int32_t raw = (int32_t)lround(g * 100.0f);
     uint8_t sign = (raw >= 0) ? 1 : 0;
     uint32_t mag = (uint32_t)abs(raw);
     uint32_t magOut; if (saturateIfOut(255U, mag, magOut)) satFlag = true;
     bw.write(sign, 1); bw.write(magOut, 8);
   };
   packAccel(ax_g); packAccel(ay_g); packAccel(az_g);
 
   // Gyros: dps*100 -> 1+14
   auto packGyro = [&](float dps){
     int32_t raw = (int32_t)lround(dps * 100.0f);
     uint8_t sign = (raw >= 0) ? 1 : 0;
     uint32_t mag = (uint32_t)abs(raw);
     uint32_t magOut; if (saturateIfOut(16383U, mag, magOut)) satFlag = true;
     bw.write(sign, 1); bw.write(magOut, 14);
   };
   packGyro(gx_dps); packGyro(gy_dps); packGyro(gz_dps);
 
   // Vel: km/h*100 -> 15 bits (tope lógico 99.00)
   uint32_t v100 = (uint32_t)lround(v_kmh * 100.0f);
   uint32_t vOut;
   if (v100 > 9900U) { vOut = 0; satFlag = true; }
   else {
     if (saturateIfOut(32767U, v100, vOut)) satFlag = true;
   }
   bw.write(vOut, 15);
 
   // Saturación global (1)
   bw.write(satFlag ? 1U : 0U, 1);
 }
 
 /* ====== Medición IMU (polling) ====== */
 void measureIMUandSpeedAccumulators(){
   float ax = imu.readFloatAccelX(); // g
   float ay = imu.readFloatAccelY();
   float az = imu.readFloatAccelZ();
   float gx = imu.readFloatGyroX();  // dps
   float gy = imu.readFloatGyroY();
   float gz = imu.readFloatGyroZ();
 
   acc_ax.add(ax); acc_ay.add(ay); acc_az.add(az);
   acc_gx.add(gx); acc_gy.add(gy); acc_gz.add(gz);
   acc_vel.add(v_kmh_f);
 }
 
 /* ====== Limpieza de acumuladores ====== */
 void resetAccumulators(){
   acc_ax.reset(); acc_ay.reset(); acc_az.reset();
   acc_gx.reset(); acc_gy.reset(); acc_gz.reset();
   acc_vel.reset();
 }
 
 /* ====== Envío + Log ====== */
 void sendAndLogPacket(){
   // Promedios
   float ax = acc_ax.mean(), ay = acc_ay.mean(), az = acc_az.mean();
   float gx = acc_gx.mean(), gy = acc_gy.mean(), gz = acc_gz.mean();
   float vv = acc_vel.mean();
 
   // GPS snapshot
   double lat = GPS.location.isValid() ? GPS.location.lat() : ORIGIN_LAT;
   double lon = GPS.location.isValid() ? GPS.location.lng() : ORIGIN_LON;
 
   uint32_t t_s = (millis() - g_sessionStartMs) / 1000UL;
 
   uint8_t payload[18];
   bool sat = false;
   buildPacket(payload, (uint8_t)VEHICLE_ID, t_s, lat, lon, ax, ay, az, gx, gy, gz, vv, sat);
 
   // Guardar binario tal cual
   if (g_logFile) {
     g_logFile.write(payload, sizeof(payload));
     flushCounter++;
     if (flushCounter >= FLUSH_INTERVAL_PKTS) { g_logFile.flush(); flushCounter = 0; }
   }
 
   // TX LoRa
   txDone = false;
   Radio.Send((uint8_t*)payload, sizeof(payload));
 
   // (Opcional) Espera breve a TX para diagnóstico
   uint32_t t0 = millis();
   while (!txDone && millis() - t0 < LORA_TIMEOUT_MS + 500) {
     Radio.IrqProcess();
     delay(1);
   }
 
   g_pktCount++;
   tft_showCapturing(g_pktCount);
 
   // Log textual mínimo (sin hex)
   Serial.printf("[PKT #%lu] t=%lus sat=%d v=%.2f\n",
                 (unsigned long)g_pktCount, (unsigned long)t_s, sat?1:0, vv);
 }
 
 /* ====== SETUP ====== */
 void setup(){
   Serial.begin(SERIAL_BAUD);
   delay(50);
 
   // Init Heltec (importante para front-end RF/RTC/etc.)
   Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);
 
 #if USE_TFT
   tft.st7735_init();
   tft_clear();
   tft_msg(0,0,"Iniciando...");
 #endif
 
   // Botón
   pinMode(USER_BTN_PIN, INPUT_PULLUP);
 
   // FS
   if (!fsMount()) { tft_showInitError("LittleFS"); while(1){ delay(1000);} }
 
   // I2C + IMU
   Wire.begin(I2C_SDA, I2C_SCL);
   imuApplyRanges();
   if (imu.begin() != 0) { tft_showInitError("IMU"); while(1){ delay(1000);} }
 
   // Reed
   pinMode(REED_PIN, INPUT_PULLUP);
   attachInterrupt(digitalPinToInterrupt(REED_PIN), onPulse, FALLING);
 
   // GNSS
   if (!initGNSS()) { tft_showInitError("GNSS"); while(1){ delay(1000);} }
 
   // LoRa
   RadioEvents.TxDone    = OnTxDone;
   RadioEvents.TxTimeout = OnTxTimeout;
   Radio.Init(&RadioEvents);
 
   Radio.SetPublicNetwork(true); // sync-word 0x34
   Radio.SetChannel(RF_FREQUENCY);
   Radio.SetRxConfig(MODEM_LORA, 0, LORA_BANDWIDTH, LORA_SPREADING_FACTOR,
                     0, LORA_CODINGRATE, LORA_PREAMBLE_LENGTH,
                     false, 0, true, 0, 0, LORA_IQ_INVERSION_ON, true);
 
   Radio.SetTxConfig(MODEM_LORA, TX_OUTPUT_POWER, 0, LORA_BANDWIDTH,
                     LORA_SPREADING_FACTOR, LORA_CODINGRATE, LORA_PREAMBLE_LENGTH,
                     false, true, 0, 0, LORA_IQ_INVERSION_ON, LORA_TIMEOUT_MS);
 
   tft_showInitOk();
   g_state = ST_IDLE;
   tft_showPressUser();
 
   lastMeasureMs = millis();
   lastSendMs    = millis();
 }
 
 /* ====== LOOP ====== */
 void loop(){
   Radio.IrqProcess();
 
   while (Serial1.available()) GPS.encode(Serial1.read());
 
   // USER button
   if (btnPressed()){
     if (g_state == ST_IDLE) {
       if (!fsPrepareSessionFile()) { tft_showInitError("Crear log.bin"); return; }
       g_sessionStartMs = millis();
       g_pktCount = 0;
       flushCounter = 0;
       resetAccumulators();
       tft_showCapturing(0);
       g_state = ST_CAPTURE;
     } else if (g_state == ST_CAPTURE) {
       if (g_logFile) { g_logFile.flush(); g_logFile.close(); }
       g_state = ST_FINISHED;
       tft_showFinished();
     } else if (g_state == ST_FINISHED) {
       tft_showPressUser();
       g_state = ST_IDLE;
     }
   }
 
   // Comando 'r' -> emitir archivo en BINARIO por Serial (sin hex)
   if (Serial.available()) {
     char c = Serial.read();
     if (c == 'r' && g_state != ST_CAPTURE) {
       File f = LittleFS.open(LOG_FILENAME, "r");
       if (f) {
         // stream binario directo
         const size_t BUFS=256;
         uint8_t buf[BUFS];
         while (true) {
           int n = f.read(buf, BUFS);
           if (n <= 0) break;
           Serial.write(buf, n);   // <<< BINARIO TAL CUAL
         }
         f.close();
       } else {
         Serial.println("[FS] No existe log.bin");
       }
     }
   }
 
   if (g_state == ST_CAPTURE) {
     updateSpeedFromReed();
 
     uint32_t now = millis();
 
     if (now - lastMeasureMs >= PERIOD_MEAS_MS) {
       lastMeasureMs = now;
       measureIMUandSpeedAccumulators();
     }
 
     if (now - lastSendMs >= PERIOD_SEND_MS) {
       lastSendMs = now;
       sendAndLogPacket();
       txDone = false;
     }
   }
 }
 
