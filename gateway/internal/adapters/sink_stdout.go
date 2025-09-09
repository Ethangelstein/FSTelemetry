package adapters

import (
	"context"
	"fmt"
	"time"

	"gateway/internal/domain"
)

type StdoutSink struct{}

func (StdoutSink) Publish(ctx context.Context, t domain.Telemetry) error {
	ts := time.Unix(t.Timestamp, 0).Format(time.RFC3339)
	fmt.Printf("ID=%s t=%s lat=%.6f lon=%.6f alt=%.1fm rpm=%d acc=[%d,%d,%d] V=%dmV I=%dmA RSSI=%d SNR=%.1f cnt=%d\n",
		t.ID, ts, t.Latitude, t.Longitude, t.Altitude, t.RPM, t.AX, t.AY, t.AZ, t.VoltageMV, t.CurrentMA, t.RSSI, t.SNR, t.PacketCount)
	return nil
}
