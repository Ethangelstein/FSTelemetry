package domain

import "time"

// Client represents a connected client to the socket server
type Client struct {
	ID          string    `json:"id"`
	Address     string    `json:"address"`
	ConnectedAt time.Time `json:"connected_at"`
	LastSeen    time.Time `json:"last_seen"`
	IsActive    bool      `json:"is_active"`
}

// NewClient creates a new client instance
func NewClient(id, address string) Client {
	now := time.Now()
	return Client{
		ID:          id,
		Address:     address,
		ConnectedAt: now,
		LastSeen:    now,
		IsActive:    true,
	}
}

// UpdateLastSeen updates the last seen timestamp
func (c *Client) UpdateLastSeen() {
	c.LastSeen = time.Now()
}

// IsConnected checks if the client is still considered connected
func (c *Client) IsConnected(timeout time.Duration) bool {
	return c.IsActive && time.Since(c.LastSeen) < timeout
}
