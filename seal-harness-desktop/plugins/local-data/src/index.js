import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

export const name = 'seal-harness-local-data'
export const inject = []

const SCHEMA_VERSION = 6

export function openProductDatabase(home = resolveDshHome(process.env.DSH_HOME || join(homedir(), '.seal-harness'))) {
  mkdirSync(home, { recursive: true })
  const path = join(home, 'seal-harness.sqlite')
  const db = new DatabaseSync(path, { timeout: 5000 })
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')
    const version = db.prepare('PRAGMA user_version').get().user_version
    if (version > SCHEMA_VERSION) throw new Error(`数据库版本 ${version} 高于当前支持的版本 ${SCHEMA_VERSION}`)
    if (version < 1) {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.exec(`
          CREATE TABLE users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            display_name TEXT NOT NULL,
            password_salt BLOB NOT NULL,
            password_hash BLOB NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE projects (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            root_path TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (user_id, root_path)
          );
          CREATE INDEX projects_user_updated ON projects(user_id, updated_at DESC);
          CREATE TABLE experts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            manifest_json TEXT NOT NULL,
            package_blob BLOB NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (user_id, name, version)
          );
          CREATE INDEX experts_user_name ON experts(user_id, name);
          CREATE TABLE skills (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            metadata_json TEXT NOT NULL,
            archive_blob BLOB NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (user_id, name)
          );
          CREATE INDEX skills_user_name ON skills(user_id, name);
          CREATE TABLE import_journal (
            source TEXT PRIMARY KEY,
            imported_at TEXT NOT NULL
          );
          PRAGMA user_version = 1;
        `)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    if (version < 2) {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.exec(`
          CREATE TABLE expert_state (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            state_json TEXT NOT NULL,
            PRIMARY KEY (user_id, name)
          );
          CREATE TABLE skill_state (
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            state_json TEXT NOT NULL
          );
          PRAGMA user_version = 2;
        `)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    if (version < 3) {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.exec(`
          CREATE TABLE scheduled_tasks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            prompt TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            schedule_json TEXT NOT NULL,
            enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
            next_run_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
          CREATE INDEX scheduled_tasks_owner ON scheduled_tasks(user_id, created_at DESC);
          CREATE TABLE scheduled_runs (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
            task_name TEXT NOT NULL,
            session_id TEXT NOT NULL UNIQUE,
            session_available INTEGER NOT NULL DEFAULT 0 CHECK (session_available IN (0, 1)),
            fire_key TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'timeout', 'interrupted')),
            started_at INTEGER NOT NULL,
            finished_at INTEGER,
            error TEXT NOT NULL DEFAULT '',
            UNIQUE (task_id, fire_key)
          );
          CREATE UNIQUE INDEX scheduled_runs_active ON scheduled_runs(task_id) WHERE status = 'running';
          CREATE INDEX scheduled_runs_history ON scheduled_runs(task_id, started_at DESC);
          PRAGMA user_version = 3;
        `)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    if (version < 4) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE application_installations (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          app_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('installing', 'installed', 'uninstalling')),
          manifest_json TEXT NOT NULL DEFAULT '{}',
          installed_at TEXT NOT NULL,
          PRIMARY KEY (user_id, app_id)
        );
        PRAGMA user_version = 4;
        COMMIT;`)
    }
    if (version < 5) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE remembered_logins (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          token_hash BLOB NOT NULL UNIQUE,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        PRAGMA user_version = 5;
        COMMIT;`)
    }
    if (version < 6) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE organization_settings (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          company_name TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE organization_departments (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          parent_id TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (user_id, id),
          FOREIGN KEY (user_id, parent_id) REFERENCES organization_departments(user_id, id) ON DELETE RESTRICT
        );
        CREATE INDEX organization_departments_owner ON organization_departments(user_id, parent_id, sort_order);
        CREATE TABLE organization_people (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          department_id TEXT,
          job_title TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id, department_id) REFERENCES organization_departments(user_id, id) ON DELETE RESTRICT
        );
        CREATE INDEX organization_people_owner ON organization_people(user_id, department_id, name);
        PRAGMA user_version = 6;
        COMMIT;`)
    }
    return Object.freeze({
      path,
      db,
      transaction(operation) {
        db.exec('BEGIN IMMEDIATE')
        try {
          const value = operation(db)
          if (value && typeof value.then === 'function') throw new Error('SQLite 事务操作必须同步完成')
          db.exec('COMMIT')
          return value
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      },
      close() { db.close() },
    })
  } catch (error) {
    db.close()
    throw error
  }
}

export function apply(ctx) {
  const storage = openProductDatabase()
  ctx.provide('sealHarnessDatabase', storage)
  ctx.effect(() => () => storage.close(), 'seal-harness local database')
}
