mod telemetry;
mod serial;
mod ipc;

use std::sync::{Arc, Mutex};

fn main() {
  tauri::Builder::default()
    .manage(Arc::new(Mutex::new(serial::SerialState::default())))
    .invoke_handler(tauri::generate_handler![
      ipc::list_ports,
      ipc::open_port,
      ipc::write_bytes,
      ipc::close_port,
      ipc::start_demo,   
      ipc::stop_demo     
    ])
    .run(tauri::generate_context!())
    .expect("error running tauri");
}
