mod telemetry;
mod serial;
mod ipc;

use std::sync::{Arc, Mutex};
use log::info;
use tauri::Manager;

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
    .setup(|app| {
      let app_handle = app.handle().clone();
      let state_arc = app.state::<Arc<Mutex<serial::SerialState>>>().inner().clone();
      tauri::async_runtime::spawn(async move {
        let _ = ipc::auto_open_first_with(app_handle, state_arc).await;
      });
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error running tauri");
}
