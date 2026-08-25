const { db } = require('../index');

module.exports = {
  name: '042_restore_agent_withdrawals_created_idx',
  up: () => {
    // أُسقط هذا الفهرس عرضاً عند إعادة بناء جدول agent_withdrawals في 040؛ نعيده هنا.
    db.exec('CREATE INDEX IF NOT EXISTS idx_agent_withdrawals_created ON agent_withdrawals(created_at);');
  },
};
