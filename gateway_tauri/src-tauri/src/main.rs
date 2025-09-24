mod telemetry;
mod serial;
mod ipc;

use std::sync::{Arc, Mutex};
use log::{info, warn, error};

fn main() {
  env_logger::Builder::from_default_env()
    .filter_level(log::LevelFilter::Info)
    .init();
  
  info!("Starting Gateway Tauri application");
  
  tauri::Builder::default()
    .manage(Arc::new(Mutex::new(serial::SerialState::default())))
    .invoke_handler(tauri::generate_handler![
      ipc::list_ports,
      ipc::open_port,
      ipc::write_bytes,
      ipc::close_port
    ])
    .run(tauri::generate_context!())
    .expect("error running tauri");
}
