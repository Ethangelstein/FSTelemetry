/****************************************************
 * TEST_1_v3_RX (ESP32-C3 Super Mini + RFM95CW)
 * - Siempre imprime “LoRa inicializado” al boot/reset
 * - RX continuo
 * - Decodificación del payload binario v3 (18 bytes)
 ****************************************************/
 #include <Arduino.h>
 #include <SPI.h>
 #include <LoRa.h>
 #include "esp_system.h"
 
 /*********** Pines (ajusta si hace falta) ***********/
 #define LORA_SS   5
 #define LORA_RST  2
 #define LORA_DIO0 3
 #define PIN_SCK   4
 #define PIN_MOSI  6
 #define PIN_MISO  7
 
 /*********** Radio (hazlos coincidir con el emisor) ***********/
 #define RF_FREQUENCY     915E6
 #define BANDWIDTH_HZ     250E3
 #define SPREADING_FACTOR 11
 #define CODING_RATE_DEN  5
 #define PREAMBLE_LENGTH  8
 #define SYNC_WORD        0x34
 #define TX_POWER_DBM     17
 #define SERIAL_BAUD      115200
 
 #define RX_BUF_MAX       255
 #define PAYLOAD_LEN      18
 
 /*********** Origen coordenadas (igual que emisor) ***********/
 #define ORIGIN_LAT       (-34.639444)
 #define ORIGIN_LON       (-58.483056)
 
 static uint32_t g_pktCount = 0;
 static uint32_t g_lastRxMs = 0;
 
 /*********** Helper BitReader ***********/
 struct BitReader {
   const uint8_t* buf; int bits, capBits;
   void init(const uint8_t* b, int capBytes){ buf=b; bits=0; capBits=capBytes*8; }
   uint32_t read(int n){
     uint32_t v=0;
     for(int i=0;i<n;i++){
       int byteIdx = bits>>3;
       int bitInByte = 7-(bits&7);
       uint8_t bit = (buf[byteIdx]>>bitInByte)&1U;
       v=(v<<1)|bit;
       bits++;
     }
     return v;
   }
 };
 
 /*********** Estructura del frame decodificado ***********/
 struct DecodedFrame {
   uint16_t id;
   uint32_t t_s;
   double lat, lon;
   float ax_g, ay_g, az_g;
   float gx_dps, gy_dps, gz_dps;
   float vel_kmh;
   bool sat;
   bool ok;
 };
 
 /*********** Función de decodificación ***********/
 static DecodedFrame decodeV3(const uint8_t* p, int n){
   DecodedFrame out{}; out.ok = false;
   if(n != PAYLOAD_LEN) return out;
 
   BitReader br; br.init(p,n);
 
   out.id  = br.read(9);
   out.t_s = br.read(15);
 
   auto readDelta = [&](double origin){
     uint8_t sign = br.read(1);
     uint32_t mag = br.read(15);
     double delta = ((int)sign ? 1.0 : -1.0) * (double)mag * 1e-6;
     return origin + delta;
   };
   out.lat = readDelta(ORIGIN_LAT);
   out.lon = readDelta(ORIGIN_LON);
 
   auto readAccel = [&](){
     uint8_t sign = br.read(1);
     uint32_t mag = br.read(8);
     float g = (float)mag / 100.0f;
     if(!sign) g = -g;
     return g;
   };
   out.ax_g = readAccel();
   out.ay_g = readAccel();
   out.az_g = readAccel();
 
   auto readGyro = [&](){
     uint8_t sign = br.read(1);
     uint32_t mag = br.read(14);
     float dps = (float)mag / 100.0f;
     if(!sign) dps = -dps;
     return dps;
   };
   out.gx_dps = readGyro();
   out.gy_dps = readGyro();
   out.gz_dps = readGyro();
 
   out.vel_kmh = (float)br.read(15)/100.0f;
   out.sat     = br.read(1);
 
   out.ok = true;
   return out;
 }
 
 static void waitSerialReady(uint32_t timeout_ms=3000){
   uint32_t t0=millis();
   while(!Serial && (millis()-t0)<timeout_ms) {}
   delay(50);
 }
 static const char* resetReasonToStr(esp_reset_reason_t r){
   switch(r){
     case ESP_RST_POWERON: return "POWERON";
     case ESP_RST_EXT: return "EXT_RESET";
     case ESP_RST_SW: return "SW_RESET";
     case ESP_RST_PANIC: return "PANIC";
     case ESP_RST_INT_WDT: return "WDT_INT";
     case ESP_RST_TASK_WDT: return "WDT_TASK";
     case ESP_RST_WDT: return "WDT_OTHER";
     case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
     case ESP_RST_BROWNOUT: return "BROWNOUT";
     case ESP_RST_SDIO: return "SDIO";
     default: return "UNKNOWN";
   }
 }
 
 static void printRadioConfig(){
   Serial.println("=== LoRa inicializado ===");
   Serial.print("Frecuencia: "); Serial.print(RF_FREQUENCY/1E6); Serial.println(" MHz");
   Serial.print("BW: "); Serial.print(BANDWIDTH_HZ/1000); Serial.println(" kHz");
   Serial.print("SF: "); Serial.println(SPREADING_FACTOR);
   Serial.print("CR: 4/"); Serial.println(CODING_RATE_DEN);
   Serial.print("Preambulo: "); Serial.println(PREAMBLE_LENGTH);
   Serial.print("SyncWord: 0x"); Serial.println(SYNC_WORD, HEX);
   Serial.println("Modo: RX continuo. Esperando paquetes...\n");
 }
 
 /*********** ===== AÑADIDO: Emisión binaria TD (60 bytes + CRC) ===== ***********/
 static uint16_t crc16_modbus(const uint8_t* data, size_t n){
   uint16_t crc = 0xFFFF;
   for(size_t i=0;i<n;i++){
     crc ^= data[i];
     for(int b=0;b<8;b++){
       if(crc & 1) crc = (crc >> 1) ^ 0xA001;
       else        crc = (crc >> 1);
     }
   }
   return crc;
 }
 
 // Layout EXACTO (little-endian) que tu Rust ya espera:
 // [0] 'T'  [1] 'D'
 // [2] version (u8)      -> 1
 // [3] reserved (u8)     -> 0
 // [4..20] id[16] ASCII null-terminated (tu id decimal)
 // [20..24] timestamp u32 (s)  -> usamos millis()/1000
 // [24..28] latitude f32
 // [28..32] longitude f32
 // [32..36] altitude f32       -> 0.0
 // [36..38] rpm i16            -> 0
 // [38..40] ax i16             -> int16 de ax_g * 100 (centi-g)
 // [40..42] ay i16             -> int16 de ay_g * 100
 // [42..44] az i16             -> int16 de az_g * 100
 // [44..46] voltage_mv u16     -> 0
 // [46..48] current_ma u16     -> 0
 // [48..50] rssi i16
 // [50..54] snr f32
 // [54..58] packet_count u32
 // [58..60] CRC16-Modbus LE sobre bytes [0..58)
 static void emitBinaryFrame(const DecodedFrame& f, uint32_t pktCount, int rssi, float snr){
   uint8_t b[60]; memset(b, 0, sizeof(b));
   b[0] = 'T'; b[1] = 'D';
   b[2] = 1;   b[3] = 0;
 
   // id ASCII (hasta 16 bytes, null-terminated)
   char idStr[17]; snprintf(idStr, sizeof(idStr), "%u", (unsigned)f.id);
   for(int i=0;i<16;i++){ b[4+i] = (uint8_t)idStr[i]; if(idStr[i]==0) break; }
 
   // timestamp (s) - receptor
   uint32_t ts = millis()/1000;
   memcpy(&b[20], &ts, 4);
 
   // lat/lon/alt f32 (LE)
   float lat = (float)f.lat;
   float lon = (float)f.lon;
   float alt = 0.0f;
   memcpy(&b[24], &lat, 4);
   memcpy(&b[28], &lon, 4);
   memcpy(&b[32], &alt, 4);
 
   // rpm i16 -> 0
   int16_t rpm = 0;
   memcpy(&b[36], &rpm, 2);
 
   // ax/ay/az i16 -> escalamos g * 100 (centi-g)
   auto to_i16_centi_g = [](float g)->int16_t{
     float v = g * 100.0f;
     if(v > 32767.0f) v = 32767.0f;
     if(v < -32768.0f) v = -32768.0f;
     return (int16_t)lrintf(v);
   };
   int16_t ax = to_i16_centi_g(f.ax_g);
   int16_t ay = to_i16_centi_g(f.ay_g);
   int16_t az = to_i16_centi_g(f.az_g);
   memcpy(&b[38], &ax, 2);
   memcpy(&b[40], &ay, 2);
   memcpy(&b[42], &az, 2);
 
   // voltaje/corriente -> 0
   uint16_t mv = 0, ma = 0;
   memcpy(&b[44], &mv, 2);
   memcpy(&b[46], &ma, 2);
 
   // rssi i16
   int16_t rssi_i16 = (int16_t)rssi;
   memcpy(&b[48], &rssi_i16, 2);
 
   // snr f32
   memcpy(&b[50], &snr, 4);
 
   // packet_count u32
   memcpy(&b[54], &pktCount, 4);
 
   // CRC16-Modbus (LE) sobre [0..58)
   uint16_t crc = crc16_modbus(b, 58);
   memcpy(&b[58], &crc, 2);
 
   // Emitir por serial (binario)
   Serial.write(b, sizeof(b));
 }
 /*********** ===== FIN AÑADIDO ===== ***********/
 
 void setup(){
   Serial.begin(SERIAL_BAUD);
   waitSerialReady();
 
   Serial.println("\n====================================");
   Serial.println("TEST_1_v3_RX (ESP32-C3 + RFM95CW)");
   Serial.print("Reset reason: "); Serial.println(resetReasonToStr(esp_reset_reason()));
   Serial.println("Inicializando SPI/LoRa...");
 
   SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, LORA_SS);
   LoRa.setSPI(SPI);
   LoRa.setSPIFrequency(8E6);
   LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
 
   if(!LoRa.begin(RF_FREQUENCY)){
     Serial.println("❌ ERROR: No se pudo iniciar LoRa. Revisa cableado y modulo.");
     while(true) delay(1000);
   }
 
   LoRa.setSignalBandwidth(BANDWIDTH_HZ);
   LoRa.setSpreadingFactor(SPREADING_FACTOR);
   LoRa.setCodingRate4(CODING_RATE_DEN);
   LoRa.setPreambleLength(PREAMBLE_LENGTH);
   LoRa.setSyncWord(SYNC_WORD);
   LoRa.enableCrc();
   LoRa.setTxPower(TX_POWER_DBM);
 
   LoRa.receive(); // entrar en RX continuo
 
   printRadioConfig();
   g_lastRxMs = millis();
 }
 
 void loop(){
   int packetSize = LoRa.parsePacket();
   if(packetSize){
     uint8_t buf[RX_BUF_MAX]; int n=0;
     while(LoRa.available() && n<RX_BUF_MAX) buf[n++] = (uint8_t)LoRa.read();
 
     g_pktCount++;
     int rssi = LoRa.packetRssi();
     float snr = LoRa.packetSnr();
     g_lastRxMs = millis();
 
     Serial.println("=================================");
     Serial.print("[RX] #"); Serial.print(g_pktCount);
     Serial.print("  len="); Serial.print(n);
     Serial.print("  RSSI="); Serial.print(rssi); Serial.print(" dBm");
     Serial.print("  SNR="); Serial.print(snr); Serial.println(" dB");
 
     // Decodificar
     DecodedFrame f = decodeV3(buf,n);
     if(f.ok){
       Serial.println("--- DECODED FRAME ---");
       Serial.print("ID: "); Serial.println(f.id);
       Serial.print("Tiempo: "); Serial.print(f.t_s); Serial.println(" s");
       Serial.print("Lat: "); Serial.print(f.lat,6); Serial.println(" °");
       Serial.print("Lon: "); Serial.print(f.lon,6); Serial.println(" °");
       Serial.print("Acc [g] ax="); Serial.print(f.ax_g,2);
       Serial.print(" ay="); Serial.print(f.ay_g,2);
       Serial.print(" az="); Serial.println(f.az_g,2);
       Serial.print("Gyro [dps] gx="); Serial.print(f.gx_dps,2);
       Serial.print(" gy="); Serial.print(f.gy_dps,2);
       Serial.print(" gz="); Serial.println(f.gz_dps,2);
       Serial.print("Vel: "); Serial.print(f.vel_kmh,2); Serial.println(" km/h");
       Serial.print("SatFlag: "); Serial.println(f.sat ? "YES":"NO");
 
       /* ===== AÑADIDO: emitir frame binario (60 bytes TD + CRC) ===== */
       emitBinaryFrame(f, g_pktCount, rssi, snr);
       /* ===== FIN AÑADIDO ===== */
 
     } else {
       Serial.println("❌ Error: tamaño de paquete invalido");
     }
     Serial.println("=================================\n");
 
     LoRa.receive();
   }
 
   if(millis()-g_lastRxMs > 5000){
     g_lastRxMs = millis();
     Serial.println("[RX] Escuchando... (RX continuo, esperando paquetes)");
   }
 }
 
