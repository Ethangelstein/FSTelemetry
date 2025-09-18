package domain

import (
	"context"
	"time"
)

type FrameSource interface {
	Read(ctx context.Context) ([]byte, error)
}

type Decoder interface {
	Decode(raw []byte) (Telemetry, error)
}

type Sink interface {
	Publish(ctx context.Context, t Telemetry) error
}

// ClientManager manages connected clients
type ClientManager interface {
	AddClient(client Client) error
	RemoveClient(clientID string) error
	GetClient(clientID string) (Client, error)
	ListClients() []Client
	UpdateClientLastSeen(clientID string) error
	CleanupInactiveClients(timeout time.Duration) []string
}

// MessagePublisher handles message distribution to clients
type MessagePublisher interface {
	Publish(ctx context.Context, message Message) error
	Broadcast(ctx context.Context, message Message) error
	SendToClient(ctx context.Context, clientID string, message Message) error
	Subscribe(clientID string) error
	Unsubscribe(clientID string) error
}

// SocketServer represents a socket server implementation
type SocketServer interface {
	Start(ctx context.Context) error
	Stop() error
	GetClientManager() ClientManager
	GetMessagePublisher() MessagePublisher
}
