// src-tauri/src/ipc.rs
use tauri::{AppHandle, Emitter};
use std::sync::{Arc, Mutex};
use tokio::{io::split, sync::mpsc};
use crate::{telemetry::decode_frame, serial, serial::SerialState};
use log::{info, warn, error, debug};

#[derive(Clone, serde::Serialize)]
pub struct FrameEv { hex: String, okCrc: bool }

const EV_SERIAL_OPEN: &str = "serial:open";
const EV_SERIAL_ERROR: &str = "serial:error";
const EV_SERIAL_FRAME: &str = "serial:frame";
const EV_TELEMETRY: &str = "telemetry";

#[tauri::command]
pub async fn list_ports() -> Result<Vec<String>, String> {
  match tokio_serial::available_ports() {
    Ok(ports) => Ok(ports.into_iter().map(|p| p.port_name).collect()),
    Err(e) => Err(e.to_string()),
  }
}

async fn open_port_internal(
  app: AppHandle,
  state_arc: Arc<Mutex<SerialState>>,
  port_name: String, baud: u32,
  magic0: u8, magic1: u8, frame_size: usize, use_crc: bool
) -> Result<(), String> {
  let (port, _rx_writes) = serial::open(port_name.clone(), baud).await?;
  let (reader, writer) = split(port);

  let (tx, rx) = mpsc::channel::<Vec<u8>>(100);
  { state_arc.lock().unwrap().tx = Some(tx); }

  let app_w = app.clone();
  tokio::spawn(async move {
    serial::writer_task(writer, rx, move |e| {
      let _ = app_w.emit(EV_SERIAL_ERROR, e);
    }).await;
  });

  let app_r = app.clone();
  tokio::spawn(async move {
    serial::reader_loop(reader, [magic0, magic1], frame_size, use_crc, move |frame, ok| {
      let _ = app_r.emit(EV_SERIAL_FRAME, FrameEv { hex: hex::encode(&frame), okCrc: ok });
      if let Some(t) = decode_frame(&frame) {
        let _ = app_r.emit(EV_TELEMETRY, t);
      } else {
        warn!("Failed to decode telemetry frame");
      }
    }).await;
  });

  app.emit(EV_SERIAL_OPEN, serde_json::json!({"ok": true})).ok();
  Ok(())
}

#[tauri::command]
pub async fn open_port(
  app: AppHandle,
  state: tauri::State<'_, Arc<Mutex<SerialState>>>,
  portName: String, baud: u32,
  magic0: u8, magic1: u8, frameSize: usize, useCrc: bool
) -> Result<(), String> {
  let state_arc = state.inner().clone();
  open_port_internal(app, state_arc, portName, baud, magic0, magic1, frameSize, useCrc).await
}

pub async fn auto_open_first_with(
  app: AppHandle,
  state_arc: Arc<Mutex<SerialState>>
) -> Result<(), String> {
  let ports = tokio_serial::available_ports().map_err(|e| e.to_string())?;
  let first = ports.into_iter().next().ok_or_else(|| "no serial ports found".to_string())?;
  let port = first.port_name;
  let baud = 115_200u32;
  let magic0 = b'T';
  let magic1 = b'D';
  let frame_size = 60usize;
  let use_crc = true;
  open_port_internal(app, state_arc, port, baud, magic0, magic1, frame_size, use_crc).await
}

#[tauri::command]
pub async fn write_bytes(
  state: tauri::State<'_, Arc<Mutex<SerialState>>>,
  dataHex: String
) -> Result<(), String> {
  let s = dataHex.trim().trim_start_matches("0x").trim_start_matches("0X").to_string();
  let bytes = hex::decode(&s).map_err(|e| e.to_string())?;
  let tx = state.lock().unwrap().tx.clone().ok_or_else(|| "port not open".to_string())?;
  tx.send(bytes).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_port(state: tauri::State<'_, Arc<Mutex<SerialState>>>) -> Result<(), String> {
  state.lock().unwrap().tx = None;
  Ok(())
}
