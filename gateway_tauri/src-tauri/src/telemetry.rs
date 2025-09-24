use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use log::{info, warn, error, debug};

#[derive(Clone, Serialize, Default, Debug)]
pub struct Telemetry {
  pub version: u8,
  pub reserved: u8,
  pub timestamp: u32,  
  pub id: String,            
  pub latitude: f32,
  pub longitude: f32,
  pub altitude: f32,
  pub rpm: i16,
  pub ax: i16, pub ay: i16, pub az: i16,
  pub voltage_mv: u16,      
  pub current_ma: u16,       
  pub rssi: i16,              
  pub snr: f32,               
  pub packet_count: u32,
}

pub fn now_seconds() -> u32 {
  let seconds = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as u32;
  debug!("Current timestamp: {}", seconds);
  seconds
}


pub fn decode_frame(frame: &[u8]) -> Option<Telemetry> {
  debug!("Attempting to decode frame of {} bytes", frame.len());
  
  if frame.len() != 60 { 
    warn!("Invalid frame length: {} (expected 60)", frame.len());
    return None; 
  }
  
  if frame[0] != b'T' || frame[1] != b'D' { 
    warn!("Invalid frame header: [{}, {}] (expected [T, D])", frame[0], frame[1]);
    return None; 
  }

  // ayuda para leer
  let le_u16 = |i| u16::from_le_bytes([frame[i], frame[i+1]]);
  let le_i16 = |i| i16::from_le_bytes([frame[i], frame[i+1]]);
  let le_u32 = |i| u32::from_le_bytes([frame[i], frame[i+1], frame[i+2], frame[i+3]]);
  let le_f32 = |i| f32::from_le_bytes([frame[i], frame[i+1], frame[i+2], frame[i+3]]);

  let version   = frame[2];
  let reserved  = frame[3];
  let id_raw    = &frame[4..20]; // 16 bytes
  let id = {
    // cortar en el primer 0x00 para null-terminated
    let end = id_raw.iter().position(|&b| b == 0).unwrap_or(id_raw.len());
    String::from_utf8_lossy(&id_raw[..end]).to_string()
  };
  let timestamp   = le_u32(20);
  let latitude    = le_f32(24);
  let longitude   = le_f32(28);
  let altitude    = le_f32(32);
  let rpm         = le_i16(36);
  let ax          = le_i16(38);
  let ay          = le_i16(40);
  let az          = le_i16(42);
  let voltage_mv  = le_u16(44);
  let current_ma  = le_u16(46);
  let rssi        = le_i16(48);
  let snr         = le_f32(50);
  let packet_count= le_u32(54);
  // CRC (bytes 58..60) ya verificado en serial.rs

  let telemetry = Telemetry{
    version, reserved, id: id.clone(), timestamp,
    latitude, longitude, altitude,
    rpm, ax, ay, az,
    voltage_mv, current_ma, rssi, snr, packet_count
  };
  
  debug!("Successfully decoded telemetry: ID={}, lat={:.6}, lon={:.6}, alt={:.2}, rpm={}, packet_count={}", 
         id, latitude, longitude, altitude, rpm, packet_count);
  
  Some(telemetry)
}

pub fn encode_frame(t: &Telemetry, magic: [u8;2], use_crc: bool, frame_size: usize) -> Vec<u8> {
  debug!("Encoding telemetry frame: ID={}, magic=[{}, {}], use_crc={}, frame_size={}", 
         t.id, magic[0], magic[1], use_crc, frame_size);
  
  let mut b = Vec::<u8>::with_capacity(frame_size);
  b.push(magic[0]); b.push(magic[1]);
  b.push(t.version); b.push(t.reserved);
  
  // id[16] - rellenar con nulls si es más corto
  let mut id_bytes = [0u8; 16];
  let id_bytes_src = t.id.as_bytes();
  let copy_len = id_bytes_src.len().min(16);
  id_bytes[..copy_len].copy_from_slice(&id_bytes_src[..copy_len]);
  b.extend_from_slice(&id_bytes);
  
  b.extend_from_slice(&t.timestamp.to_le_bytes());
  b.extend_from_slice(&t.latitude.to_le_bytes());
  b.extend_from_slice(&t.longitude.to_le_bytes());
  b.extend_from_slice(&t.altitude.to_le_bytes());
  b.extend_from_slice(&t.rpm.to_le_bytes());
  b.extend_from_slice(&t.ax.to_le_bytes());
  b.extend_from_slice(&t.ay.to_le_bytes());
  b.extend_from_slice(&t.az.to_le_bytes());
  b.extend_from_slice(&t.voltage_mv.to_le_bytes());
  b.extend_from_slice(&t.current_ma.to_le_bytes());
  b.extend_from_slice(&t.rssi.to_le_bytes());
  b.extend_from_slice(&t.snr.to_le_bytes());
  b.extend_from_slice(&t.packet_count.to_le_bytes());

  if use_crc {
    let crc = crc16_modbus(&b);
    debug!("Calculated CRC: {}", crc);
    b.extend_from_slice(&crc.to_le_bytes());
  }
  
  if b.len() < frame_size { 
    debug!("Padding frame from {} to {} bytes", b.len(), frame_size);
    b.resize(frame_size, 0); 
  }
  
  debug!("Encoded frame: {} bytes", b.len());
  b
}

pub fn crc16_modbus(data: &[u8]) -> u16 {
  debug!("Calculating CRC16-Modbus for {} bytes", data.len());
  let mut crc: u16 = 0xFFFF;
  for &b in data {
    crc ^= b as u16;
    for _ in 0..8 {
      crc = if (crc & 1) != 0 { (crc >> 1) ^ 0xA001 } else { crc >> 1 };
    }
  }
  debug!("CRC16-Modbus result: {}", crc);
  crc
}
