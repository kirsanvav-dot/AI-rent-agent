const axios = require('axios');

const {
  REALTYCALENDAR_API_URL,
  REALTYCALENDAR_API_TOKEN,
  REALTYCALENDAR_OBJECT_ID,
} = process.env;

const isDemoMode = !REALTYCALENDAR_API_URL || !REALTYCALENDAR_API_TOKEN;

if (isDemoMode) {
  console.log('[realtycalendar] 🎭 DEMO MODE — реальные запросы к RC API не отправляются');
}

const rc = axios.create({
  baseURL: REALTYCALENDAR_API_URL || 'https://realtycalendar.ru/api/v2',
  timeout: 15_000,
});

// ─── Публичные функции ────────────────────────────────────────────────────────

/**
 * Блокирует даты объекта в RealtyCalendar (исходящий API).
 * Сервис не проверяет source брони — защита от петли в роуте (NFR-8).
 *
 * TODO: Точный контракт RC API не подтверждён документацией (риск R-04 в CHANGE_REQUEST).
 *       Текущая реализация — гипотеза: POST /objects/{objectId}/block
 *       с телом { date_from, date_to, external_ref }.
 *       Уточнить у RC support и обновить путь/формат при получении документации.
 *
 * @param {object} params
 * @param {string} [params.objectId] — ID объекта в RC; fallback: REALTYCALENDAR_OBJECT_ID
 * @param {string} params.dateFrom — 'YYYY-MM-DD'
 * @param {string} params.dateTo   — 'YYYY-MM-DD'
 * @param {string} params.externalRef — внешний ID (например Notion pageId)
 * @returns {Promise<{ rcBookingId: string }>}
 */
async function blockDates({ objectId, dateFrom, dateTo, externalRef }) {
  const objId = objectId || REALTYCALENDAR_OBJECT_ID;

  console.log(`[realtycalendar] blockDates: objectId=${objId} ${dateFrom}→${dateTo}`);

  if (isDemoMode) {
    console.log(`[realtycalendar] [DEMO] blockDates: objectId=${objId}, ${dateFrom} → ${dateTo} ✓ (не отправлено)`);
    return { rcBookingId: `DEMO-${externalRef || 'mock'}` };
  }

  try {
    const response = await rc.post(
      `/objects/${objId}/block`,
      {
        date_from: dateFrom,
        date_to: dateTo,
        external_ref: externalRef,
      },
      {
        headers: {
          Authorization: `Bearer ${REALTYCALENDAR_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const rcBookingId =
      response.data?.id ||
      response.data?.booking_id ||
      response.data?.rcBookingId;

    if (!rcBookingId) {
      throw new Error('RC API не вернул rcBookingId');
    }

    console.log(`[realtycalendar] blockDates: успех, rcBookingId=${rcBookingId}`);
    return { rcBookingId: String(rcBookingId) };
  } catch (err) {
    console.error(`[realtycalendar] Ошибка blockDates: ${err.message}`);
    throw err;
  }
}

module.exports = {
  blockDates,
};
