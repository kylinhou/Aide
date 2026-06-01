use sqlx::SqlitePool;
use loro::LoroDoc;

pub struct MemoryManager;

impl MemoryManager {
    // Load a Loro CRDT document from the database
    pub async fn load_session(pool: &SqlitePool, session_id: &str) -> Result<LoroDoc, String> {
        let row: Option<(Vec<u8>,)> = sqlx::query_as(
            "SELECT snapshot FROM session_store WHERE id = ?"
        )
        .bind(session_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Database load error: {}", e))?;

        let doc = LoroDoc::new();
        if let Some((bytes,)) = row {
            if !bytes.is_empty() {
                doc.import(&bytes)
                    .map_err(|e| format!("Failed to import Loro snapshot: {}", e))?;
            }
        }
        Ok(doc)
    }

    // Save a Loro CRDT document's binary snapshot to the database
    pub async fn save_session(
        pool: &SqlitePool,
        session_id: &str,
        title: &str,
        doc: &LoroDoc
    ) -> Result<(), String> {
        let snapshot = doc.export_snapshot();

        sqlx::query(
            "INSERT OR REPLACE INTO session_store (id, title, snapshot, updated_at)
             VALUES (?, ?, ?, datetime('now'))"
        )
        .bind(session_id)
        .bind(title)
        .bind(snapshot)
        .execute(pool)
        .await
        .map_err(|e| format!("Database save error: {}", e))?;

        Ok(())
    }

    // Delete a session physically from database
    pub async fn delete_session(pool: &SqlitePool, session_id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM session_store WHERE id = ?")
            .bind(session_id)
            .execute(pool)
            .await
            .map_err(|e| format!("Database delete error: {}", e))?;
        Ok(())
    }
}
