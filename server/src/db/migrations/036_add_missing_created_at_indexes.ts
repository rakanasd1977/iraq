const { db, run, all, get } = require('../index');

module.exports = {
  name: "036_add_missing_created_at_indexes",
  up: ()=>{run("CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)");run("CREATE INDEX IF NOT EXISTS idx_orders_created_at_status ON orders(created_at, status)");run("CREATE INDEX IF NOT EXISTS idx_wallet_tx_created ON wallet_transactions(created_at)");run("CREATE INDEX IF NOT EXISTS idx_recharge_requests_created ON recharge_requests(created_at)");run("CREATE INDEX IF NOT EXISTS idx_agent_withdrawals_created ON agent_withdrawals(created_at)")},
};
