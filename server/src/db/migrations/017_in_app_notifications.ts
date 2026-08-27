const { db, run, all, get } = require('../index');

module.exports = {
  name: "017_in_app_notifications",
  up: ()=>{db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL DEFAULT 'order',
          title TEXT NOT NULL,
          body TEXT,
          url TEXT,
          icon TEXT,
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);db.exec("CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, id DESC);")},
};
