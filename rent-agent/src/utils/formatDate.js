/**
 * Форматирует ISO-дату в читаемую русскую строку.
 * Используется для подстановки дат в LLM-контекст и Telegram-уведомления.
 *
 * @param {string} isoString — дата в формате 'YYYY-MM-DD' или ISO 8601
 * @returns {string} — например '20 июня 2026'
 */
function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  });
}

/**
 * Форматирует диапазон дат для уведомлений.
 * @param {string} from — ISO дата начала
 * @param {string} to   — ISO дата конца
 * @returns {string} — например '20–22 июня 2026'
 */
function formatDateRange(from, to) {
  if (!from || !to) return '';
  const start = new Date(from);
  const end = new Date(to);

  const sameMonthAndYear =
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear();

  if (sameMonthAndYear) {
    const day1 = start.getDate();
    const day2 = end.getDate();
    const monthYear = end.toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Moscow',
    });
    return `${day1}–${day2} ${monthYear}`;
  }

  return `${formatDate(from)} — ${formatDate(to)}`;
}

module.exports = { formatDate, formatDateRange };
