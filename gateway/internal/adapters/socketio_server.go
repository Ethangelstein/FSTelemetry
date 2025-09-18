package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"gateway/internal/domain"

	socketio "github.com/googollee/go-socket.io"
)

// SocketIOServer implements domain.SocketServer using Socket.IO
type SocketIOServer struct {
	port        int
	clientMgr   domain.ClientManager
	publisher   domain.MessagePublisher
	server      *socketio.Server
	connections map[string]socketio.Conn
	mutex       sync.RWMutex
	httpServer  *http.Server
}

// NewSocketIOServer creates a new Socket.IO server
func NewSocketIOServer(port int, clientMgr domain.ClientManager, publisher domain.MessagePublisher) (*SocketIOServer, error) {
	server := socketio.NewServer(nil)

	s := &SocketIOServer{
		port:        port,
		clientMgr:   clientMgr,
		publisher:   publisher,
		server:      server,
		connections: make(map[string]socketio.Conn),
	}

	// Configure Socket.IO server
	s.setupSocketIOHandlers()

	return s, nil
}

// setupSocketIOHandlers configures Socket.IO event handlers
func (s *SocketIOServer) setupSocketIOHandlers() {
	s.server.OnConnect("/", func(conn socketio.Conn) error {
		clientID := s.generateClientID()
		clientAddr := conn.RemoteAddr().String()

		// Create client
		client := domain.NewClient(clientID, clientAddr)

		// Add client to manager
		if err := s.clientMgr.AddClient(client); err != nil {
			log.Printf("Failed to add client: %v", err)
			return err
		}

		// Store connection
		s.mutex.Lock()
		s.connections[clientID] = conn
		s.mutex.Unlock()

		// Set client ID in connection context
		conn.SetContext(map[string]interface{}{
			"clientID": clientID,
		})

		log.Printf("Client %s connected from %s", clientID, clientAddr)

		// Send welcome message
		welcomeData := map[string]interface{}{
			"message":   "Connected to telemetry server",
			"clientID":  clientID,
			"timestamp": time.Now().Unix(),
		}

		conn.Emit("connection", welcomeData)

		// Send current stats
		s.sendStatsToClient(conn)

		return nil
	})

	s.server.OnDisconnect("/", func(conn socketio.Conn, reason string) {
		ctx := conn.Context()
		if ctx == nil {
			return
		}

		clientID, ok := ctx.(map[string]interface{})["clientID"].(string)
		if !ok {
			return
		}

		// Remove connection
		s.mutex.Lock()
		delete(s.connections, clientID)
		s.mutex.Unlock()

		// Remove client from manager
		s.clientMgr.RemoveClient(clientID)

		log.Printf("Client %s disconnected: %s", clientID, reason)
	})

	// Handle custom events
	s.server.OnEvent("/", "ping", func(conn socketio.Conn, msg string) {
		conn.Emit("pong", map[string]interface{}{
			"message":   "pong",
			"timestamp": time.Now().Unix(),
		})
	})

	s.server.OnEvent("/", "get_stats", func(conn socketio.Conn, msg string) {
		s.sendStatsToClient(conn)
	})

	s.server.OnEvent("/", "subscribe_telemetry", func(conn socketio.Conn, msg string) {
		// Client subscribes to telemetry updates
		ctx := conn.Context()
		if ctx != nil {
			if clientID, ok := ctx.(map[string]interface{})["clientID"].(string); ok {
				if s.publisher != nil {
					s.publisher.Subscribe(clientID)
					conn.Emit("subscribed", map[string]interface{}{
						"message":   "Subscribed to telemetry updates",
						"timestamp": time.Now().Unix(),
					})
				} else {
					conn.Emit("error", map[string]interface{}{
						"message":   "Publisher not available",
						"timestamp": time.Now().Unix(),
					})
				}
			}
		}
	})

	s.server.OnEvent("/", "unsubscribe_telemetry", func(conn socketio.Conn, msg string) {
		// Client unsubscribes from telemetry updates
		ctx := conn.Context()
		if ctx != nil {
			if clientID, ok := ctx.(map[string]interface{})["clientID"].(string); ok {
				if s.publisher != nil {
					s.publisher.Unsubscribe(clientID)
					conn.Emit("unsubscribed", map[string]interface{}{
						"message":   "Unsubscribed from telemetry updates",
						"timestamp": time.Now().Unix(),
					})
				} else {
					conn.Emit("error", map[string]interface{}{
						"message":   "Publisher not available",
						"timestamp": time.Now().Unix(),
					})
				}
			}
		}
	})

	// Handle errors
	s.server.OnError("/", func(conn socketio.Conn, err error) {
		log.Printf("Socket.IO error: %v", err)
	})
}

// Start starts the Socket.IO server
func (s *SocketIOServer) Start(ctx context.Context) error {
	// Setup HTTP server
	mux := http.NewServeMux()
	mux.Handle("/socket.io/", s.server)
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/", s.handleRoot)

	s.httpServer = &http.Server{
		Addr:    fmt.Sprintf(":%d", s.port),
		Handler: mux,
	}

	// Start cleanup goroutine
	go s.cleanupInactiveClients(ctx)

	// Start stats broadcasting goroutine
	go s.broadcastStats(ctx)

	log.Printf("Starting Socket.IO server on port %d", s.port)

	// Start Socket.IO server loop (CRITICAL: this was missing!)
	go func() {
		if err := s.server.Serve(); err != nil {
			log.Printf("socketio Serve error: %v", err)
		}
	}()

	// Start HTTP server in a goroutine
	go func() {
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("Socket.IO server error: %v", err)
		}
	}()

	return nil
}

