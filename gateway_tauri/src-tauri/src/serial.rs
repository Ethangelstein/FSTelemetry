use std::time::Duration;
use tokio::sync::mpsc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio_serial::{DataBits, FlowControl, Parity, StopBits};
use log::{info, warn, error, debug};

#[derive(Default)]
pub struct SerialState {
  pub tx: Option<mpsc::Sender<Vec<u8>>>,
}

pub async fn open(
  port_name: String, baud: u32
) -> Result<(tokio_serial::SerialStream, mpsc::Receiver<Vec<u8>>), String> {
  debug!("Configuring serial port: {} at {} baud", port_name, baud);
  let builder = tokio_serial::new(port_name.clone(), baud)
    .data_bits(DataBits::Eight).stop_bits(StopBits::One)
    .parity(Parity::None).flow_control(FlowControl::None)
    .timeout(Duration::from_millis(1000));
  
  let mut port = match tokio_serial::SerialStream::open(&builder) {
    Ok(port) => {
      info!("Serial port opened successfully: {}", port_name);
      port
    }
    Err(e) => {
      error!("Failed to open serial port {}: {}", port_name, e);
      return Err(e.to_string());
    }
  };
  
  #[cfg(target_family = "unix")]
  {
    if let Err(e) = port.set_exclusive(false) {
      warn!("Failed to set non-exclusive mode: {}", e);
    } else {
      debug!("Set non-exclusive mode for port: {}", port_name);
    }
  }
  
  let (_tx, rx) = mpsc::channel::<Vec<u8>>(100);
  debug!("Created message channel for serial port: {}", port_name);
  Ok((port, rx))
}

pub fn find_magic(b: &[u8], m: [u8;2]) -> Option<usize> {
  for i in 0..b.len().saturating_sub(1) {
    if b[i]==m[0] && b[i+1]==m[1] { 
      debug!("Found magic bytes [{}, {}] at position {}", m[0], m[1], i);
      return Some(i); 
    }
  }
  None
}

pub async fn writer_task<W>(
  mut port: W,
  mut rx: mpsc::Receiver<Vec<u8>>,
  on_err: impl Fn(String) + Send + Sync + 'static
) where W: AsyncWrite + Unpin {
  info!("Serial writer task started");
  let mut msg_count = 0;
  while let Some(msg) = rx.recv().await {
    debug!("Writing {} bytes to serial port", msg.len());
    if let Err(e) = port.write_all(&msg).await {
      error!("Serial write error: {}", e);
      on_err(format!("write error: {e}"));
      break;
    }
    msg_count += 1;
    if msg_count % 100 == 0 {
      debug!("Serial writer: sent {} messages", msg_count);
    }
  }
  info!("Serial writer task ended after {} messages", msg_count);
}

pub async fn reader_loop<R, F>(
  mut port: R,
  magic: [u8;2], frame_size: usize, use_crc: bool,
  mut on_frame: F
) where R: AsyncRead + Unpin, F: FnMut(Vec<u8>, bool) + Send + 'static {
  info!("Serial reader loop started, magic=[{}, {}], frame_size={}, use_crc={}", 
        magic[0], magic[1], frame_size, use_crc);
  let mut buf = Vec::<u8>::new();
  let mut tmp = [0u8; 1024];
  let mut frame_count = 0;
  
  loop {
    match port.read(&mut tmp).await {
      Ok(n) if n>0 => {
        debug!("Read {} bytes from serial port", n);
        buf.extend_from_slice(&tmp[..n]);
        
        loop {
          let Some(idx) = find_magic(&buf, magic) else {
            if buf.len() > 1000 {
              warn!("Buffer too large ({} bytes), clearing", buf.len());
            }
            buf.clear(); 
            break;
          };
          
          if buf.len() < idx + frame_size {
            debug!("Incomplete frame, need {} more bytes", idx + frame_size - buf.len());
            if idx > 0 { buf.drain(..idx); }
            break;
          }
          
          let frame = buf[idx..idx+frame_size].to_vec();
          buf.drain(..idx+frame_size);
          
          let ok_crc = if use_crc && frame.len()>=4 {
            let data = &frame[..frame.len()-2];
            let crc_le = u16::from_le_bytes([frame[frame.len()-2], frame[frame.len()-1]]);
            let calculated_crc = super::telemetry::crc16_modbus(data);
            let crc_ok = calculated_crc == crc_le;
            if !crc_ok {
              debug!("CRC mismatch: calculated={}, received={}", calculated_crc, crc_le);
            }
            crc_ok
          } else { 
            true 
          };
          
          frame_count += 1;
          if frame_count % 100 == 0 {
            debug!("Serial reader: processed {} frames", frame_count);
          }
          
          on_frame(frame, ok_crc);
        }
      }
      Ok(_) => {
        debug!("No data available from serial port");
      }
      Err(e) => {
        error!("Serial read error: {}", e);
        break;
      }
    }
  }
  
  info!("Serial reader loop ended after processing {} frames", frame_count);
}
