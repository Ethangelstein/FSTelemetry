package domain

import (
	"encoding/json"
	"time"
)

// MessageType represents the type of message being sent
type MessageType int

const (
	MessageTypeTelemetry MessageType = iota
	MessageTypeHeartbeat
	MessageTypeSubscribe
	MessageTypeUnsubscribe
	MessageTypeError
	MessageTypeConnection
	MessageTypeDisconnection
	MessageTypeStats
)

// String returns the string representation of MessageType
func (mt MessageType) String() string {
	switch mt {
	case MessageTypeTelemetry:
		return "telemetry"
	case MessageTypeHeartbeat:
		return "heartbeat"
	case MessageTypeSubscribe:
		return "subscribe"
	case MessageTypeUnsubscribe:
		return "unsubscribe"
	case MessageTypeError:
		return "error"
	case MessageTypeConnection:
		return "connection"
	case MessageTypeDisconnection:
		return "disconnection"
	case MessageTypeStats:
		return "stats"
	default:
		return "unknown"
	}
}

// Message represents a message to be sent to clients
type Message struct {
	ID        string      `json:"id"`
	Type      MessageType `json:"type"`
	Payload   []byte      `json:"payload"`
	Timestamp time.Time   `json:"timestamp"`
	ClientID  string      `json:"client_id,omitempty"` // empty for broadcast messages
}

// NewMessage creates a new message instance
func NewMessage(msgType MessageType, payload []byte, clientID string) Message {
	return Message{
		ID:        generateMessageID(),
		Type:      msgType,
		Payload:   payload,
		Timestamp: time.Now(),
		ClientID:  clientID,
	}
}

// NewTelemetryMessage creates a telemetry message from Telemetry data
func NewTelemetryMessage(telemetry Telemetry, clientID string) (Message, error) {
	payload, err := json.Marshal(telemetry)
	if err != nil {
		return Message{}, err
	}
	return NewMessage(MessageTypeTelemetry, payload, clientID), nil
}

// NewBroadcastTelemetryMessage creates a broadcast telemetry message
func NewBroadcastTelemetryMessage(telemetry Telemetry) (Message, error) {
	return NewTelemetryMessage(telemetry, "")
}

// ToJSON converts the message to JSON bytes
func (m Message) ToJSON() ([]byte, error) {
	return json.Marshal(m)
}

// generateMessageID generates a unique message ID
func generateMessageID() string {
	return time.Now().Format("20060102150405") + "-" + randomString(6)
}

// NewSocketIOMessage creates a message formatted for Socket.IO
func NewSocketIOMessage(event string, data interface{}, clientID string) (Message, error) {
	payload, err := json.Marshal(data)
	if err != nil {
		return Message{}, err
	}
	
	messageType := MessageTypeTelemetry
	switch event {
	case "telemetry":
		messageType = MessageTypeTelemetry
	case "connection":
		messageType = MessageTypeConnection
	case "disconnection":
		messageType = MessageTypeDisconnection
	case "stats":
		messageType = MessageTypeStats
	case "heartbeat":
		messageType = MessageTypeHeartbeat
	}
	
	return Message{
		ID:        generateMessageID(),
		Type:      messageType,
		Payload:   payload,
		Timestamp: time.Now(),
		ClientID:  clientID,
	}, nil
}

// GetSocketIOEvent returns the Socket.IO event name for this message
func (m Message) GetSocketIOEvent() string {
	return m.Type.String()
}

// GetSocketIOData returns the data payload for Socket.IO
func (m Message) GetSocketIOData() interface{} {
	var data interface{}
	json.Unmarshal(m.Payload, &data)
	return data
}

// randomString generates a random string of specified length
func randomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[time.Now().UnixNano()%int64(len(charset))]
	}
	return string(b)
}
