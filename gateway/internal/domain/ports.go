package domain

import "context"

type FrameSource interface {
	Read(ctx context.Context) ([]byte, error)
}

type Decoder interface {
	Decode(raw []byte) (Telemetry, error)
}

type Sink interface {
	Publish(ctx context.Context, t Telemetry) error
}
