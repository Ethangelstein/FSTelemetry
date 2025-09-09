#include <SPI.h>
#include <LoRa.h>
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

// === Pines según tu conexión final ===
#define LORA_SS    7   // NSS / SS
#define LORA_RST   2   // NRESET del RFM95
#define LORA_DIO0  3   // DIO0 (IRQ)

// SPI del ESP32-C3 con pines explícitos
#define PIN_SCK    4   // SCK
#define PIN_MOSI   6   // MOSI
#define PIN_MISO   5   // MISO

// === Parámetros LoRa (deben coincidir con el emisor) ===
#define RF_FREQUENCY      915E6      // 915 MHz
#define BANDWIDTH         125E3      // 125 kHz
#define SPREADING_FACTOR  12        // SF10 (era 8) - +6dB ganancia
#define CODING_RATE       5          // 4/5
#define PREAMBLE_LENGTH   8
#define SYNC_WORD         0x34       // público (mismo que el emisor)
#define TX_POWER          20         // Máxima potencia permitida (20dBm)
// IQ inversion: OFF (por defecto en la librería Arduino LoRa)

unsigned long startTime = 0;
unsigned long packetCount = 0;
// Estadísticas para monitoreo de calidad
float rssiSum = 0;
float snrSum = 0;
float minRssi = 0;
float maxRssi = -200;
float minSnr = 100;
float maxSnr = -100;

// === FUNCTION DECLARATIONS ===
bool parseTelemetryJson(const String& jsonString, TelemetryData& telemetry);
void displayTelemetryData(const TelemetryData& telemetry, int rssi, float snr, unsigned long elapsed);

void setup() {
  Serial.begin(115200);
  while (!Serial) {}

  // Inicia el bus SPI en los pines cableados
  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, LORA_SS);
  LoRa.setSPI(SPI);
  LoRa.setSPIFrequency(8E6); // opcional

  // Pines del RFM95
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(RF_FREQUENCY)) {
    Serial.println("Error al iniciar LoRa.");
    while (1) {}
  }

  // ==== AJUSTES QUE DEBEN COINCIDIR ====
  LoRa.setSignalBandwidth(BANDWIDTH);     // 125 kHz
  LoRa.setSpreadingFactor(SPREADING_FACTOR); // SF10 para mejor sensibilidad
  LoRa.setCodingRate4(CODING_RATE);       // 4/5
  LoRa.setPreambleLength(PREAMBLE_LENGTH);// 8
  LoRa.setSyncWord(SYNC_WORD);            // 0x34
  LoRa.setTxPower(TX_POWER);              // 20 dBm máxima potencia
  LoRa.enableCrc();                       // CRC ON (¡importante!)
  // Header explícito por defecto (equivale a payload variable)

  Serial.println("Receptor LoRa listo.");
  startTime = millis();
}

void loop() {
  int packetSize = LoRa.parsePacket(); // explícito (header) por defecto

  if (packetSize) {
    String receivedText;
    byte rawData[256];
    int index = 0;

    while (LoRa.available()) {
      char c = (char)LoRa.read();
      receivedText += c;
      if (index < 256) rawData[index++] = c;
    }

    packetCount++;

    int rssi = LoRa.packetRssi();
    float snr = LoRa.packetSnr();

    unsigned long elapsed = (millis() - startTime) / 1000;

    Serial.println("===== TELEMETRY PACKET RECEIVED =====");
    Serial.print("Frequency: "); Serial.print(RF_FREQUENCY / 1E6); Serial.println(" MHz");
    Serial.print("Packet #: "); Serial.println(packetCount);
    Serial.print("Size: "); Serial.print(packetSize); Serial.println(" bytes");
    Serial.print("Raw JSON: "); Serial.println(receivedText);

    // Parse telemetry data from JSON
    TelemetryData telemetry;
    if (parseTelemetryJson(receivedText, telemetry)) {
      Serial.println("✓ JSON parsed successfully");
      displayTelemetryData(telemetry, rssi, snr, elapsed);
    } else {
      Serial.println("✗ JSON parsing failed - showing raw data:");
      Serial.print("Raw text: "); Serial.println(receivedText);
      Serial.print("Raw HEX: ");
      for (int i = 0; i < index; i++) {
        if (rawData[i] < 16) Serial.print("0");
        Serial.print(rawData[i], HEX);
        Serial.print(" ");
      }
      Serial.println();
    }
    
    // Update statistics
    rssiSum += rssi;
    snrSum += snr;
    if (rssi < minRssi) minRssi = rssi;
    if (rssi > maxRssi) maxRssi = rssi;
    if (snr < minSnr) minSnr = snr;
    if (snr > maxSnr) maxSnr = snr;
    
    // Show averages every 10 packets
    if (packetCount % 10 == 0) {
      Serial.println(">>> STATISTICS <<<");
      Serial.print("Packets received: "); Serial.println(packetCount);
      Serial.print("Average RSSI: "); Serial.print(rssiSum/packetCount); Serial.println(" dBm");
      Serial.print("Average SNR: "); Serial.println(snrSum/packetCount);
      Serial.print("RSSI range: "); Serial.print(minRssi); Serial.print(" to "); Serial.print(maxRssi); Serial.println(" dBm");
      Serial.print("SNR range: "); Serial.print(minSnr); Serial.print(" to "); Serial.println(maxSnr);
    }

    int h = elapsed / 3600;
    int m = (elapsed % 3600) / 60;
    int s = elapsed % 60;
    Serial.print("Uptime: ");
    if (h < 10) Serial.print("0"); Serial.print(h); Serial.print(":");
    if (m < 10) Serial.print("0"); Serial.print(m); Serial.print(":");
    if (s < 10) Serial.print("0"); Serial.println(s);

    Serial.println("=====================================\n");
  }
}

