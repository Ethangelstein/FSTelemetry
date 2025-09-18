package adapters

import (
	"context"
	"fmt"
	"log"

	"gateway/internal/domain"
)

// MessagePublisher implements domain.MessagePublisher
type MessagePublisher struct {
	clientMgr domain.ClientManager
	server    *SocketIOServer
	// Channel for broadcasting messages
	broadcastChan chan domain.Message
	// Channel for targeted messages
	targetedChan chan TargetedMessage
}

// TargetedMessage represents a message targeted to a specific client
type TargetedMessage struct {
	ClientID string
	Message  domain.Message
}

// NewMessagePublisher creates a new message publisher
func NewMessagePublisher(clientMgr domain.ClientManager, server *SocketIOServer) *MessagePublisher {
	publisher := &MessagePublisher{
		clientMgr:     clientMgr,
		server:        server,
		broadcastChan: make(chan domain.Message, 1000),
		targetedChan:  make(chan TargetedMessage, 1000),
	}

	// Start the message processing goroutine
	go publisher.processMessages()

	return publisher
}

// Publish publishes a message (broadcast by default)
func (p *MessagePublisher) Publish(ctx context.Context, message domain.Message) error {
	select {
	case p.broadcastChan <- message:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	default:
		return fmt.Errorf("broadcast channel is full")
	}
}

// Broadcast broadcasts a message to all active clients
func (p *MessagePublisher) Broadcast(ctx context.Context, message domain.Message) error {
	return p.Publish(ctx, message)
}

// SendToClient sends a message to a specific client
func (p *MessagePublisher) SendToClient(ctx context.Context, clientID string, message domain.Message) error {
	targetedMsg := TargetedMessage{
		ClientID: clientID,
		Message:  message,
	}

	select {
	case p.targetedChan <- targetedMsg:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	default:
		return fmt.Errorf("targeted message channel is full")
	}
}

// Subscribe adds a client to receive messages (placeholder for future implementation)
func (p *MessagePublisher) Subscribe(clientID string) error {
	// For now, all connected clients automatically receive broadcasts
	// This could be extended to support topic-based subscriptions
	return nil
}

// Unsubscribe removes a client from receiving messages (placeholder for future implementation)
func (p *MessagePublisher) Unsubscribe(clientID string) error {
	// For now, clients are removed when they disconnect
	// This could be extended to support topic-based unsubscriptions
	return nil
}

// processMessages processes incoming messages and distributes them
func (p *MessagePublisher) processMessages() {
	for {
		select {
		case message := <-p.broadcastChan:
			p.handleBroadcast(message)
		case targetedMsg := <-p.targetedChan:
			p.handleTargetedMessage(targetedMsg)
		}
	}
}

// handleBroadcast handles broadcast messages
func (p *MessagePublisher) handleBroadcast(message domain.Message) {
	if p.server != nil {
		// Use Socket.IO server to broadcast
		event := message.GetSocketIOEvent()
		data := message.GetSocketIOData()
		p.server.BroadcastToAll(event, data)
		log.Printf("Broadcasted Socket.IO message %s to all clients", message.ID)
	} else {
		// Fallback to logging
		clients := p.clientMgr.ListClients()
		activeClients := 0

		for _, client := range clients {
			if client.IsActive {
				log.Printf("Broadcasting message %s to client %s", message.ID, client.ID)
				activeClients++
			}
		}

		log.Printf("Broadcasted message %s to %d active clients", message.ID, activeClients)
	}
}

// handleTargetedMessage handles messages targeted to specific clients
func (p *MessagePublisher) handleTargetedMessage(targetedMsg TargetedMessage) {
	client, err := p.clientMgr.GetClient(targetedMsg.ClientID)
	if err != nil {
		log.Printf("Failed to send message to client %s: %v", targetedMsg.ClientID, err)
		return
	}

	if !client.IsActive {
		log.Printf("Client %s is not active, dropping message", targetedMsg.ClientID)
		return
	}

	if p.server != nil {
		// Use Socket.IO server to send targeted message
		event := targetedMsg.Message.GetSocketIOEvent()
		data := targetedMsg.Message.GetSocketIOData()
		if err := p.server.SendToClient(targetedMsg.ClientID, event, data); err != nil {
			log.Printf("Failed to send Socket.IO message to client %s: %v", targetedMsg.ClientID, err)
		} else {
			log.Printf("Sent Socket.IO message %s to client %s", targetedMsg.Message.ID, targetedMsg.ClientID)
		}
	} else {
		// Fallback to logging
		log.Printf("Sending message %s to client %s", targetedMsg.Message.ID, targetedMsg.ClientID)
	}
}
