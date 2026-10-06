use crate::agent::loop_logic::{AgentResult, AttemptRecord};
use rusqlite::{Connection, Result as SqlResult};
use serde_json;
use std::path::Path;
use uuid::Uuid;

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn new<P: AsRef<Path>>(db_path: P) -> SqlResult<Self> {
        let conn = Connection::open(db_path)?;
        // Enable foreign key enforcement
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        let store = Self { conn };
        store.init_schema()?;
        Ok(store)
    }

    fn init_schema(&self) -> SqlResult<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                prompt TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL
            );
            CREATE TABLE IF NOT EXISTS attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                attempt_number INTEGER NOT NULL,
                script TEXT NOT NULL,
                raw_response TEXT NOT NULL,
                harness_result TEXT,
                FOREIGN KEY(session_id) REFERENCES sessions(id)
            );",
        )?;
        Ok(())
    }

    /// Saves a session and all its attempts atomically within a transaction.
    pub fn save_session(&self, prompt: &str, result: &AgentResult) -> SqlResult<String> {
        let session_id = Uuid::new_v4().to_string();

        // Use a transaction to ensure atomic persistence
        let tx = self.conn.unchecked_transaction()?;

        tx.execute(
            "INSERT INTO sessions (id, prompt, success) VALUES (?1, ?2, ?3)",
            (&session_id, prompt, result.success),
        )?;

        for (i, attempt) in result.attempts.iter().enumerate() {
            let hr_json = attempt
                .harness_result
                .as_ref()
                .map(|hr| serde_json::to_string(hr).unwrap_or_default());
            tx.execute(
                "INSERT INTO attempts (session_id, attempt_number, script, raw_response, harness_result)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                (
                    &session_id,
                    (i as i32) + 1,
                    &attempt.script,
                    &attempt.raw_response,
                    hr_json,
                ),
            )?;
        }

        tx.commit()?;
        Ok(session_id)
    }

    pub fn list_sessions(&self) -> SqlResult<Vec<(String, String, bool, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, prompt, success, created_at FROM sessions ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        Ok(sessions)
    }

    pub fn get_session(&self, session_id: &str) -> SqlResult<AgentResult> {
        let mut stmt = self
            .conn
            .prepare("SELECT success FROM sessions WHERE id = ?1")?;
        let success: bool = stmt.query_row([session_id], |row| row.get(0))?;

        let mut stmt = self.conn.prepare(
            "SELECT script, raw_response, harness_result FROM attempts WHERE session_id = ?1 ORDER BY attempt_number ASC",
        )?;
        let rows = stmt.query_map([session_id], |row| {
            let script: String = row.get(0)?;
            let raw_response: String = row.get(1)?;
            let hr_str: Option<String> = row.get(2)?;
            let harness_result = hr_str.and_then(|s| serde_json::from_str(&s).ok());
            Ok(AttemptRecord {
                prompt: String::new(),
                raw_response,
                script,
                harness_result,
            })
        })?;

        let mut attempts = Vec::new();
        for row in rows {
            attempts.push(row?);
        }

        Ok(AgentResult { success, attempts })
    }
}
