package domain

import "context"

type IngestTelemetry struct {
	Src FrameSource
	Dec Decoder
	Out Sink
}

func (uc IngestTelemetry) Run(ctx context.Context) error {
	for {
		raw, err := uc.Src.Read(ctx)
		if err != nil {
			return err
		}
		t, err := uc.Dec.Decode(raw)
		if err != nil {
			continue
		}
		if err := uc.Out.Publish(ctx, t); err != nil {
			return err
		}
	}
}
