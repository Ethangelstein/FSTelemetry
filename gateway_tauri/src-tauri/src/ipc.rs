use tauri::{AppHandle, Emitter};
use std::sync::{Arc, Mutex};
use std::sync::mpsc;
use crate::{telemetry::decode_frame, serial, serial::SerialState};
use log::{warn};

#[derive(Clone, serde::Serialize)]
pub struct FrameEv { hex: String, okCrc: bool }

const EV_SERIAL_OPEN:  &str = "serial:open";
const EV_SERIAL_ERROR: &str = "serial:error";
const EV_SERIAL_FRAME: &str = "serial:frame";
const EV_TELEMETRY:    &str = "telemetry";

const DEF_MAGIC0: u8   = b'T';
const DEF_MAGIC1: u8   = b'D';
const DEF_FR_SIZE: usize = 60;
const DEF_USE_CRC: bool  = true;

#[tauri::command]
pub fn list_ports() -> Result<Vec<String>, String> {
  match serialport::available_ports() {
    Ok(ports) => Ok(ports.into_iter().map(|p| p.port_name).collect()),
    Err(e) => Err(e.to_string()),
  }
}

fn open_port_internal(
  app: AppHandle,
  state_arc: Arc<Mutex<SerialState>>,
  port_name: String, baud: u32,
  magic0: u8, magic1: u8, frame_size: usize, use_crc: bool
) -> Result<(), String> {
  warn!(
    "ipc: opening port='{}' baud={} magic='{}{}' frame_size={} use_crc={}",
    port_name, baud, magic0 as char, magic1 as char, frame_size, use_crc
  );

  let port = match serial::open(port_name.clone(), baud) {
    Ok(ok) => {
      warn!("ipc: serial::open OK for '{}'", port_name);
      ok
    }
    Err(e) => {
      let msg = format!("serial::open('{}') failed: {}", port_name, e);
      warn!("ipc: {}", msg);
      let _ = app.emit(EV_SERIAL_ERROR, msg.clone());
      return Err(msg);
    }
  };

  let app_r = app.clone();
  warn!("ipc: spawning reader task");
  serial::reader_loop(port, [magic0, magic1], frame_size, use_crc, move |frame, ok| {
    let _ = app_r.emit(EV_SERIAL_FRAME, FrameEv { hex: hex::encode(&frame), okCrc: ok });

    if let Some(t) = decode_frame(&frame) {
      let _ = app_r.emit(EV_TELEMETRY, t);
      warn!("ipc: TELEMETRY emitted ({} bytes, crc_ok={})", frame.len(), ok);
    } else {
      warn!("ipc: Failed to decode telemetry frame ({} bytes, crc_ok={})", frame.len(), ok);
    }
  });

  warn!("ipc: emitting {}", EV_SERIAL_OPEN);
  let _ = app.emit(EV_SERIAL_OPEN, serde_json::json!({"ok": true}));
  Ok(())
}

#[tauri::command]
pub fn open_port(
  app: AppHandle,
  state: tauri::State<'_, Arc<Mutex<SerialState>>>,
  portName: String, baud: u32,
  magic0: u8, magic1: u8, frameSize: usize, useCrc: bool
) -> Result<(), String> {
  warn!(
    "ipc: open_port RPC called port='{}' baud={} magic='{}{}' frame_size={} use_crc={}",
    portName, baud, magic0 as char, magic1 as char, frameSize, useCrc
  );
  let state_arc = state.inner().clone();
  open_port_internal(app, state_arc, portName, baud, magic0, magic1, frameSize, useCrc)
}

pub fn auto_open_first_with(
  app: AppHandle,
  state_arc: Arc<Mutex<SerialState>>
) -> Result<(), String> {
  let ports = serialport::available_ports().map_err(|e| e.to_string())?;
  let first = ports.into_iter().next().ok_or_else(|| "no serial ports found".to_string())?;
  let port = first.port_name;
  let baud = 115_200u32;

  warn!(
    "ipc: auto_open_first_with → port='{}' baud={} magic='{}{}' frame_size={} use_crc={}",
    &port, baud, DEF_MAGIC0 as char, DEF_MAGIC1 as char, DEF_FR_SIZE, DEF_USE_CRC
  );

  open_port_internal(app, state_arc, port, baud, DEF_MAGIC0, DEF_MAGIC1, DEF_FR_SIZE, DEF_USE_CRC)
}

// Write functionality removed - no writing needed

#[tauri::command]
pub fn close_port(state: tauri::State<'_, Arc<Mutex<SerialState>>>) -> Result<(), String> {
  warn!("ipc: close_port called");
  // No need to manage tx channel since we removed writing functionality
  Ok(())
}
