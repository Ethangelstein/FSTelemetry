use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};
use tokio_serial::{DataBits, FlowControl, Parity, SerialPortBuilder, SerialStream, StopBits};

#[derive(Default)]
pub struct SerialState {
  pub tx: Option<mpsc::Sender<Vec<u8>>>,
  pub demo_stop: Option<oneshot::Sender<()>>,
}

fn base_builder(port_name: &str, baud: u32) -> SerialPortBuilder {
  tokio_serial::new(port_name, baud)
    .data_bits(DataBits::Eight)
    .parity(Parity::None)
    .flow_control(FlowControl::None)
    .timeout(Duration::from_millis(1000))
}

pub async fn open(
  port_name: String,
  baud: u32,
) -> Result<(SerialStream, mpsc::Receiver<Vec<u8>>), String> {
  let builder = base_builder(&port_name, baud);

  let try_one = SerialStream::open(&builder.clone().stop_bits(StopBits::One));

  let mut port = match try_one {
    Ok(p) => p,
    Err(e1) => {
      #[cfg(target_os = "windows")]
      {
        let msg = e1.to_string().to_lowercase();
        let looks_like_stopbits = msg.contains("stop bits") || msg.contains("invalid parameter");

        if looks_like_stopbits {
          log::warn!(
            "open({}) @{}bps failed with 1 stop bit ({}); retrying with 2 stop bits",
            port_name,
            baud,
            e1
          );
          SerialStream::open(&builder.stop_bits(StopBits::Two))
            .map_err(|e2| format!("open failed (1 then 2 stop bits): {e1} / {e2}"))?
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

  let (_tx, rx) = mpsc::channel::<Vec<u8>>(100);
  Ok((port, rx))
}

pub fn find_magic(b: &[u8], m: [u8; 2]) -> Option<usize> {
  if b.len() < 2 {
    return None;
  }
  for i in 0..=b.len() - 2 {
    if b[i] == m[0] && b[i + 1] == m[1] {
      return Some(i);
    }
  }
  None
}

pub async fn writer_task<W>(
  mut port: W,
  mut rx: mpsc::Receiver<Vec<u8>>,
  on_err: impl Fn(String) + Send + Sync + 'static,
) where
  W: AsyncWrite + Unpin,
{
  while let Some(msg) = rx.recv().await {
    if let Err(e) = port.write_all(&msg).await {
      on_err(format!("write error: {e}"));
      break;
    }
  }
}

pub async fn reader_loop<R, F>(
  mut port: R,
  magic: [u8; 2],
  frame_size: usize,
  use_crc: bool,
  mut on_frame: F,
) where
  R: AsyncRead + Unpin,
  F: FnMut(Vec<u8>, bool) + Send + 'static,
{
  let mut buf = Vec::<u8>::new();
  let mut tmp = [0u8; 1024];

  loop {
    match port.read(&mut tmp).await {
      Ok(n) if n > 0 => {
        buf.extend_from_slice(&tmp[..n]);

        loop {
          let Some(idx) = find_magic(&buf, magic) else {
            if buf.len() > 8192 {
              buf.clear();
            }
            break;
          };

          if buf.len() < idx + frame_size {
            if idx > 0 {
              buf.drain(..idx);
            }
            break;
          }

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

          on_frame(frame, ok_crc);
        }
      }
      Ok(_) => {
      }
      Err(e) => {
        log::error!("serial read error: {e}");
        break;
      }
    }
  }
}
