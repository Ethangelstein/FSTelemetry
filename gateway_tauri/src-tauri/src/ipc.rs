use tauri::{AppHandle, Emitter};
use std::sync::{Arc, Mutex};
use tokio::{io::split, sync::{mpsc, oneshot}, time::{self, Duration}};
use crate::{telemetry::{Telemetry, decode_frame, encode_frame, now_seconds}, serial, serial::SerialState};
use log::{info, warn, error, debug};


#[derive(Clone, serde::Serialize)]
pub struct FrameEv { hex: String, okCrc: bool }

const EV_SERIAL_OPEN: &str = "serial:open";
const EV_SERIAL_ERROR: &str = "serial:error";
const EV_SERIAL_FRAME: &str = "serial:frame";
const EV_TELEMETRY: &str = "telemetry";

#[tauri::command]
pub async fn list_ports() -> Result<Vec<String>, String> {
  info!("Listing available serial ports");
  match tokio_serial::available_ports() {
    Ok(ports) => {
      let port_names: Vec<String> = ports.into_iter().map(|p| p.port_name).collect();
      info!("Found {} serial ports: {:?}", port_names.len(), port_names);
      Ok(port_names)
    }
    Err(e) => {
      error!("Failed to list serial ports: {}", e);
      Err(e.to_string())
    }
  }
}


#[tauri::command]
pub async fn open_port(
  app: AppHandle,
  state: tauri::State<'_, Arc<Mutex<SerialState>>>,
  portName: String, baud: u32,
  magic0: u8, magic1: u8, frameSize: usize, useCrc: bool
) -> Result<(), String> {
  info!("Opening serial port: {} at {} baud, magic=[{}, {}], frameSize={}, useCrc={}", 
        portName, baud, magic0, magic1, frameSize, useCrc);
  
  let (port, _rx_writes) = match serial::open(portName.clone(), baud).await {
    Ok((port, rx_writes)) => {
      info!("Successfully opened serial port: {}", portName);
      (port, rx_writes)
    }
    Err(e) => {
      error!("Failed to open serial port {}: {}", portName, e);
      return Err(e);
    }
  };

  let (reader, writer) = split(port);
  info!("Split serial port into reader and writer");

  let (tx, rx) = mpsc::channel::<Vec<u8>>(100);
  { state.lock().unwrap().tx = Some(tx); }
  info!("Created message channel for serial writes");

  let app_w = app.clone();
  tokio::spawn(async move {
    info!("Starting serial writer task");
    serial::writer_task(writer, rx, move |e| {
      error!("Serial write error: {}", e);
      let _ = app_w.emit(EV_SERIAL_ERROR, e);
    }).await;
  });

  let app_r = app.clone();
  tokio::spawn(async move {
    info!("Starting serial reader task");
    serial::reader_loop(reader, [magic0, magic1], frameSize, useCrc, move |frame, ok| {
      debug!("Received frame: {} bytes, CRC ok: {}", frame.len(), ok);
      let _ = app_r.emit(EV_SERIAL_FRAME, FrameEv { hex: hex::encode(&frame), okCrc: ok });
      if let Some(t) = decode_frame(&frame) {
        debug!("Decoded telemetry: ID={}, lat={}, lon={}, alt={}", t.id, t.latitude, t.longitude, t.altitude);
        let _ = app_r.emit(EV_TELEMETRY, t);
      } else {
        warn!("Failed to decode telemetry frame");
      }
    }).await;
  });

  info!("Serial port opened successfully");
  app.emit(EV_SERIAL_OPEN, serde_json::json!({"ok": true})).ok();
  Ok(())
}

#[tauri::command]
pub async fn write_bytes(
  state: tauri::State<'_, Arc<Mutex<SerialState>>>,
  dataHex: String
) -> Result<(), String> {
  debug!("Writing bytes to serial port: {}", dataHex);
  let s = dataHex.trim().trim_start_matches("0x").trim_start_matches("0X").to_string();
  let bytes = match hex::decode(&s) {
    Ok(bytes) => {
      debug!("Decoded {} bytes from hex", bytes.len());
      bytes
    }
    Err(e) => {
      error!("Invalid hex string '{}': {}", dataHex, e);
      return Err(e.to_string());
    }
  };
  let tx = state.lock().unwrap().tx.clone().ok_or_else(|| {
    error!("Attempted to write to closed serial port");
    "port not open".to_string()
  })?;
  tx.send(bytes).await.map_err(|e| {
    error!("Failed to send data to serial port: {}", e);
    e.to_string()
  })
}

#[tauri::command]
pub async fn close_port(state: tauri::State<'_, Arc<Mutex<SerialState>>>) -> Result<(), String> {
  info!("Closing serial port");
  state.lock().unwrap().tx = None;
  info!("Serial port closed");
  Ok(())
}
