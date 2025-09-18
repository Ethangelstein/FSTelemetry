#!/bin/bash

echo "🚀 Testing Debug Mode - Telemetry Gateway"
echo "=========================================="

# Set debug mode environment variables
export DEBUG_MODE=true
export DEBUG_INTERVAL=1000  # 1 second interval
export WS_PORT=8080
export ENABLE_STDOUT=true

echo "Configuration:"
echo "- Debug Mode: $DEBUG_MODE"
echo "- Debug Interval: ${DEBUG_INTERVAL}ms"
echo "- Socket.IO Port: $WS_PORT"
echo "- Stdout Output: $ENABLE_STDOUT"
echo ""

echo "Starting server in debug mode..."
echo "Open http://localhost:8080 in your browser to see the data"
echo "Press Ctrl+C to stop"
echo ""

# Run the gateway in debug mode
go run cmd/gateway/main.go