// === TELEMETRY PARSING FUNCTIONS ===
bool parseTelemetryJson(const String& jsonString, TelemetryData& telemetry) {
  DynamicJsonDocument doc(512);
  
  // Parse JSON
  DeserializationError error = deserializeJson(doc, jsonString);
  
  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    return false;
  }
  
  // Extract data from JSON document
  telemetry.id = doc["id"].as<String>();
  telemetry.timestamp = doc["t"].as<unsigned long>();
  
  // GPS array
  JsonArray gpsArray = doc["g"];
  if (gpsArray.size() >= 3) {
    telemetry.gps[0] = gpsArray[0];
    telemetry.gps[1] = gpsArray[1];
    telemetry.gps[2] = gpsArray[2];
  }
  
  telemetry.rpm = doc["r"];
  
  // Accelerometer array
  JsonArray accArray = doc["a"];
  if (accArray.size() >= 3) {
    telemetry.accelerometer[0] = accArray[0];
    telemetry.accelerometer[1] = accArray[1];
    telemetry.accelerometer[2] = accArray[2];
  }
  
  telemetry.voltage = doc["v"];
  telemetry.current = doc["c"];
  
  return true;
}

void displayTelemetryData(const TelemetryData& telemetry, int rssi, float snr, unsigned long elapsed) {
  Serial.println("=== PARSED TELEMETRY DATA ===");
  
  // Vehicle Info
  Serial.print("Vehicle ID: "); Serial.println(telemetry.id);
  Serial.print("Timestamp: "); Serial.print(telemetry.timestamp); Serial.println(" sec");
  
  // GPS Data
  Serial.println("--- GPS ---");
  Serial.print("Latitude:  "); Serial.print(telemetry.gps[0], 6); Serial.println("°");
  Serial.print("Longitude: "); Serial.print(telemetry.gps[1], 6); Serial.println("°");
  Serial.print("Altitude:  "); Serial.print(telemetry.gps[2], 1); Serial.println(" m");
  
  // Engine Data
  Serial.println("--- ENGINE ---");
  Serial.print("RPM: "); Serial.println(telemetry.rpm);
  
  // Accelerometer Data
  Serial.println("--- ACCELEROMETER ---");
  Serial.print("X-axis: "); Serial.print(telemetry.accelerometer[0]); Serial.println(" mg");
  Serial.print("Y-axis: "); Serial.print(telemetry.accelerometer[1]); Serial.println(" mg");
  Serial.print("Z-axis: "); Serial.print(telemetry.accelerometer[2]); Serial.println(" mg");
  
  // Electrical Data
  Serial.println("--- ELECTRICAL ---");
  Serial.print("Voltage: "); Serial.print(telemetry.voltage); Serial.println(" mV");
  Serial.print("Current: "); Serial.print(telemetry.current); Serial.println(" mA");
  Serial.print("Power: "); Serial.print((telemetry.voltage * telemetry.current) / 1000); Serial.println(" mW");
  
  // Radio Quality
  Serial.println("--- RADIO QUALITY ---");
  Serial.print("RSSI: "); Serial.print(rssi); Serial.println(" dBm");
  Serial.print("SNR:  "); Serial.println(snr);
  
  // Link Quality Assessment
  if (rssi > -80) {
    Serial.println("Signal: EXCELLENT");
  } else if (rssi > -100) {
    Serial.println("Signal: GOOD");
  } else if (rssi > -120) {
    Serial.println("Signal: WEAK");
  } else {
    Serial.println("Signal: VERY WEAK");
  }
}

