const env = require('./config/env');
const app = require('./app');
const { pool } = require('./config/db');

const server = app.listen(env.port, () => {
  console.log(`ERP berjalan di http://localhost:${env.port}`);
});

function berhenti() {
  console.log('Menghentikan server...');
  server.close(() => pool.end().then(() => process.exit(0)));
}
process.on('SIGINT', berhenti);
process.on('SIGTERM', berhenti);
