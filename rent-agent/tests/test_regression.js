/**
 * Сводный регрессионный раннер.
 * Запуск: node tests/test_regression.js
 *
 * Запускает все регрессионные тесты в ИЗОЛИРОВАННЫХ процессах через child_process.
 * Изоляция нужна потому, что каждый тест:
 *   - устанавливает свои process.env
 *   - подменяет методы на require-кешированных объектах сервисов
 * Внутри одного процесса они конфликтуют.
 *
 * Назначение раннера:
 *   - один прогон перед коммитом для проверки, что текущее поведение не нарушено
 *   - используется в чек-листе из AGENTS.md / CHANGE_REQUEST.md как baseline
 */

const path = require('path');
const { spawnSync } = require('child_process');

const SUITES = [
  'test_route_realtycalendar.js',
  'test_route_telegram.js',
  'test_route_avito.js',
  'test_service_telegram.js',
];

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED   = (s) => `\x1b[31m${s}\x1b[0m`;
const BOLD  = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM   = (s) => `\x1b[2m${s}\x1b[0m`;

console.log(BOLD('\n════════════════════════════════════════════════════════════════'));
console.log(BOLD('  Регрессионный прогон: baseline текущего поведения'));
console.log(BOLD('════════════════════════════════════════════════════════════════'));

let totalPassed = 0;
let totalFailed = 0;
const summary = [];

for (const suite of SUITES) {
  const fullPath = path.join(__dirname, suite);
  const result = spawnSync('node', [fullPath], { encoding: 'utf8' });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  // Извлекаем "X прошло, Y упало" из последних строк stdout
  const m = stdout.match(/Итог:\s*(\d+)\s*прошло,\s*(\d+)\s*упало/);
  const passed = m ? parseInt(m[1], 10) : 0;
  const failed = m ? parseInt(m[2], 10) : 0;

  totalPassed += passed;
  totalFailed += failed;

  const ok = result.status === 0 && failed === 0;
  const mark = ok ? GREEN('✓') : RED('✗');
  console.log(`\n${mark} ${BOLD(suite)}  ${DIM(`(${passed} прошло, ${failed} упало)`)}`);

  if (!ok) {
    console.log(stdout);
    if (stderr) console.error(RED(stderr));
  }

  summary.push({ suite, passed, failed, ok });
}

console.log(BOLD('\n════════════════════════════════════════════════════════════════'));
for (const s of summary) {
  const mark = s.ok ? GREEN('  ✓') : RED('  ✗');
  console.log(`${mark} ${s.suite.padEnd(40)} ${s.passed} прошло, ${s.failed} упало`);
}
console.log(BOLD('────────────────────────────────────────────────────────────────'));
console.log(BOLD(`  ИТОГО: ${totalPassed} прошло, ${totalFailed} упало`));
console.log(BOLD('════════════════════════════════════════════════════════════════\n'));

if (totalFailed === 0 && summary.every((s) => s.ok)) {
  console.log(GREEN('✅ Baseline зелёный. Текущее поведение зафиксировано.\n'));
  process.exit(0);
} else {
  console.log(RED('❌ Регрессия обнаружена. Подробности — выше.\n'));
  process.exit(1);
}
