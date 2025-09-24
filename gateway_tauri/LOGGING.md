# Logging Configuration

This Tauri application now includes comprehensive logging to help you understand what's happening during execution.

## Log Levels

The application uses the following log levels:

- **ERROR**: Critical errors that prevent operation
- **WARN**: Warning messages for potential issues
- **INFO**: General information about application flow
- **DEBUG**: Detailed debugging information

## Environment Variables

You can control the logging level using the `RUST_LOG` environment variable:

### Examples:

```bash
# Show all logs (most verbose)
RUST_LOG=debug cargo tauri dev

# Show info and above (recommended for normal use)
RUST_LOG=info cargo tauri dev

# Show only warnings and errors
RUST_LOG=warn cargo tauri dev

# Show only errors
RUST_LOG=error cargo tauri dev
```

## What Gets Logged

### Application Startup

- Application initialization
- Serial port discovery
- Configuration parameters

### Serial Communication

- Port opening/closing
- Data reading/writing
- Frame detection and parsing
- CRC validation
- Error conditions

### Telemetry Processing

- Frame encoding/decoding
- Data validation
- CRC calculations
- Telemetry data details

### Demo Mode

- Demo session start/stop
- Frame generation
- Periodic status updates

## Log Output

Logs are printed to the console where you run the application. The format includes:

- Timestamp
- Log level
- Module path
- Message

Example output:

```
[2024-01-15T10:30:45Z INFO  gateway_tauri::main] Starting Gateway Tauri application
[2024-01-15T10:30:45Z INFO  gateway_tauri::ipc] Listing available serial ports
[2024-01-15T10:30:45Z INFO  gateway_tauri::ipc] Found 2 serial ports: ["/dev/ttyUSB0", "/dev/ttyUSB1"]
```

## Troubleshooting

If you're not seeing logs, make sure:

1. The `RUST_LOG` environment variable is set
2. You're running the application from the terminal
3. The log level is appropriate for the information you want to see

For development, `RUST_LOG=debug` will show the most detailed information.
For production, `RUST_LOG=info` or `RUST_LOG=warn` is recommended.
