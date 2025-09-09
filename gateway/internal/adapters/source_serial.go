package adapters

import (
	"context"
	"time"

	"go.bug.st/serial"
)

type SerialSource struct {
	PortName string
	Baud     int
	// framing
	FrameSize int
	Magic     [2]byte
}

func (s *SerialSource) Read(ctx context.Context) ([]byte, error) {
	port, err := serial.Open(s.PortName, &serial.Mode{BaudRate: s.Baud})
	if err != nil {
		return nil, err
	}
	defer port.Close()
	_ = port.SetReadTimeout(500 * time.Millisecond)

	buf := make([]byte, 0, 4*s.FrameSize)
	tmp := make([]byte, 256)

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		n, err := port.Read(tmp)
		if err != nil || n == 0 {
			continue
		}
		buf = append(buf, tmp[:n]...)

		// buscar magic y extraer frame completo
		for {
			i := findMagic(buf, s.Magic)
			if i < 0 {
				if len(buf) > 1 {
					buf = buf[len(buf)-1:]
				}
				break
			}
			if len(buf[i:]) < s.FrameSize {
				if i > 0 {
					buf = buf[i:]
				}
				break
			}
			frame := append([]byte(nil), buf[i:i+s.FrameSize]...)
			buf = buf[i+s.FrameSize:]
			return frame, nil
		}
	}
}

func findMagic(b []byte, m [2]byte) int {
	for i := 0; i+1 < len(b); i++ {
		if b[i] == m[0] && b[i+1] == m[1] {
			return i
		}
	}
	return -1
}
