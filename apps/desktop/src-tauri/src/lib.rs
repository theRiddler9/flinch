use flinch_core::agent::loop_logic::AgentResult;

#[tauri::command]
async fn run_prompt(prompt: String) -> Result<AgentResult, String> {
    // Scaffold: will wire to flinch_core agent loop
    Err("Not implemented".into())
}

#[tauri::command]
async fn cancel_run() -> Result<(), String> {
    // Scaffold: will signal cancellation
    Ok(())
}

#[tauri::command]
async fn check_blender() -> Result<bool, String> {
    // Scaffold: will run doctor check
    Ok(true)
}

#[tauri::command]
async fn list_sessions() -> Result<Vec<String>, String> {
    // Scaffold: will fetch from sqlite
    Ok(vec![])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            run_prompt,
            cancel_run,
            check_blender,
            list_sessions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
