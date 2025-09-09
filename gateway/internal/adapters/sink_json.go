package adapters

import (
	"context"
	"encoding/json"
	"fmt"

	"gateway/internal/domain"
)

type JSONSink struct{}

func (JSONSink) Publish(ctx context.Context, t domain.Telemetry) error {
	b, _ := json.Marshal(t)
	fmt.Println(string(b))
	return nil
}
