const { db, run, all, get } = require('../index');

module.exports = {
  name: "004_indexes",
  up: ()=>{db.exec(`
        CREATE INDEX IF NOT EXISTS idx_bookings_order ON bookings(order_id);
        CREATE INDEX IF NOT EXISTS idx_bookings_provider ON bookings(provider_id);
        CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in, check_out);
        CREATE INDEX IF NOT EXISTS idx_orders_gov_status ON orders(governorate_id, status);
        CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
        CREATE INDEX IF NOT EXISTS idx_lease_payments_agent ON lease_payments(agent_id);
        CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
      `)},
};
