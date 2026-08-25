const { db, run, all, get } = require('../index');

module.exports = {
  name: "006_email_verification",
  up: ()=>{db.exec(`
        ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 1;
        CREATE TABLE user_verifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_user_verifications_user ON user_verifications(user_id);
      `)},
};
