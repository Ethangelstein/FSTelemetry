use std::time::{Duration, Instant};
use std::sync::{Arc, Mutex};
use std::thread;
use std::sync::mpsc;
use serialport::{DataBits, FlowControl, Parity, SerialPort, SerialPortBuilder, StopBits};

#[derive(Default)]
pub struct SerialState {
  pub demo_stop: Option<mpsc::Sender<()>>,
}

fn base_builder(port_name: &str, baud: u32) -> SerialPortBuilder {
  serialport::new(port_name, baud)
    .data_bits(DataBits::Eight)
    .parity(Parity::None)
    .flow_control(FlowControl::None)
    .timeout(Duration::from_millis(10000))
}

pub fn open(
  port_name: String,
  baud: u32,
) -> Result<Box<dyn SerialPort>, String> {
  let builder = base_builder(&port_name, baud);

  let try_one = builder.clone().stop_bits(StopBits::One).open();

  let (mut port, used_two) = match try_one {
    Ok(p) => (p, false),
    Err(e1) => {
      #[cfg(target_os = "windows")]
      {
        let msg = e1.to_string().to_lowercase();
        let looks_like_stopbits = msg.contains("stop bits") || msg.contains("invalid parameter");
        log::warn!("Error: {}", msg);
        if looks_like_stopbits {
          log::warn!(
            "serial: open({}) @{}bps failed with 1 stop bit ({}); retrying with 2 stop bits",
            port_name, baud, e1
          );
          let p = builder.stop_bits(StopBits::Two).open()
            .map_err(|e2| format!("open failed (1 then 2 stop bits): {e1} / {e2}"))?;
          (p, true)
        } else {
          return Err(e1.to_string());
        }
      }
      #[cfg(not(target_os = "windows"))]
      {
        return Err(e1.to_string());
      }
    } 
  };

  #[cfg(target_family = "unix")]
  let _ = port.set_exclusive(false);

  log::info!(
    "serial: opened {} @{}bps (stopbits: {}, parity: none, data: 8)",
    port_name,
    baud,
    if used_two { "2 (fallback)" } else { "1" }
  );

  Ok(port)
}

pub fn find_magic(b: &[u8], m: [u8; 2]) -> Option<usize> {
  if b.len() < 2 { return None; }
  for i in 0..=b.len() - 2 {
    if b[i] == m[0] && b[i + 1] == m[1] {
      return Some(i);
    }
  }
  None
}

// Writer task removed - no writing functionality needed

pub fn reader_loop<F>(
  mut port: Box<dyn SerialPort>,
  magic: [u8; 2],
  frame_size: usize,
  use_crc: bool,
  mut on_frame: F,
) where
  F: FnMut(Vec<u8>, bool) + Send + 'static,
{
  thread::spawn(move || {
    let mut buf = Vec::<u8>::new();
    let mut tmp = [0u8; 1024];

    let mut first_data = true;
    let mut last_data_ts = Instant::now();
    let mut last_sniff = Instant::now();
    let mut waiting_since: Option<Instant> = None;
    let mut frames_ok: u64 = 0;
    let mut frames_bad_crc: u64 = 0;

    log::info!(
      "serial: reader start (magic='{}{}', frame_size={}, use_crc={})",
      magic[0] as char, magic[1] as char, frame_size, use_crc
    );

    loop {
      match port.read(&mut tmp) {
        Ok(n) if n > 0 => {
          buf.extend_from_slice(&tmp[..n]);

          if first_data {
            log::info!("serial: first {} byte(s) received", n);
            first_data = false;
          }
          last_data_ts = Instant::now();

          if last_sniff.elapsed() > Duration::from_millis(800) {
            let head = buf.iter().take(64).map(|b| format!("{:02X}", b))
                          .collect::<Vec<_>>().join(" ");
            log::debug!("serial: buffer={}B head={}", buf.len(), head);
            last_sniff = Instant::now();
          }

          loop {
            let Some(idx) = find_magic(&buf, magic) else {
              if buf.len() > 8192 {
                log::warn!("serial: no magic and buffer >8KB, clearing");
                buf.clear();
              }
              waiting_since = None;
              break;
            };

            if buf.len() < idx + frame_size {
              if idx > 0 { buf.drain(..idx); }

              let now = Instant::now();
              if waiting_since.is_none() { waiting_since = Some(now); }
              else if now.duration_since(waiting_since.unwrap()) > Duration::from_millis(1500) {
                log::warn!(
                  "serial: frame incomplete >1500ms (need {} bytes), resetting buffer",
                  frame_size
                );
                buf.clear();
                waiting_since = None;
              }
              break;
            }

            waiting_since = None;

            let frame = buf[idx..idx + frame_size].to_vec();
            buf.drain(..idx + frame_size);

            let ok_crc = if use_crc && frame.len() >= 4 {
              let data_len = frame.len() - 2;
              let data = &frame[..data_len];
              let crc_le = u16::from_le_bytes([frame[data_len], frame[data_len + 1]]);
              crate::telemetry::crc16_modbus(data) == crc_le
            } else {
              true
            };

            if ok_crc {
              frames_ok += 1;
              log::info!("serial: frame {}B OK (ok={})", frame.len(), frames_ok);
            } else {
              frames_bad_crc += 1;
              log::warn!("serial: frame {}B CRC BAD (bad_crc={})", frame.len(), frames_bad_crc);
            }

            on_frame(frame, ok_crc);
          }
        }
        Ok(_) => {
          if last_data_ts.elapsed() > Duration::from_secs(3) {
            log::warn!(
              "serial: no data for >3s (port open). Hints: correct COM, close Arduino Serial Monitor, magic='TD', frame_size=60, CRC=true"
            );
            last_data_ts = Instant::now();
          }
        }
        Err(e) => {
          log::error!("serial read error: {e}");
          break;
        }
      }
    }
  });
}
