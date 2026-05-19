/**
 * Middleware: логирование входящих запросов.
 * Выводит метод, путь, IP и время обработки в мс.
 * Реализуется в Шаге 7 TRACKER.md.
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, path, ip } = req;

  res.on('finish', () => {
    const ms = Date.now() - start;
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${method} ${path} ${res.statusCode} — ${ms}ms  (${ip})`);
  });

  next();
}

module.exports = requestLogger;
