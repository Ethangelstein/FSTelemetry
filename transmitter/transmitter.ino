#include "LoRaWan_APP.h"
#include "Arduino.h"
#include "HT_st7735.h"  // Librería del display
#include <ArduinoJson.h>

// === TELEMETRY DATA STRUCTURE ===
struct TelemetryData {
  String id;               // Vehicle/Device ID
  unsigned long timestamp; // Unix timestamp
  float gps[3];           // GPS: [latitude, longitude, altitude]
  int rpm;                // Engine RPM
  int accelerometer[3];   // Accelerometer: [x, y, z]
  int voltage;            // Battery voltage (mV)
  int current;            // Current consumption (mA)
};

// === CONFIGURACIÓN LORA ===
#define RF_FREQUENCY            915000000 // Hz
#define TX_OUTPUT_POWER         14         // dBm
#define LORA_BANDWIDTH          0        // 0:125kHz, 1:250kHz, 2:500kHz
#define LORA_SPREADING_FACTOR   12         // [SF7..SF12]
#define LORA_CODINGRATE         1         // 1:4/5, 2:4/6, 3:4/7, 4:4/8
#define LORA_PREAMBLE_LENGTH    8
#define LORA_FIX_LENGTH_PAYLOAD_ON  false
#define LORA_IQ_INVERSION_ON    false
#define LORA_TIMEOUT_MS         3000

#define SYNC_WORD 0x34         // ID único de red

#define TX_INTERVAL             5000 // milisegundos entre paquetes

// === VARIABLES GLOBALES ===
unsigned long previousMillis = 0;
uint32_t packetCount = 0;
unsigned long startTime;

HT_st7735 st7735;  // Instancia del display

static RadioEvents_t RadioEvents;

// === FUNCTION DECLARATIONS ===
void OnTxDone(void);
void OnTxTimeout(void);
TelemetryData generateRandomTelemetry(void);
String serializeTelemetryToJson(const TelemetryData& data);

void setup() {
  Serial.begin(115200);

  // Initialize random seed
  randomSeed(analogRead(0));

  // Inicialización placa y pantalla
  Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);
  st7735.st7735_init();  // Inicializar el display

  // Inicialización LoRa
  RadioEvents.TxDone = OnTxDone;
  RadioEvents.TxTimeout = OnTxTimeout;
  Radio.Init(&RadioEvents);

  // Asegurar sync-word "público" = 0x34 e IQ normal
  Radio.SetPublicNetwork(true);          // => sync-word 0x34
  Radio.SetRxConfig(                     // aunque no recibas, fija defaults compatibles
    MODEM_LORA, 0, LORA_BANDWIDTH, LORA_SPREADING_FACTOR,
    0, LORA_CODINGRATE, LORA_PREAMBLE_LENGTH,
    LORA_FIX_LENGTH_PAYLOAD_ON, 0, true, 0, 0, LORA_IQ_INVERSION_ON, true
  );


  Radio.SetChannel(RF_FREQUENCY);
  Radio.SetTxConfig(
    MODEM_LORA,
    TX_OUTPUT_POWER,
    0,
    LORA_BANDWIDTH,
    LORA_SPREADING_FACTOR,
    LORA_CODINGRATE,
    LORA_PREAMBLE_LENGTH,
    LORA_FIX_LENGTH_PAYLOAD_ON,
    true,  // CRC On
    0,     // Frequency hopping disabled
    0,     // Hop period
    LORA_IQ_INVERSION_ON,
    LORA_TIMEOUT_MS
  );

  startTime = millis();
}

void loop() {
  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= TX_INTERVAL) {
    previousMillis = currentMillis;
    packetCount++;

    // Generate random telemetry data
    TelemetryData telemetry = generateRandomTelemetry();
    
    // Serialize to JSON
    String jsonPayload = serializeTelemetryToJson(telemetry);
    
    // Send LoRa packet
    Radio.Send((uint8_t *)jsonPayload.c_str(), jsonPayload.length());

    // Update display with telemetry info
    updateDisplay(telemetry);
    
    // Print to serial for debugging
    Serial.print("Sent packet #");
    Serial.print(packetCount);
    Serial.print(": ");
    Serial.println(jsonPayload);
  }

  Radio.IrqProcess();
}

