use serde::Serialize;

#[derive(Clone, Serialize, Default, Debug)]
pub struct Telemetry {
  pub version: u8,
  pub reserved: u8,
  pub timestamp: i64,
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

pub fn decode_frame(frame: &[u8]) -> Option<Telemetry> {
  if frame.len() < 60 { return None; }
  let mut o = 2usize; // 'T','D'
  let v = *frame.get(o)?; o+=1;
  let r = *frame.get(o)?; o+=1;
  let ts = i64::from_le_bytes(frame.get(o..o+8)?.try_into().ok()?); o+=8;
  let lat=f32::from_le_bytes(frame.get(o..o+4)?.try_into().ok()?); o+=4;
  let lon=f32::from_le_bytes(frame.get(o..o+4)?.try_into().ok()?); o+=4;
  let alt=f32::from_le_bytes(frame.get(o..o+4)?.try_into().ok()?); o+=4;
  let rpm=i16::from_le_bytes(frame.get(o..o+2)?.try_into().ok()?); o+=2;
  let ax=i16::from_le_bytes(frame.get(o..o+2)?.try_into().ok()?); o+=2;
  let ay=i16::from_le_bytes(frame.get(o..o+2)?.try_into().ok()?); o+=2;
  let az=i16::from_le_bytes(frame.get(o..o+2)?.try_into().ok()?); o+=2;
  let vm=u16::from_le_bytes(frame.get(o..o+2)?.try_into().ok()?); o+=2;
  let cm=u16::from_le_bytes(frame.get(o..o+2)?.try_into().ok()?); o+=2;
  let rssi=i16::from_le_bytes(frame.get(o..o+2)?.try_into().ok()?); o+=2;
  let snr=f32::from_le_bytes(frame.get(o..o+4)?.try_into().ok()?); o+=4;
  let pc=u32::from_le_bytes(frame.get(o..o+4)?.try_into().ok()?); o+=4;
  Some(Telemetry {
    version: v, reserved: r, timestamp: ts,
    latitude: lat, longitude: lon, altitude: alt,
    rpm, ax, ay, az, voltage_mv: vm, current_ma: cm, rssi, snr, packet_count: pc
  })
}

pub fn crc16_modbus(data: &[u8]) -> u16 {
  let mut crc: u16 = 0xFFFF;
  for &b in data {
    crc ^= b as u16;
    for _ in 0..8 {
      crc = if (crc & 1) != 0 { (crc >> 1) ^ 0xA001 } else { crc >> 1 };
    }
  }
  crc
}
