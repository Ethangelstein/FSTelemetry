#include <SPI.h>
#include <LoRa.h>

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
#define SPREADING_FACTOR  8         // SF12
#define CODING_RATE       5          // 4/5
#define PREAMBLE_LENGTH   8
#define SYNC_WORD         0x34       // público (mismo que el emisor)
// IQ inversion: OFF (por defecto en la librería Arduino LoRa)

unsigned long startTime = 0;
unsigned long packetCount = 0;

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
  LoRa.setSpreadingFactor(SPREADING_FACTOR); // SF12
  LoRa.setCodingRate4(CODING_RATE);       // 4/5
  LoRa.setPreambleLength(PREAMBLE_LENGTH);// 8
  LoRa.setSyncWord(SYNC_WORD);            // 0x34
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
    int h = elapsed / 3600;
    int m = (elapsed % 3600) / 60;
    int s = elapsed % 60;

    Serial.println("===== Paquete recibido =====");
    Serial.print("Frecuencia: "); Serial.print(RF_FREQUENCY / 1E6); Serial.println(" MHz");
    Serial.print("Número de paquete: "); Serial.println(packetCount);
    Serial.print("Tamaño del paquete: "); Serial.print(packetSize); Serial.println(" bytes");

    Serial.print("Contenido (texto): ");
    Serial.println(receivedText);

    Serial.print("Contenido (HEX): ");
    for (int i = 0; i < index; i++) {
      if (rawData[i] < 16) Serial.print("0");
      Serial.print(rawData[i], HEX);
      Serial.print(" ");
    }
    Serial.println();

    Serial.print("RSSI: "); Serial.print(rssi); Serial.println(" dBm");
    Serial.print("SNR: "); Serial.println(snr);

    Serial.print("Tiempo desde inicio: ");
    if (h < 10) Serial.print("0"); Serial.print(h); Serial.print(":");
    if (m < 10) Serial.print("0"); Serial.print(m); Serial.print(":");
    if (s < 10) Serial.print("0"); Serial.println(s);

    Serial.println("============================\n");
  }
}

