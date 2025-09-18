package adapters

import (
	"context"
	"log"

	"gateway/internal/domain"
)

// SocketSink implements domain.Sink for socket distribution
type SocketSink struct {
	distributor *domain.DistributeTelemetry
	server      domain.SocketServer
}

// NewSocketSink creates a new socket sink
func NewSocketSink(distributor *domain.DistributeTelemetry, server domain.SocketServer) *SocketSink {
	return &SocketSink{
		distributor: distributor,
		server:      server,
	}
}

// Publish publishes telemetry data to connected clients
func (s *SocketSink) Publish(ctx context.Context, telemetry domain.Telemetry) error {
	// Use the distributor to handle the telemetry distribution
	return s.distributor.Execute(ctx, telemetry)
}

// Start starts the socket server
func (s *SocketSink) Start(ctx context.Context) error {
	return s.server.Start(ctx)
}

// Stop stops the socket server
func (s *SocketSink) Stop() error {
	return s.server.Stop()
}

// GetClientStats returns statistics about connected clients
func (s *SocketSink) GetClientStats() domain.ClientStats {
	return s.distributor.GetClientStats()
}

// SendToClient sends telemetry to a specific client
func (s *SocketSink) SendToClient(ctx context.Context, clientID string, telemetry domain.Telemetry) error {
	return s.distributor.SendToSpecificClient(ctx, clientID, telemetry)
}

// BroadcastToAll sends telemetry to all connected clients
func (s *SocketSink) BroadcastToAll(ctx context.Context, telemetry domain.Telemetry) error {
	return s.distributor.Execute(ctx, telemetry)
}

// GetActiveClients returns the list of active clients
func (s *SocketSink) GetActiveClients() []domain.Client {
	return s.server.GetClientManager().ListClients()
}

// IsClientConnected checks if a specific client is connected
func (s *SocketSink) IsClientConnected(clientID string) bool {
	_, err := s.server.GetClientManager().GetClient(clientID)
	return err == nil
}

// LogConnectionStats logs current connection statistics
func (s *SocketSink) LogConnectionStats() {
	stats := s.GetClientStats()
	log.Printf("Socket Server Stats - Total: %d, Active: %d, Inactive: %d",
		stats.TotalClients, stats.ActiveClients, stats.InactiveClients)
}
