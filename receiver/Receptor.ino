#include "LoRaWan_APP.h"
#include "Arduino.h"
#include "HT_st7735.h"  // Librería del display

// === CONFIGURACIÓN LORA ===
#define RF_FREQUENCY            915000000 // Hz
#define TX_OUTPUT_POWER         14         // dBm
#define LORA_BANDWIDTH          0        // 0:125kHz, 1:250kHz, 2:500kHz
#define LORA_SPREADING_FACTOR   8         // [SF7..SF12]
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

void OnTxDone(void);
void OnTxTimeout(void);

void setup() {
  Serial.begin(115200);

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

    // Crear y enviar paquete
    char txpacket[32];
    sprintf(txpacket, "Paquete #%lu", packetCount);
    Radio.Send((uint8_t *)txpacket, strlen(txpacket));

    // Actualizar display
    updateDisplay();
  }

  Radio.IrqProcess();
}

void updateDisplay() {
  st7735.st7735_fill_screen(ST7735_BLACK);  // Limpiar pantalla

  // Línea 1: Frecuencia
  char buffer[32];
  sprintf(buffer, "Frecuencia: %lu MHz", RF_FREQUENCY / 1000000);
  st7735.st7735_write_str(0, 0, buffer, Font_7x10, ST7735_WHITE, ST7735_BLACK);

  // Línea 2: Cantidad de paquetes
  sprintf(buffer, "Paquetes: %06lu", packetCount);
  st7735.st7735_write_str(0, 20, buffer, Font_7x10, ST7735_WHITE, ST7735_BLACK);

  // Línea 3: Tiempo transcurrido
  unsigned long elapsed = (millis() - startTime) / 1000;
  int horas = elapsed / 3600;
  int minutos = (elapsed % 3600) / 60;
  int segundos = elapsed % 60;
  sprintf(buffer, "Tiempo: %02d:%02d:%02d", horas, minutos, segundos);
  st7735.st7735_write_str(0, 40, buffer, Font_7x10, ST7735_WHITE, ST7735_BLACK);
}

void OnTxDone(void) {
  Serial.println("Paquete enviado.");
}

void OnTxTimeout(void) {
  Serial.println("Error de transmisión.");
}