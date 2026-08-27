// ===== سوق الرافدين — PM2 لخادم الواجهة (API) =====
// الاستخدام:  pm2 start deploy/ecosystem.config.js --env production
// السجلات:     pm2 logs rafidain-server
// الحفظ:       pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'rafidain-server',
      cwd: __dirname + '/../server',
      script: 'npm',
      args: 'start',
      instances: 1, // الخادم يُجمّع عملياته داخلياً عبر CLUSTER_WORKERS؛ ابقِ pm2 بعدد 1
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 4001,
      },
      // env_production تُدمج فوق env عند --env production
      env_production: {
        NODE_ENV: 'production',
      },
      out_file: 'logs/rafidain-out.log',
      error_file: 'logs/rafidain-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
