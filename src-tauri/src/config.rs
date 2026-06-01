use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;
use serde::{Serialize, Deserialize};

pub struct DbState {
    pub pool: SqlitePool,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct SubAgent {
    pub agent_id: String,
    pub name: String,
    pub path: String,
    pub version: String,
    pub env_vars: Option<String>, // JSON string of env key-values
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub workspace_path: String,
    pub agent_id: String,
    pub messages: String, // JSON string formatted messages list
    pub updated_at: Option<String>,
}

pub async fn init_db(app_dir: &PathBuf) -> Result<SqlitePool, sqlx::Error> {
    // 1. Create data directory if it doesn't exist
    let data_dir = app_dir.join("data");
    fs::create_dir_all(&data_dir).ok();

    let db_path = data_dir.join("aide.db");
    let db_url = format!("sqlite:{}", db_path.to_string_lossy());

    // 2. Configure connection options with WAL mode enabled
    let options = SqliteConnectOptions::from_str(&db_url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

    let pool = SqlitePool::connect_with(options).await?;

    // 3. Execute migrations / table creation query
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS system_config (
            config_key TEXT PRIMARY KEY,
            config_value TEXT NOT NULL
        );"
    ).execute(&pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS session_store (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            snapshot BLOB,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS chat_sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            workspace_path TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            messages TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS sub_agent_registry (
            agent_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            version TEXT NOT NULL,
            env_vars TEXT
        );"
    ).execute(&pool).await?;

    // 4. Inject seed data if the registry is empty
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sub_agent_registry")
        .fetch_one(&pool)
        .await?;

    if count.0 == 0 {
        sqlx::query(
            "INSERT INTO sub_agent_registry (agent_id, name, path, version, env_vars)
             VALUES ('claude-code', 'Claude Code', 'claude', '1.0.0', '{\"ANTHROPIC_API_KEY\":\"\"}');"
        ).execute(&pool).await?;
    }

    Ok(pool)
}

// Helpers for settings retrieval and saving
pub async fn get_config(pool: &SqlitePool, key: &str) -> Option<String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT config_value FROM system_config WHERE config_key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
    row.map(|r| r.0)
}

pub async fn set_config(pool: &SqlitePool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT OR REPLACE INTO system_config (config_key, config_value) VALUES (?, ?)"
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_registered_agents(pool: &SqlitePool) -> Result<Vec<SubAgent>, sqlx::Error> {
    sqlx::query_as::<_, SubAgent>(
        "SELECT agent_id, name, path, version, env_vars FROM sub_agent_registry"
    )
    .fetch_all(pool)
    .await
}

pub async fn save_registered_agent(pool: &SqlitePool, agent: &SubAgent) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT OR REPLACE INTO sub_agent_registry (agent_id, name, path, version, env_vars)
         VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&agent.agent_id)
    .bind(&agent.name)
    .bind(&agent.path)
    .bind(&agent.version)
    .bind(&agent.env_vars)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_registered_agent(pool: &SqlitePool, agent_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM sub_agent_registry WHERE agent_id = ?")
        .bind(agent_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_chat_sessions(pool: &SqlitePool) -> Result<Vec<ChatSession>, sqlx::Error> {
    sqlx::query_as::<_, ChatSession>(
        "SELECT id, title, workspace_path, agent_id, messages, datetime(updated_at, 'localtime') as updated_at FROM chat_sessions ORDER BY updated_at DESC"
    )
    .fetch_all(pool)
    .await
}

pub async fn save_chat_session(pool: &SqlitePool, session: &ChatSession) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT OR REPLACE INTO chat_sessions (id, title, workspace_path, agent_id, messages, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', 'utc'))"
    )
    .bind(&session.id)
    .bind(&session.title)
    .bind(&session.workspace_path)
    .bind(&session.agent_id)
    .bind(&session.messages)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_chat_session(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM chat_sessions WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

