
use std::{sync::{Arc, Mutex}, time::Duration};
use tauri::{Manager, AppHandle, Emitter};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, sync::mpsc};
use tokio_serial::{SerialPortBuilderExt, DataBits, FlowControl, Parity, StopBits};

#[derive(Clone, serde::Serialize)]
struct FrameEvent {
  hex: String,
  okCrc: bool,
}

#[derive(Clone, serde::Serialize, Default)]
struct Telemetry {
  version: u8,
  reserved: u8,
  timestamp: i64,
  latitude: f32,
  longitude: f32,
  altitude: f32,
  rpm: i16,
  ax: i16,
  ay: i16,
  az: i16,
  voltage_mv: u16,
  current_ma: u16,
  rssi: i16,
  snr: f32,
  packet_count: u32,
}

struct SerialState {
  tx: Option<mpsc::Sender<Vec<u8>>>,
}

#[tauri::command]
async fn list_ports() -> Result<Vec<String>, String> {
  let mut names = vec![];
  for p in tokio_serial::available_ports().map_err(|e| e.to_string())? {
    names.push(p.port_name);
  }
  Ok(names)
}

#[tauri::command]
async fn open_port(
  app: AppHandle,
  state: tauri::State<'_, Arc<Mutex<SerialState>>>,
  port_name: String,
  baud: u32,
  magic0: u8,
  magic1: u8,
  frame_size: usize,
  use_crc: bool,
) -> Result<(), String> {
  let builder = tokio_serial::new(port_name, baud)
    .data_bits(DataBits::Eight)
    .stop_bits(StopBits::One)
    .parity(Parity::None)
    .flow_control(FlowControl::None)
    .timeout(Duration::from_millis(1000));

  let mut port = tokio_serial::SerialStream::open(&builder).map_err(|e| e.to_string())?;
  // Windows can need non-exclusive
  let _ = port.set_exclusive(false);

  // writer channel
  let (tx, mut rx) = mpsc::channel::<Vec<u8>>(100);
  {
    let mut s = state.lock().unwrap();
    s.tx = Some(tx);
  }

  let app_reader = app.clone();
  tokio::spawn(async move {
    let mut buf = vec![0u8; 0];
    let mut tmp = [0u8; 1024];
    let magic = [magic0, magic1];
    loop {
      match port.read(&mut tmp).await {
        Ok(n) if n > 0 => {
          buf.extend_from_slice(&tmp[..n]);
          // try to extract frames
          loop {
            let idx = find_magic(&buf, magic);
            if idx < 0 || buf.len() < (idx as usize + frame_size) {
              // not enough yet
              // trim leading garbage if any
              if idx > 0 {
                buf.drain(..idx as usize);
              }
              break;
            }
            let start = idx as usize;
            let end = start + frame_size;
            let frame = buf[start..end].to_vec();
            // drain consumed bytes
            buf.drain(..end);
            let ok_crc = if use_crc { check_crc16_modbus(&frame) } else { true };
            let _ = app_reader.emit("serial:frame", FrameEvent {
              hex: hex::encode(&frame),
              okCrc: ok_crc,
            });
            if let Some(t) = decode_telemetry(&frame) {
              let _ = app_reader.emit("telemetry", t);
            }
          }
        }
        Ok(_) => {}
        Err(e) => {
          let _ = app_reader.emit("serial:error", format!("read error: {e}"));
          break;
        }
      }
    }
  });

  // writer task
  tokio::spawn(async move {
    while let Some(msg) = rx.recv().await {
      if let Err(e) = port.write_all(&msg).await {
        let _ = app.emit("serial:error", format!("write error: {e}"));
        break;
      }
    }
  });

  app.emit("serial:open", serde_json::json!({"ok": true})).ok();
  Ok(())
}

