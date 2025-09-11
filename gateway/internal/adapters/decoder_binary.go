package adapters

import (
	"encoding/binary"
	"fmt"
	"math"

	"gateway/internal/domain"
	"gateway/pkg/protocol"
)

type BinaryDecoder struct{}

func (BinaryDecoder) Decode(raw []byte) (domain.Telemetry, error) {
	if len(raw) != protocol.FrameSize {
		return domain.Telemetry{}, fmt.Errorf("len=%d", len(raw))
	}
	if raw[0] != protocol.Magic0 || raw[1] != protocol.Magic1 {
		return domain.Telemetry{}, fmt.Errorf("magic")
	}

	// CRC-16/MODBUS: poly 0xA001, init 0xFFFF, LE
	calc := crc16Modbus(raw[:protocol.FrameSize-2])
	got := binary.LittleEndian.Uint16(raw[protocol.FrameSize-2:])
	if calc != got {
		return domain.Telemetry{}, fmt.Errorf("crc got=0x%04X want=0x%04X", got, calc)
	}

	t := domain.Telemetry{
		ID:          cString(raw[4:20]),
		Version:     raw[2],
		Reserved:    raw[3],
		Timestamp:   int64(binary.LittleEndian.Uint32(raw[20:24])),
		Latitude:    f32(raw[24:28]),
		Longitude:   f32(raw[28:32]),
		Altitude:    f32(raw[32:36]),
		RPM:         i16(raw[36:38]),
		AX:          i16(raw[38:40]),
		AY:          i16(raw[40:42]),
		AZ:          i16(raw[42:44]),
		VoltageMV:   u16(raw[44:46]),
		CurrentMA:   u16(raw[46:48]),
		RSSI:        i16(raw[48:50]),
		SNR:         f32(raw[50:54]),
		PacketCount: binary.LittleEndian.Uint32(raw[54:58]),
	}
	return t, nil
}

func f32(b []byte) float32 {
	// ¡Importante!: reinterpretar bits, NO castear número
	return math.Float32frombits(binary.LittleEndian.Uint32(b))
}

func i16(b []byte) int16  { return int16(binary.LittleEndian.Uint16(b)) }
func u16(b []byte) uint16 { return binary.LittleEndian.Uint16(b) }

func cString(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

// CRC-16/MODBUS (reflected), init 0xFFFF
func crc16Modbus(data []byte) uint16 {
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
