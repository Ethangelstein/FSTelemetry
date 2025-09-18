package domain

import (
	"context"
	"fmt"
	"log"
)

// DistributeTelemetry handles the distribution of telemetry data to connected clients
type DistributeTelemetry struct {
	ClientMgr ClientManager
	Publisher MessagePublisher
}

// NewDistributeTelemetry creates a new DistributeTelemetry use case
func NewDistributeTelemetry(clientMgr ClientManager, publisher MessagePublisher) *DistributeTelemetry {
	return &DistributeTelemetry{
		ClientMgr: clientMgr,
		Publisher: publisher,
	}
}

// Execute distributes telemetry data to all connected clients
func (uc *DistributeTelemetry) Execute(ctx context.Context, telemetry Telemetry) error {
	// Create a Socket.IO message from telemetry data
	message, err := NewSocketIOMessage("telemetry", telemetry, "")
	if err != nil {
		return fmt.Errorf("failed to create telemetry message: %w", err)
	}

	// Broadcast the message to all connected clients
	if err := uc.Publisher.Broadcast(ctx, message); err != nil {
		return fmt.Errorf("failed to broadcast telemetry: %w", err)
	}

	// Log distribution info
	clients := uc.ClientMgr.ListClients()
	activeClients := 0
	for _, client := range clients {
		if client.IsActive {
			activeClients++
		}
	}

	log.Printf("Distributed telemetry to %d active clients (ID: %s, Packet: %d)", 
		activeClients, telemetry.ID, telemetry.PacketCount)

	return nil
}

// SendToSpecificClient sends telemetry data to a specific client
func (uc *DistributeTelemetry) SendToSpecificClient(ctx context.Context, clientID string, telemetry Telemetry) error {
	// Create a Socket.IO message from telemetry data
	message, err := NewSocketIOMessage("telemetry", telemetry, clientID)
	if err != nil {
		return fmt.Errorf("failed to create telemetry message: %w", err)
	}

	// Send the message to the specific client
	if err := uc.Publisher.SendToClient(ctx, clientID, message); err != nil {
		return fmt.Errorf("failed to send telemetry to client %s: %w", clientID, err)
	}

	log.Printf("Sent telemetry to client %s (ID: %s, Packet: %d)", 
		clientID, telemetry.ID, telemetry.PacketCount)

	return nil
}

// GetClientStats returns statistics about connected clients
func (uc *DistributeTelemetry) GetClientStats() ClientStats {
	clients := uc.ClientMgr.ListClients()

	stats := ClientStats{
		TotalClients:    len(clients),
		ActiveClients:   0,
		InactiveClients: 0,
	}

	for _, client := range clients {
		if client.IsActive {
			stats.ActiveClients++
		} else {
			stats.InactiveClients++
		}
	}

	return stats
}

// ClientStats represents statistics about connected clients
type ClientStats struct {
	TotalClients    int `json:"total_clients"`
	ActiveClients   int `json:"active_clients"`
	InactiveClients int `json:"inactive_clients"`
}
