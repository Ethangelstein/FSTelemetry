use tauri::{AppHandle, Emitter};
use std::sync::{Arc, Mutex};
use tokio::{io::split, sync::{mpsc, oneshot}, time::{self, Duration}};
use crate::{telemetry::{Telemetry, decode_frame, encode_frame, now_millis}, serial, serial::SerialState};


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
pub async fn start_demo(
  app: AppHandle,
  state: tauri::State<'_, Arc<Mutex<SerialState>>>,
  magic0: u8, magic1: u8,
  frameSize: usize, useCrc: bool,
  period_ms: u64
) -> Result<(), String> {
  if let Some(tx) = state.lock().unwrap().demo_stop.take() { let _ = tx.send(()); }
  let (tx, mut rx) = oneshot::channel::<()>();
  { state.lock().unwrap().demo_stop = Some(tx); }

  let app_demo = app.clone();
  tokio::spawn(async move {
    let mut tick = time::interval(Duration::from_millis(period_ms.max(10)));
    let mut n: u32 = 0;
    loop {
      tokio::select! {
        _ = &mut rx => break,
        _ = tick.tick() => {
          let t = Telemetry {
            version: 1, reserved: 0, timestamp: now_millis(),
            latitude: -34.60 + (n as f32) * 0.00005,
            longitude: -58.38 + (n as f32) * 0.00003,
            altitude: 12.0 + ((n % 50) as f32) * 0.1,
            rpm: 2000 + ((n % 200) as i16) * 20,
            ax: ((n % 40) as i16) - 20, ay: 5, az: 980,
            voltage_mv: 12000 - ((n % 500) as u16),
            current_ma: 600 + ((n % 200) as u16),
            rssi: -70 + ((n % 5) as i16), snr: 7.5, packet_count: n,
          };
          let frame = encode_frame(&t, [magic0, magic1], useCrc, frameSize);
          let _ = app_demo.emit("serial:frame", FrameEv { hex: hex::encode(&frame), okCrc: true });
          let _ = app_demo.emit("telemetry", t.clone());
          n = n.wrapping_add(1);
        }
      }
    }
  });

  app.emit("serial:open", serde_json::json!({"ok": true, "demo": true})).ok();
  Ok(())
}


#[tauri::command]
pub async fn stop_demo(
  state: tauri::State<'_, Arc<Mutex<SerialState>>>
) -> Result<(), String> {
  if let Some(tx) = state.lock().unwrap().demo_stop.take() {
    let _ = tx.send(());
  }
  Ok(())
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
