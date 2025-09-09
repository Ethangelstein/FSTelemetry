package main

import (
	"context"
	"log"
	"os"

	"gateway/internal/adapters"
	"gateway/internal/domain"
	"gateway/pkg/protocol"
)

func env(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func main() {
	src := &adapters.SerialSource{
		PortName:  env("PORT", "/dev/ttyACM0"),
		Baud:      115200,
		FrameSize: protocol.FrameSize,
		Magic:     [2]byte{protocol.Magic0, protocol.Magic1},
	}
	dec := adapters.BinaryDecoder{}
	out := adapters.StdoutSink{} // o adapters.JSONSink{}

	uc := domain.IngestTelemetry{Src: src, Dec: dec, Out: out}
	if err := uc.Run(context.Background()); err != nil {
		log.Fatal(err)
	}
}
