package adapters

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"math/rand"
	"time"

	"gateway/internal/domain"
	"gateway/pkg/protocol"
)

// FakeSource implements domain.FrameSource with fake telemetry data
type FakeSource struct {
	FrameSize int
	Magic     [2]byte
	Interval  time.Duration
	// Configuration for fake data generation
	BaseLatitude  float32
	BaseLongitude float32
	BaseAltitude  float32
	VehicleID     string
	// Internal state
	packetCount uint32
	startTime   time.Time
}

// NewFakeSource creates a new fake data source
func NewFakeSource(interval time.Duration) *FakeSource {
	return &FakeSource{
		FrameSize:     protocol.FrameSize,
		Magic:         [2]byte{protocol.Magic0, protocol.Magic1},
		Interval:      interval,
		BaseLatitude:  -34.603722, // Buenos Aires
		BaseLongitude: -58.381592,
		BaseAltitude:  25.0,
		VehicleID:     "DEBUG-VEHICLE-001",
		packetCount:   0,
		startTime:     time.Now(),
	}
}

// Read generates fake telemetry data at regular intervals
func (f *FakeSource) Read(ctx context.Context) ([]byte, error) {
	// Wait for the interval or context cancellation
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(f.Interval):
		// Generate fake data
	}

	f.packetCount++

	// Generate fake telemetry data
	telemetry := f.generateFakeTelemetry()

	// Convert to binary frame
	frame, err := f.telemetryToFrame(telemetry)
	if err != nil {
		return nil, fmt.Errorf("failed to convert telemetry to frame: %w", err)
	}

	return frame, nil
}

// generateFakeTelemetry creates realistic fake telemetry data
func (f *FakeSource) generateFakeTelemetry() domain.Telemetry {
	now := time.Now()
	elapsed := now.Sub(f.startTime)

	// Generate realistic variations
	latVariation := (rand.Float32() - 0.5) * 0.01  // ±0.005 degrees (~500m)
	lonVariation := (rand.Float32() - 0.5) * 0.01
	altVariation := (rand.Float32() - 0.5) * 10.0  // ±5m

	// Simulate vehicle movement patterns
	timeFactor := elapsed.Seconds() / 60.0 // minutes elapsed
	sinWave := float32(math.Sin(timeFactor * 0.1))  // slow oscillation
	cosWave := float32(math.Cos(timeFactor * 0.15)) // different frequency

	// GPS coordinates with realistic movement
	latitude := f.BaseLatitude + latVariation + sinWave*0.001
	longitude := f.BaseLongitude + lonVariation + cosWave*0.001
	altitude := f.BaseAltitude + altVariation + sinWave*2.0

	// RPM simulation (idle to high revs)
	baseRPM := int16(800 + int(sinWave*2000)) // 800-2800 RPM
	rpm := baseRPM + int16(rand.Intn(500)-250) // add noise

	// Accelerometer simulation (realistic vehicle dynamics)
	ax := int16(rand.Intn(400) - 200)  // -200 to +200 mg
	ay := int16(rand.Intn(400) - 200)
	az := int16(1000 + rand.Intn(200) - 100) // ~1g with noise

	// Electrical simulation
	voltage := uint16(11500 + rand.Intn(2000)) // 11.5V to 13.5V
	current := uint16(100 + rand.Intn(2900))   // 100mA to 3A

	// Radio quality simulation
	rssi := int16(-120 + rand.Intn(60)) // -120 to -60 dBm
	snr := float32(rand.Float64()*20 - 10) // -10 to +10 dB

	return domain.Telemetry{
		ID:          f.VehicleID,
		Version:     1,
		Reserved:    0,
		Timestamp:   now.Unix(),
		Latitude:    latitude,
		Longitude:   longitude,
		Altitude:    altitude,
		RPM:         rpm,
		AX:          ax,
		AY:          ay,
		AZ:          az,
		VoltageMV:   voltage,
		CurrentMA:   current,
		RSSI:        rssi,
		SNR:         snr,
		PacketCount: f.packetCount,
	}
}

// telemetryToFrame converts telemetry data to binary frame format
func (f *FakeSource) telemetryToFrame(t domain.Telemetry) ([]byte, error) {
	frame := make([]byte, f.FrameSize)

	// Magic bytes
	frame[0] = f.Magic[0]
	frame[1] = f.Magic[1]

	// Version and reserved
	frame[2] = t.Version
	frame[3] = t.Reserved

	// Vehicle ID (16 bytes, null-terminated)
	idBytes := []byte(t.ID)
	copy(frame[4:20], idBytes)
	// Ensure null termination
	if len(idBytes) < 16 {
		frame[4+len(idBytes)] = 0
	}

	// Timestamp (4 bytes, little-endian)
	binary.LittleEndian.PutUint32(frame[20:24], uint32(t.Timestamp))

	// GPS coordinates (4 bytes each, little-endian)
	binary.LittleEndian.PutUint32(frame[24:28], math.Float32bits(t.Latitude))
	binary.LittleEndian.PutUint32(frame[28:32], math.Float32bits(t.Longitude))
	binary.LittleEndian.PutUint32(frame[32:36], math.Float32bits(t.Altitude))

	// RPM and accelerometer (2 bytes each, little-endian)
	binary.LittleEndian.PutUint16(frame[36:38], uint16(t.RPM))
	binary.LittleEndian.PutUint16(frame[38:40], uint16(t.AX))
	binary.LittleEndian.PutUint16(frame[40:42], uint16(t.AY))
	binary.LittleEndian.PutUint16(frame[42:44], uint16(t.AZ))

	// Electrical (2 bytes each, little-endian)
	binary.LittleEndian.PutUint16(frame[44:46], t.VoltageMV)
	binary.LittleEndian.PutUint16(frame[46:48], t.CurrentMA)

	// Radio quality
	binary.LittleEndian.PutUint16(frame[48:50], uint16(t.RSSI))
	binary.LittleEndian.PutUint32(frame[50:54], math.Float32bits(t.SNR))

	// Packet count (4 bytes, little-endian)
	binary.LittleEndian.PutUint32(frame[54:58], t.PacketCount)

	// Calculate CRC-16/MODBUS for the frame (excluding CRC field)
	crc := f.crc16Modbus(frame[:f.FrameSize-2])
	binary.LittleEndian.PutUint16(frame[f.FrameSize-2:], crc)

	return frame, nil
}

// crc16Modbus calculates CRC-16/MODBUS checksum
func (f *FakeSource) crc16Modbus(data []byte) uint16 {
	var crc uint16 = 0xFFFF
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			if (crc & 1) != 0 {
				crc = (crc >> 1) ^ 0xA001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}

// SetVehicleID sets the vehicle ID for fake data
func (f *FakeSource) SetVehicleID(id string) {
	f.VehicleID = id
}

// SetBaseLocation sets the base GPS coordinates for fake data
func (f *FakeSource) SetBaseLocation(lat, lon, alt float32) {
	f.BaseLatitude = lat
	f.BaseLongitude = lon
	f.BaseAltitude = alt
}

// GetStats returns statistics about the fake data generation
func (f *FakeSource) GetStats() map[string]interface{} {
	elapsed := time.Since(f.startTime)
	return map[string]interface{}{
		"packets_generated": f.packetCount,
		"elapsed_time":      elapsed.String(),
		"packets_per_second": float64(f.packetCount) / elapsed.Seconds(),
		"vehicle_id":        f.VehicleID,
		"base_location": map[string]float32{
			"latitude":  f.BaseLatitude,
			"longitude": f.BaseLongitude,
			"altitude":  f.BaseAltitude,
		},
	}
}
