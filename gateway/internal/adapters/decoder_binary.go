package adapters

import (
	"encoding/binary"
	"fmt"

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
	want := binary.LittleEndian.Uint16(raw[protocol.FrameSize-2:])
	got := crc16IBM(raw[:protocol.FrameSize-2])
	if want != got {
		return domain.Telemetry{}, fmt.Errorf("crc")
	}

	t := domain.Telemetry{
		ID:          cString(raw[4:20]),
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
		PacketCount: binary.LittleEndian.Uint32(raw[54:56]),
	}
	return t, nil
}

func f32(b []byte) float32 {
	return float32(binary.LittleEndian.Uint32(b))
}

func i16(b []byte) int16 {
	return int16(binary.LittleEndian.Uint16(b))
}

func u16(b []byte) uint16 {
	return binary.LittleEndian.Uint16(b)
}

func cString(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

func crc16IBM(data []byte) uint16 {
	var crc uint16 = 0
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ 0xA001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}