void updateDisplay(const TelemetryData& telemetry) {
  st7735.st7735_fill_screen(ST7735_BLACK);  // Clear screen

  char buffer[32];
  
  // Line 1: Vehicle ID and packet count
  sprintf(buffer, "ID:%s #%lu", telemetry.id.c_str(), packetCount);
  st7735.st7735_write_str(0, 0, buffer, Font_7x10, ST7735_WHITE, ST7735_BLACK);

  // Line 2: GPS coordinates
  sprintf(buffer, "GPS:%.2f,%.2f", telemetry.gps[0], telemetry.gps[1]);
  st7735.st7735_write_str(0, 15, buffer, Font_7x10, ST7735_CYAN, ST7735_BLACK);

  // Line 3: RPM and altitude
  sprintf(buffer, "RPM:%d ALT:%.1fm", telemetry.rpm, telemetry.gps[2]);
  st7735.st7735_write_str(0, 30, buffer, Font_7x10, ST7735_GREEN, ST7735_BLACK);

  // Line 4: Accelerometer
  sprintf(buffer, "ACC:%d,%d,%d", telemetry.accelerometer[0], telemetry.accelerometer[1], telemetry.accelerometer[2]);
  st7735.st7735_write_str(0, 45, buffer, Font_7x10, ST7735_YELLOW, ST7735_BLACK);

  // Line 5: Voltage and Current
  sprintf(buffer, "V:%dmV I:%dmA", telemetry.voltage, telemetry.current);
  st7735.st7735_write_str(0, 60, buffer, Font_7x10, ST7735_RED, ST7735_BLACK);

  // Line 6: Uptime
  unsigned long elapsed = (millis() - startTime) / 1000;
  int hours = elapsed / 3600;
  int minutes = (elapsed % 3600) / 60;
  int seconds = elapsed % 60;
  sprintf(buffer, "UP:%02d:%02d:%02d", hours, minutes, seconds);
  st7735.st7735_write_str(0, 75, buffer, Font_7x10, ST7735_WHITE, ST7735_BLACK);
}

// === TELEMETRY FUNCTIONS ===
TelemetryData generateRandomTelemetry() {
  TelemetryData data;
  
  // Vehicle ID (example format)
  data.id = "trk1";
  
  // Current timestamp (millis since boot)
  data.timestamp = millis() / 1000; // Convert to seconds
  
  // GPS coordinates (Buenos Aires area with random variation)
  data.gps[0] = -34.6037 + (random(-1000, 1000) / 10000.0); // Latitude ±0.1°
  data.gps[1] = -58.3816 + (random(-1000, 1000) / 10000.0); // Longitude ±0.1°
  data.gps[2] = 25.0 + (random(-50, 200) / 10.0);           // Altitude 20-45m

  // Engine RPM (800-6000 RPM typical range)
  data.rpm = random(800, 6000);
  
  // Accelerometer values (-200 to +200 for normal driving)
  data.accelerometer[0] = random(-200, 200); // X-axis
  data.accelerometer[1] = random(-200, 200); // Y-axis  
  data.accelerometer[2] = random(950, 1050); // Z-axis (gravity ~1000mg)
  
  // Battery voltage (11000-14000 mV for 12V system)
  data.voltage = random(11000, 14000);
  
  // Current consumption (100-2000 mA typical)
  data.current = random(100, 2000);
  
  return data;
}

String serializeTelemetryToJson(const TelemetryData& data) {
  // Create JSON document
  DynamicJsonDocument doc(512);
  
  doc["id"] = data.id;
  doc["t"] = data.timestamp;
  
  // GPS array
  JsonArray gpsArray = doc.createNestedArray("g");
  gpsArray.add(data.gps[0]);
  gpsArray.add(data.gps[1]);
  gpsArray.add(data.gps[2]);
  
  doc["r"] = data.rpm;
  
  // Accelerometer array
  JsonArray accArray = doc.createNestedArray("a");
  accArray.add(data.accelerometer[0]);
  accArray.add(data.accelerometer[1]);
  accArray.add(data.accelerometer[2]);
  
  doc["v"] = data.voltage;
  doc["c"] = data.current;
  
  // Serialize to string
  String jsonString;
  serializeJson(doc, jsonString);
  
  return jsonString;
}

void OnTxDone(void) {
  Serial.println("Telemetry packet sent successfully.");
}

void OnTxTimeout(void) {
  Serial.println("Transmission timeout error.");
}
