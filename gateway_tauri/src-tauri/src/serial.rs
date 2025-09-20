use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio_serial::{DataBits, FlowControl, Parity, StopBits};

#[derive(Default)]
pub struct SerialState {
  pub tx: Option<mpsc::Sender<Vec<u8>>>,
  pub demo_stop: Option<oneshot::Sender<()>>,
}

pub async fn open(
  port_name: String, baud: u32
) -> Result<(tokio_serial::SerialStream, mpsc::Receiver<Vec<u8>>), String> {
  let builder = tokio_serial::new(port_name, baud)
    .data_bits(DataBits::Eight).stop_bits(StopBits::One)
    .parity(Parity::None).flow_control(FlowControl::None)
    .timeout(Duration::from_millis(1000));
  let mut port = tokio_serial::SerialStream::open(&builder).map_err(|e| e.to_string())?;
  #[cfg(target_family = "unix")]
  let _ = port.set_exclusive(false);
  let (_tx, rx) = mpsc::channel::<Vec<u8>>(100);
  Ok((port, rx))
}

pub fn find_magic(b: &[u8], m: [u8;2]) -> Option<usize> {
  for i in 0..b.len().saturating_sub(1) {
    if b[i]==m[0] && b[i+1]==m[1] { return Some(i); }
  }
  None
}

pub async fn writer_task<W>(
  mut port: W,
  mut rx: mpsc::Receiver<Vec<u8>>,
  on_err: impl Fn(String) + Send + Sync + 'static
) where W: AsyncWrite + Unpin {
  while let Some(msg) = rx.recv().await {
    if let Err(e) = port.write_all(&msg).await {
      on_err(format!("write error: {e}"));
      break;
    }
  }
}

pub async fn reader_loop<R, F>(
  mut port: R,
  magic: [u8;2], frame_size: usize, use_crc: bool,
  mut on_frame: F
) where R: AsyncRead + Unpin, F: FnMut(Vec<u8>, bool) + Send + 'static {
  let mut buf = Vec::<u8>::new();
  let mut tmp = [0u8; 1024];
  loop {
    match port.read(&mut tmp).await {
      Ok(n) if n>0 => {
        buf.extend_from_slice(&tmp[..n]);
        loop {
          let Some(idx) = find_magic(&buf, magic) else {
            buf.clear(); break;
          };
          if buf.len() < idx + frame_size {
            if idx > 0 { buf.drain(..idx); }
            break;
          }
          let frame = buf[idx..idx+frame_size].to_vec();
          buf.drain(..idx+frame_size);
          let ok_crc = if use_crc && frame.len()>=4 {
            let data = &frame[..frame.len()-2];
            let crc_le = u16::from_le_bytes([frame[frame.len()-2], frame[frame.len()-1]]);
            super::telemetry::crc16_modbus(data) == crc_le
          } else { true };
          on_frame(frame, ok_crc);
        }
      }
      Ok(_) => {}
      Err(_) => break,
    }
  }
}