// Stop stops the Socket.IO server
func (s *SocketIOServer) Stop() error {
	if s.httpServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = s.httpServer.Shutdown(ctx)
	}
	s.server.Close() // <- importante: cerrar el servidor Socket.IO
	return nil
}

// GetClientManager returns the client manager
func (s *SocketIOServer) GetClientManager() domain.ClientManager {
	return s.clientMgr
}

// GetMessagePublisher returns the message publisher
func (s *SocketIOServer) GetMessagePublisher() domain.MessagePublisher {
	return s.publisher
}

// SetPublisher sets the message publisher
func (s *SocketIOServer) SetPublisher(publisher domain.MessagePublisher) {
	s.publisher = publisher
}

// SendToClient sends a message to a specific client
func (s *SocketIOServer) SendToClient(clientID string, event string, data interface{}) error {
	s.mutex.RLock()
	conn, exists := s.connections[clientID]
	s.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("client %s not connected", clientID)
	}

	conn.Emit(event, data)
	return nil
}

// BroadcastToAll sends a message to all connected clients
func (s *SocketIOServer) BroadcastToAll(event string, data interface{}) {
	s.mutex.RLock()
	connections := make(map[string]socketio.Conn)
	for id, conn := range s.connections {
		connections[id] = conn
	}
	s.mutex.RUnlock()

	for clientID := range connections {
		if err := s.SendToClient(clientID, event, data); err != nil {
			log.Printf("Failed to send message to client %s: %v", clientID, err)
			// Remove failed connection
			s.mutex.Lock()
			delete(s.connections, clientID)
			s.mutex.Unlock()
		}
	}
}

// handleHealth handles health check requests
func (s *SocketIOServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	clients := s.clientMgr.ListClients()
	activeClients := 0
	for _, client := range clients {
		if client.IsActive {
			activeClients++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"status":         "healthy",
		"active_clients": activeClients,
		"total_clients":  len(clients),
		"server_type":    "socket.io",
		"timestamp":      time.Now().Unix(),
	}

	json.NewEncoder(w).Encode(response)
}

// handleRoot handles root requests
func (s *SocketIOServer) handleRoot(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	fmt.Fprintf(w, `
<!DOCTYPE html>
<html>
<head>
    <title>Telemetry Server</title>
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
</head>
<body>
    <h1>Telemetry Server - Socket.IO</h1>
    <p>Connect to: <code>ws://localhost:%d/socket.io/</code></p>
    <div id="status">Connecting...</div>
    <div id="messages"></div>
    
    <script>
        const socket = io('http://localhost:%d');
        
        socket.on('connect', () => {
            document.getElementById('status').textContent = 'Connected';
            socket.emit('subscribe_telemetry');
        });
        
        socket.on('telemetry', (data) => {
            const messages = document.getElementById('messages');
            const div = document.createElement('div');
            div.textContent = JSON.stringify(data, null, 2);
            messages.appendChild(div);
        });
        
        socket.on('disconnect', () => {
            document.getElementById('status').textContent = 'Disconnected';
        });
    </script>
</body>
</html>`, s.port, s.port)
}

// sendStatsToClient sends current stats to a specific client
func (s *SocketIOServer) sendStatsToClient(conn socketio.Conn) {
	clients := s.clientMgr.ListClients()
	activeClients := 0
	for _, client := range clients {
		if client.IsActive {
			activeClients++
		}
	}

	stats := map[string]interface{}{
		"active_clients": activeClients,
		"total_clients":  len(clients),
		"timestamp":      time.Now().Unix(),
	}

	conn.Emit("stats", stats)
}

// broadcastStats periodically broadcasts stats to all clients
func (s *SocketIOServer) broadcastStats(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			clients := s.clientMgr.ListClients()
			activeClients := 0
			for _, client := range clients {
				if client.IsActive {
					activeClients++
				}
			}

			stats := map[string]interface{}{
				"active_clients": activeClients,
				"total_clients":  len(clients),
				"timestamp":      time.Now().Unix(),
			}

			s.BroadcastToAll("stats", stats)
		}
	}
}

// cleanupInactiveClients periodically cleans up inactive clients
func (s *SocketIOServer) cleanupInactiveClients(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			inactiveClients := s.clientMgr.CleanupInactiveClients(120 * time.Second)
			for _, clientID := range inactiveClients {
				s.mutex.Lock()
				if conn, exists := s.connections[clientID]; exists {
					conn.Close()
					delete(s.connections, clientID)
					log.Printf("Cleaned up inactive client %s", clientID)
				}
				s.mutex.Unlock()
			}
		}
	}
}

// generateClientID generates a unique client ID
func (s *SocketIOServer) generateClientID() string {
	return fmt.Sprintf("client_%d", time.Now().UnixNano())
}
