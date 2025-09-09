package domain

type Telemetry struct {
	ID          string
	Timestamp   int64
	Latitude    float32
	Longitude   float32
	Altitude    float32
	RPM         int16
	AX, AY, AZ  int16
	VoltageMV   uint16
	CurrentMA   uint16
	RSSI        int16
	SNR         float32
	PacketCount uint32
}
