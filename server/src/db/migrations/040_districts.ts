const { db } = require('../index');

module.exports = {
  name: '040_districts',
  up: () => {
    db.exec(`
      CREATE TABLE districts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        governorate_id INTEGER NOT NULL REFERENCES governorates(id) ON DELETE CASCADE,
        name_ar TEXT NOT NULL,
        name_en TEXT NOT NULL,
        code TEXT NOT NULL,
        lease_fee REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        lat REAL,
        lng REAL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (governorate_id, code)
      );

      CREATE INDEX idx_districts_gov ON districts(governorate_id);
      CREATE INDEX idx_districts_active ON districts(is_active);
    `);

    // إعادة بناء جدول agents: إسقاط القيد الفريد على المحافظة (الذي يمنع وكيلين في نفس المحافظة)
    // والسماح بوكيل مستوى محافظة (district_id IS NULL) ووكيل لكل قضاء (district_id معيّن).
    // يُستخدم إعادة التسمية بدل تعطيل المفاتيح الأجنبية (لا يُسمح بتعطيلها داخل معاملة).
    db.exec(`
      ALTER TABLE agents RENAME TO agents_old;

      CREATE TABLE agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        governorate_id INTEGER NOT NULL REFERENCES governorates(id),
        district_id INTEGER REFERENCES districts(id),
        commission_rate REAL NOT NULL DEFAULT 2,
        lease_status TEXT NOT NULL DEFAULT 'pending' CHECK (lease_status IN ('active','expired','pending')),
        lease_expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO agents (id, user_id, governorate_id, commission_rate, lease_status, lease_expires_at, created_at, updated_at)
        SELECT id, user_id, governorate_id, commission_rate, lease_status, lease_expires_at, created_at, updated_at FROM agents_old;

      DROP TABLE agents_old;

      CREATE UNIQUE INDEX uniq_governorate_agent ON agents(governorate_id) WHERE district_id IS NULL;
      CREATE UNIQUE INDEX uniq_district_agent ON agents(district_id) WHERE district_id IS NOT NULL;
    `);

    // إعادة بناء lease_payments لتصحيح المفتاح الأجنبي نحو agents الجديد (إعادة التسمية تُورّث اسم الجدول القديم)
    // مع الحفاظ على الأعمدة/الفهارس المضافة لاحقاً (updated_at من 008، idx_lease_payments_agent من 004)
    db.exec(`
      ALTER TABLE lease_payments RENAME TO lease_payments_old;

      CREATE TABLE lease_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        governorate_id INTEGER NOT NULL REFERENCES governorates(id),
        district_id INTEGER REFERENCES districts(id),
        amount REAL NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected','refunded')),
        paid_at TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      INSERT INTO lease_payments (id, agent_id, governorate_id, district_id, amount, period_start, period_end, status, paid_at, notes, created_at, updated_at)
        SELECT id, agent_id, governorate_id,
               (SELECT NULL), amount, period_start, period_end, status, paid_at, notes, created_at,
               COALESCE(updated_at, created_at)
        FROM lease_payments_old;

      DROP TABLE lease_payments_old;

      CREATE INDEX idx_lease_payments_agent ON lease_payments(agent_id);
      CREATE INDEX idx_lease_payments_district ON lease_payments(district_id);
    `);

    // إعادة بناء agent_withdrawals لتصحيح المفتاح الأجنبي نحو agents الجديد
    db.exec(`
      ALTER TABLE agent_withdrawals RENAME TO agent_withdrawals_old;

      CREATE TABLE agent_withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        amount REAL NOT NULL CHECK(amount > 0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
        notes TEXT,
        decided_by INTEGER REFERENCES users(id),
        decided_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO agent_withdrawals (id, agent_id, amount, status, notes, decided_by, decided_at, created_at)
        SELECT id, agent_id, amount, status, notes, decided_by, decided_at, created_at FROM agent_withdrawals_old;

      DROP TABLE agent_withdrawals_old;

      CREATE INDEX idx_agent_withdrawals_agent ON agent_withdrawals(agent_id, status);
      CREATE INDEX idx_agent_withdrawals_status ON agent_withdrawals(status);
    `);
  },
};
