package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

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

func envInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func main() {
	// Configuration
	portName := env("PORT", "/dev/ttyACM0")
	baudRate := envInt("BAUD", 115200)
	websocketPort := envInt("WS_PORT", 8080)
	enableStdout := env("ENABLE_STDOUT", "true") == "true"
	debugMode := env("DEBUG_MODE", "false") == "true"
	debugInterval := envInt("DEBUG_INTERVAL", 2000) // milliseconds

	log.Printf("Starting Telemetry Gateway Server")
	log.Printf("Debug Mode: %v", debugMode)
	if debugMode {
		log.Printf("Debug Interval: %dms", debugInterval)
	} else {
		log.Printf("Serial Port: %s (Baud: %d)", portName, baudRate)
	}
	log.Printf("Socket.IO Port: %d", websocketPort)
	log.Printf("Stdout Output: %v", enableStdout)

	// Create context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Setup signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigChan
		log.Println("Received shutdown signal, stopping server...")
		cancel()
	}()

	// Create data source (Serial or Fake based on debug mode)
	var src domain.FrameSource
	if debugMode {
		log.Println("Using FAKE data source for debugging")
		fakeSrc := adapters.NewFakeSource(time.Duration(debugInterval) * time.Millisecond)
		// Configure fake data
		fakeSrc.SetVehicleID("DEBUG-VEHICLE-001")
		fakeSrc.SetBaseLocation(-34.603722, -58.381592, 25.0) // Buenos Aires
		src = fakeSrc
	} else {
		log.Println("Using SERIAL data source")
		src = &adapters.SerialSource{
			PortName:  portName,
			Baud:      baudRate,
			FrameSize: protocol.FrameSize,
			Magic:     [2]byte{protocol.Magic0, protocol.Magic1},
		}
	}

	// Create decoder
	dec := adapters.BinaryDecoder{}

	// Create client manager
	clientMgr := adapters.NewMemoryClientManager()

	// Create Socket.IO server
	socketIOServer, err := adapters.NewSocketIOServer(websocketPort, clientMgr, nil)
	if err != nil {
		log.Fatalf("Failed to create Socket.IO server: %v", err)
	}

	// Create message publisher with Socket.IO server
	publisher := adapters.NewMessagePublisher(clientMgr, socketIOServer)

	// Set the publisher in the Socket.IO server (CRITICAL: this was missing!)
	socketIOServer.SetPublisher(publisher)

	// Create distributor use case
	distributor := domain.NewDistributeTelemetry(clientMgr, publisher)

	// Create socket sink
	socketSink := adapters.NewSocketSink(distributor, socketIOServer)

	// Start Socket.IO server
	if err := socketSink.Start(ctx); err != nil {
		log.Fatalf("Failed to start Socket.IO server: %v", err)
	}

	// Create output sink (can be stdout, socket, or both)
	var outputSink domain.Sink
	if enableStdout {
		// Create a multi-sink that outputs to both stdout and socket
		outputSink = &MultiSink{
			sinks: []domain.Sink{
				adapters.StdoutSink{},
				socketSink,
			},
		}
	} else {
		outputSink = socketSink
	}

	// Create main use case
	uc := domain.IngestTelemetry{
		Src: src,
		Dec: dec,
		Out: outputSink,
	}

	// Start periodic stats logging
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				socketSink.LogConnectionStats()
				// If in debug mode, also log fake data stats
				if debugMode {
					if fakeSrc, ok := src.(*adapters.FakeSource); ok {
						stats := fakeSrc.GetStats()
						log.Printf("Debug Stats - Packets: %.0f, Rate: %.2f pps, Vehicle: %s",
							stats["packets_generated"], stats["packets_per_second"], stats["vehicle_id"])
					}
				}
			}
		}
	}()

	// Run the main telemetry ingestion loop
	log.Println("Starting telemetry ingestion...")
	if err := uc.Run(ctx); err != nil {
		log.Printf("Telemetry ingestion error: %v", err)
	}

	// Graceful shutdown
	log.Println("Shutting down server...")
	if err := socketSink.Stop(); err != nil {
		log.Printf("Error stopping socket server: %v", err)
	}

	log.Println("Server stopped")
}

// MultiSink allows sending data to multiple sinks
type MultiSink struct {
	sinks []domain.Sink
}

func (m *MultiSink) Publish(ctx context.Context, t domain.Telemetry) error {
	for _, sink := range m.sinks {
		if err := sink.Publish(ctx, t); err != nil {
			log.Printf("Error publishing to sink: %v", err)
			// Continue with other sinks even if one fails
		}
	}
	return nil
}