#[tauri::command]
async fn write_bytes(
  state: tauri::State<'_, Arc<Mutex<SerialState>>>,
  data_hex: String
) -> Result<(), String> {
  let mut s = data_hex.trim().to_string();
  if s.starts_with("0x") || s.starts_with("0X") { s = s[2..].to_string(); }
  let bytes = hex::decode(&s).map_err(|e| e.to_string())?;
  let tx = state.lock().unwrap().tx.clone().ok_or("port not open")?;
  tx.send(bytes).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn close_port(state: tauri::State<'_, Arc<Mutex<SerialState>>>) -> Result<(), String> {
  let mut st = state.lock().unwrap();
  st.tx = None;
  Ok(())
}

fn find_magic(b: &[u8], m: [u8;2]) -> isize {
  for i in 0..b.len().saturating_sub(1) {
    if b[i]==m[0] && b[i+1]==m[1] { return i as isize; }
  }
  -1
}

fn check_crc16_modbus(frame: &[u8]) -> bool {
  if frame.len() < 4 { return false; }
  let data = &frame[..frame.len()-2];
  let crc_le = u16::from_le_bytes([frame[frame.len()-2], frame[frame.len()-1]]);
  crc16_modbus(data) == crc_le
}

fn crc16_modbus(data: &[u8]) -> u16 {
  let mut crc: u16 = 0xFFFF;
  for &b in data {
    crc ^= b as u16;
    for _ in 0..8 {
      if (crc & 1) != 0 { crc = (crc >> 1) ^ 0xA001; } else { crc >>= 1; }
    }
  }
  crc
}

// Best-guess decoder aligned with Go domain.Telemetry and a 60-byte frame starting with 'T','D'.
// Adjust offsets to your real device format if needed.
fn decode_telemetry(frame: &[u8]) -> Option<crate::Telemetry> {
  if frame.len() < 60 { return None; }
  // [0]='T', [1]='D'
  let mut ofs = 2usize;
  let version = *frame.get(ofs)?; ofs += 1;
  let reserved = *frame.get(ofs)?; ofs += 1;
  // timestamp i64 LE
  let ts = i64::from_le_bytes(frame.get(ofs..ofs+8)?.try_into().ok()?); ofs += 8;
  // latitude, longitude, altitude f32 LE
  let lat = f32::from_le_bytes(frame.get(ofs..ofs+4)?.try_into().ok()?); ofs += 4;
  let lon = f32::from_le_bytes(frame.get(ofs..ofs+4)?.try_into().ok()?); ofs += 4;
  let alt = f32::from_le_bytes(frame.get(ofs..ofs+4)?.try_into().ok()?); ofs += 4;
  // rpm i16
  let rpm = i16::from_le_bytes(frame.get(ofs..ofs+2)?.try_into().ok()?); ofs += 2;
  // ax, ay, az i16
  let ax = i16::from_le_bytes(frame.get(ofs..ofs+2)?.try_into().ok()?); ofs += 2;
  let ay = i16::from_le_bytes(frame.get(ofs..ofs+2)?.try_into().ok()?); ofs += 2;
  let az = i16::from_le_bytes(frame.get(ofs..ofs+2)?.try_into().ok()?); ofs += 2;
  // voltage, current u16
  let voltage_mv = u16::from_le_bytes(frame.get(ofs..ofs+2)?.try_into().ok()?); ofs += 2;
  let current_ma = u16::from_le_bytes(frame.get(ofs..ofs+2)?.try_into().ok()?); ofs += 2;
  // rssi i16
  let rssi = i16::from_le_bytes(frame.get(ofs..ofs+2)?.try_into().ok()?); ofs += 2;
  // snr f32
  let snr = f32::from_le_bytes(frame.get(ofs..ofs+4)?.try_into().ok()?); ofs += 4;
  // packet_count u32
  let packet_count = u32::from_le_bytes(frame.get(ofs..ofs+4)?.try_into().ok()?); ofs += 4;

  Some(Telemetry {
    version, reserved, timestamp: ts, latitude: lat, longitude: lon, altitude: alt,
    rpm, ax, ay, az, voltage_mv, current_ma, rssi, snr, packet_count
  })
}

fn main() {
  tauri::Builder::default()
    .manage(Arc::new(Mutex::new(SerialState { tx: None })))
    .invoke_handler(tauri::generate_handler![list_ports, open_port, write_bytes, close_port])
    .run(tauri::generate_context!())
    .expect("error running tauri");
}
