package adapters

import (
	"fmt"
	"sync"
	"time"

	"gateway/internal/domain"
)

// MemoryClientManager implements ClientManager using in-memory storage
type MemoryClientManager struct {
	clients map[string]domain.Client
	mutex   sync.RWMutex
}

// NewMemoryClientManager creates a new in-memory client manager
func NewMemoryClientManager() *MemoryClientManager {
	return &MemoryClientManager{
		clients: make(map[string]domain.Client),
	}
}

// AddClient adds a new client to the manager
func (m *MemoryClientManager) AddClient(client domain.Client) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	if client.ID == "" {
		return fmt.Errorf("client ID cannot be empty")
	}

	m.clients[client.ID] = client
	return nil
}

// RemoveClient removes a client from the manager
func (m *MemoryClientManager) RemoveClient(clientID string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	if _, exists := m.clients[clientID]; !exists {
		return fmt.Errorf("client %s not found", clientID)
	}

	delete(m.clients, clientID)
	return nil
}

// GetClient retrieves a client by ID
func (m *MemoryClientManager) GetClient(clientID string) (domain.Client, error) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	client, exists := m.clients[clientID]
	if !exists {
		return domain.Client{}, fmt.Errorf("client %s not found", clientID)
	}

	return client, nil
}

// ListClients returns all clients
func (m *MemoryClientManager) ListClients() []domain.Client {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	clients := make([]domain.Client, 0, len(m.clients))
	for _, client := range m.clients {
		clients = append(clients, client)
	}

	return clients
}

// UpdateClientLastSeen updates the last seen timestamp for a client
func (m *MemoryClientManager) UpdateClientLastSeen(clientID string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	client, exists := m.clients[clientID]
	if !exists {
		return fmt.Errorf("client %s not found", clientID)
	}

	client.UpdateLastSeen()
	m.clients[clientID] = client
	return nil
}

// CleanupInactiveClients removes clients that haven't been seen for the specified timeout
func (m *MemoryClientManager) CleanupInactiveClients(timeout time.Duration) []string {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	var removedClients []string

	for id, client := range m.clients {
		if !client.IsConnected(timeout) {
			client.IsActive = false
			m.clients[id] = client
			removedClients = append(removedClients, id)
		}
	}

	return removedClients
}

// GetActiveClients returns only active clients
func (m *MemoryClientManager) GetActiveClients() []domain.Client {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	var activeClients []domain.Client
	for _, client := range m.clients {
		if client.IsActive {
			activeClients = append(activeClients, client)
		}
	}

	return activeClients
}

// GetClientCount returns the total number of clients
func (m *MemoryClientManager) GetClientCount() int {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	return len(m.clients)
}
