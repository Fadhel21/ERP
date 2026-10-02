// Menjalankan semua tes (*.test.js) memakai node:test bawaan.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const folder = __dirname;
const berkas = fs.readdirSync(folder).filter((f) => f.endsWith('.test.js')).sort()
  .map((f) => path.join(folder, f));

const hasil = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...berkas], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test' },
});
process.exit(hasil.status === null ? 1 : hasil.status);
