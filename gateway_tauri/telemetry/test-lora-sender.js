#!/usr/bin/env node

/**
 * Test LoRa Data Sender
 * 
 * This script simulates your LoRa system node sending compressed telemetry data
 * to the dashboard API. You can use this as a reference for your actual LoRa 
 * implementation.
 * 
 * Usage: node test-lora-sender.js [server-url]
 * Example: node test-lora-sender.js http://localhost:3000
 */

const http = require('http');
const https = require('https');
const url = require('url');

// Default server URL
const DEFAULT_SERVER_URL = 'http://localhost:3000';

// Get server URL from command line args or use default
const serverUrl = process.argv[2] || DEFAULT_SERVER_URL;
const apiEndpoint = `${serverUrl}/api/telemetry`;

/**
 * Generate mock LoRa telemetry data in the compressed format
 * This simulates what your ESP32 tracker would send
 */
function generateLoRaData() {
    const baseTime = Math.floor(Date.now() / 1000);

    // Base coordinates for Buenos Aires with small variations
    const baseLat = -34.6037;
    const baseLon = -58.3816;
    const baseAlt = 25.3;

    return {
        id: "trk1", // Device ID
        t: baseTime, // Unix timestamp
        g: [ // GPS coordinates [lat, lon, alt]
            baseLat + (Math.random() - 0.5) * 0.001,   // ±0.0005 degree variation (~55m)
            baseLon + (Math.random() - 0.5) * 0.001,   // ±0.0005 degree variation (~55m)
            baseAlt + (Math.random() - 0.5) * 5        // ±2.5m altitude variation
        ],
        r: 1432 + Math.floor((Math.random() - 0.5) * 400), // RPM: 1232-1632
        a: [ // Accelerometer [x, y, z] in mg
            123 + Math.floor((Math.random() - 0.5) * 100),   // X: 73-173
            -5 + Math.floor((Math.random() - 0.5) * 40),     // Y: -25-15
            1010 + Math.floor((Math.random() - 0.5) * 200)   // Z: 910-1110
        ],
        v: 3720 + Math.floor((Math.random() - 0.5) * 600), // Voltage: 3420-4020 mV
        c: 480 + Math.floor((Math.random() - 0.5) * 200)   // Current: 380-580 mA
    };
}

/**
 * Send telemetry data to the server
 */
function sendTelemetryData(data) {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(apiEndpoint);
        const isHttps = parsedUrl.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const postData = JSON.stringify(data);

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = httpModule.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                try {
                    const response = JSON.parse(responseData);
                    resolve({
                        statusCode: res.statusCode,
                        statusMessage: res.statusMessage,
                        data: response
                    });
                } catch (error) {
                    resolve({
                        statusCode: res.statusCode,
                        statusMessage: res.statusMessage,
                        data: responseData
                    });
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Main function to simulate continuous LoRa data transmission
 */
async function main() {
    console.log('🚀 LoRa Telemetry Data Sender');
    console.log(`📡 Sending data to: ${apiEndpoint}`);
    console.log('📊 Press Ctrl+C to stop\n');

    let packetCount = 0;

    const sendInterval = setInterval(async () => {
        try {
            const loraData = generateLoRaData();
            packetCount++;

            console.log(`📦 Packet #${packetCount} - Sending LoRa data:`);
            console.log(JSON.stringify(loraData, null, 2));

            const response = await sendTelemetryData(loraData);

            if (response.statusCode === 200) {
                console.log('✅ Data sent successfully!');
                console.log(`📨 Response: ${JSON.stringify(response.data)}`);
            } else {
                console.log(`❌ Error: ${response.statusCode} - ${response.statusMessage}`);
                console.log(`📨 Response: ${JSON.stringify(response.data)}`);
            }

            console.log('⏱️  Waiting 5 seconds for next transmission...\n');

        } catch (error) {
            console.error('❌ Failed to send data:', error.message);
            console.log('⏱️  Retrying in 5 seconds...\n');
        }
    }, 5000); // Send every 5 seconds

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Stopping LoRa data transmission...');
        clearInterval(sendInterval);
        console.log('✅ Sender stopped. Total packets sent:', packetCount);
        process.exit(0);
    });
}

// Show help information
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
LoRa Telemetry Data Sender

Usage: node test-lora-sender.js [server-url]

Arguments:
  server-url    The base URL of your telemetry server (default: ${DEFAULT_SERVER_URL})

Examples:
  node test-lora-sender.js
  node test-lora-sender.js http://localhost:3000
  node test-lora-sender.js https://your-domain.com

Data Format:
The script sends compressed LoRa data in the format:
{
  "id": "trk1",                    // Device identifier
  "t": 1729917733,                 // Unix timestamp
  "g": [-34.6037, -58.3816, 25.3], // [latitude, longitude, altitude]
  "r": 1432,                       // RPM
  "a": [123, -5, 1010],            // [accel_x, accel_y, accel_z] in mg
  "v": 3720,                       // Voltage in mV
  "c": 480                         // Current in mA
}

Options:
  --help, -h    Show this help message
  `);
    process.exit(0);
}

// Start the sender
main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
}); 
