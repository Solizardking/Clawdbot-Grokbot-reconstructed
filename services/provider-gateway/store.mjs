import { DatabaseSync } from 'node:sqlite';

export function createGatewayStore(path) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS composio_sessions (
      user_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, session_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS desktops (
      user_id TEXT PRIMARY KEY, sandbox_id TEXT, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_usage (
      user_id TEXT NOT NULL, day TEXT NOT NULL, requests INTEGER NOT NULL,
      PRIMARY KEY(user_id, day)
    );
    CREATE TABLE IF NOT EXISTS resources (
      provider TEXT NOT NULL, kind TEXT NOT NULL, resource_id TEXT NOT NULL,
      user_id TEXT NOT NULL, PRIMARY KEY(provider, kind, resource_id)
    );`);
  // Existing installations retain their account-scoped desktop as the legacy
  // empty context. A running desktop is never silently reassigned to a bot.
  if (!db.prepare('PRAGMA table_info(desktops)').all().some(column => column.name === 'context_id')) {
    db.exec("ALTER TABLE desktops ADD COLUMN context_id TEXT NOT NULL DEFAULT ''");
  }
  const read = db.prepare('SELECT requests FROM daily_usage WHERE user_id=? AND day=?');
  const reserve = db.prepare(`INSERT INTO daily_usage(user_id,day,requests) VALUES(?,?,1)
    ON CONFLICT(user_id,day) DO UPDATE SET requests=requests+1
    WHERE requests < ? RETURNING requests`);
  return {
    composioSession(userId, fingerprint) {
      return db.prepare('SELECT session_id FROM composio_sessions WHERE user_id=? AND fingerprint=?').get(userId, fingerprint)?.session_id;
    },
    bindComposioSession(userId, fingerprint, sessionId) {
      db.prepare('INSERT INTO composio_sessions VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET fingerprint=excluded.fingerprint,session_id=excluded.session_id').run(userId, fingerprint, sessionId);
    },
    desktop(userId) {
      return db.prepare('SELECT sandbox_id AS id, expires_at AS expiresAt, context_id AS contextId FROM desktops WHERE user_id=?').get(userId);
    },
    reserveDesktop(userId, time, expiresAt, contextId = '') {
      return Boolean(db.prepare(`INSERT INTO desktops(user_id,sandbox_id,expires_at,context_id) VALUES(?,NULL,?,?)
        ON CONFLICT(user_id) DO UPDATE SET sandbox_id=NULL,expires_at=excluded.expires_at,context_id=excluded.context_id
        WHERE expires_at <= ? RETURNING user_id`).get(userId, expiresAt, contextId, time));
    },
    bindDesktop(userId, expiresAt, id) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid sandbox identifier');
      if (!db.prepare('UPDATE desktops SET sandbox_id=? WHERE user_id=? AND expires_at=? AND sandbox_id IS NULL RETURNING user_id').get(id, userId, expiresAt)) throw new Error('Desktop reservation conflict');
    },
    clearDesktop(userId, id) {
      db.prepare('DELETE FROM desktops WHERE user_id=? AND sandbox_id=?').run(userId, id);
    },
    owns(userId, provider, kind, id) {
      return db.prepare('SELECT user_id FROM resources WHERE provider=? AND kind=? AND resource_id=?').get(provider, kind, id)?.user_id === userId;
    },
    claim(userId, provider, resources) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const { kind, id } of resources) {
          if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid resource identifier');
          const owner = db.prepare('SELECT user_id FROM resources WHERE provider=? AND kind=? AND resource_id=?').get(provider, kind, id)?.user_id;
          if (owner && owner !== userId) throw new Error('Resource ownership conflict');
          db.prepare('INSERT OR IGNORE INTO resources(provider,kind,resource_id,user_id) VALUES(?,?,?,?)').run(provider, kind, id, userId);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    usage(userId, time) {
      const day = new Date(time).toISOString().slice(0, 10);
      return { day, requests: read.get(userId, day)?.requests ?? 0 };
    },
    reserve(userId, time, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid daily quota');
      const day = new Date(time).toISOString().slice(0, 10);
      return Boolean(reserve.get(userId, day, limit));
    },
    close() { db.close(); },
  };
}
