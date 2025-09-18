use tauri::{AppHandle, Emitter, Manager};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio::io::split; 

use crate::{telemetry::{Telemetry, decode_frame}, serial, serial::SerialState};

#[derive(Clone, serde::Serialize)]
pub struct FrameEv { hex: String, okCrc: bool }

const EV_SERIAL_OPEN: &str = "serial:open";
const EV_SERIAL_ERROR: &str = "serial:error";
const EV_SERIAL_FRAME: &str = "serial:frame";
const EV_TELEMETRY: &str = "telemetry";

#[tauri::command]
pub async fn list_ports() -> Result<Vec<String>, String> {
  Ok(tokio_serial::available_ports().map_err(|e| e.to_string())?
    .into_iter().map(|p| p.port_name).collect())
}

#[tauri::command]
pub async fn open_port(
  app: AppHandle,
  state: tauri::State<'_, Arc<Mutex<SerialState>>>,
  portName: String, baud: u32,
  magic0: u8, magic1: u8, frameSize: usize, useCrc: bool
) -> Result<(), String> {
  let (port, _rx_writes) = serial::open(portName, baud).await?;

  // dividir en reader / writer
  let (reader, writer) = split(port);

  // Writer channel into state
  let (tx, rx) = mpsc::channel::<Vec<u8>>(100);
  { state.lock().unwrap().tx = Some(tx); }

  // Writer
  let app_w = app.clone();
  tokio::spawn(async move {
    serial::writer_task(writer, rx, move |e| {
      let _ = app_w.emit(EV_SERIAL_ERROR, e);
    }).await;
  });

  // Reader
  let app_r = app.clone();
  tokio::spawn(async move {
    serial::reader_loop(reader, [magic0, magic1], frameSize, useCrc, move |frame, ok| {
      let _ = app_r.emit(EV_SERIAL_FRAME, FrameEv { hex: hex::encode(&frame), okCrc: ok });
      if let Some(t) = decode_frame(&frame) {
        let _ = app_r.emit(EV_TELEMETRY, t);
      }
    }).await; // <-- reader_loop es async; ciérralo con .await dentro del spawn
  });

  app.emit(EV_SERIAL_OPEN, serde_json::json!({"ok": true})).ok();
  Ok(())
}

#[tauri::command]
pub async fn write_bytes(
  state: tauri::State<'_, Arc<Mutex<SerialState>>>,
  dataHex: String
) -> Result<(), String> {
  let s = dataHex.trim().trim_start_matches("0x").trim_start_matches("0X").to_string();
  let bytes = hex::decode(&s).map_err(|e| e.to_string())?;
  let tx = state.lock().unwrap().tx.clone().ok_or("port not open")?;
  tx.send(bytes).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_port(state: tauri::State<'_, Arc<Mutex<SerialState>>>) -> Result<(), String> {
  state.lock().unwrap().tx = None;
  Ok(())
}
