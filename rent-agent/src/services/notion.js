const { Client } = require('@notionhq/client');

const { NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.warn('[notion] NOTION_TOKEN / NOTION_DATABASE_ID не заданы — модуль будет падать при вызовах');
}

const notion = new Client({ auth: NOTION_TOKEN });

// ─── Вспомогательные функции ──────────────────────────────────────────────────

/**
 * Нормализует телефон до последних 10 цифр.
 * Правила: убрать всё кроме цифр, заменить ведущую 8 → 7, взять последние 10 цифр.
 * @param {string} phone
 * @returns {string} 10 цифр
 */
function normalizePhoneDigits(phone) {
  let digits = String(phone).replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') digits = '7' + digits.slice(1);
  return digits.slice(-10);
}

/**
 * Маппинг объекта BookingData → формат свойств Notion API.
 * Все поля опциональны: включается только то, что присутствует в data (не undefined).
 * Это позволяет использовать функцию как для create (полный объект), так и для
 * partial update (только изменяемые поля) без дублирования маппинга.
 *
 * @param {object} data
 * @returns {object} properties для notion.pages.create / update
 */
function buildNotionProperties(data) {
  const props = {};

  if (data.bookingId !== undefined)
    props['ID Брони'] = { title: [{ text: { content: String(data.bookingId) } }] };

  if (data.guestName !== undefined)
    props['Имя клиента'] = { rich_text: [{ text: { content: data.guestName || '' } }] };

  if (data.phone !== undefined)
    props['Телефон'] = { phone_number: data.phone || null };

  if (data.apartment !== undefined)
    props['Квартира'] = { rich_text: [{ text: { content: data.apartment || 'Не указано' } }] };

  if (data.source !== undefined)
    props['Источник'] = { select: { name: data.source || 'Другое' } };

  if (data.totalPrice !== undefined)
    props['Сумма'] = { number: typeof data.totalPrice === 'number' ? data.totalPrice : null };

  if (data.status !== undefined)
    props['Статус'] = { select: { name: data.status || 'Подтверждена' } };

  if (data.dateFrom)
    props['Даты'] = { date: { start: data.dateFrom, end: data.dateTo || data.dateFrom } };

  if (data.telegramChatId != null)
    props['Telegram chat_id'] = { number: Number(data.telegramChatId) };

  if (data.avitoItemId)
    props['Авито item_id'] = { rich_text: [{ text: { content: String(data.avitoItemId) } }] };

  if (data.avitoChatId)
    props['Авито chat_id'] = { rich_text: [{ text: { content: String(data.avitoChatId) } }] };

  if (data.notes)
    props['Заметки'] = { rich_text: [{ text: { content: String(data.notes) } }] };

  if (data.rcSynced !== undefined)
    props['Синхронизировано с RC'] = { checkbox: Boolean(data.rcSynced) };

  return props;
}

/**
 * Извлекает удобный объект из страницы Notion.
 * @param {object} page — объект страницы из Notion API
 * @returns {object}
 */
function parseNotionPage(page) {
  const p = page.properties;

  const getText = (field) =>
    p[field]?.rich_text?.[0]?.plain_text || '';
  const getTitle = (field) =>
    p[field]?.title?.[0]?.plain_text || '';
  const getSelect = (field) =>
    p[field]?.select?.name || '';
  const getNumber = (field) =>
    p[field]?.number ?? null;
  const getPhone = (field) =>
    p[field]?.phone_number || '';
  const getDate = (field) => ({
    start: p[field]?.date?.start || null,
    end: p[field]?.date?.end || null,
  });

  return {
    pageId: page.id,
    bookingId: getTitle('ID Брони'),
    guestName: getText('Имя клиента'),
    phone: getPhone('Телефон'),
    apartment: getText('Квартира'),
    source: getSelect('Источник'),
    totalPrice: getNumber('Сумма'),
    status: getSelect('Статус'),
    dates: getDate('Даты'),
    telegramChatId: getNumber('Telegram chat_id'),
    avitoItemId: getText('Авито item_id'),
    avitoChatId: getText('Авито chat_id'),
    notes: getText('Заметки'),
    rcSynced: p['Синхронизировано с RC']?.checkbox ?? false,
  };
}

// ─── Публичные функции ────────────────────────────────────────────────────────

/**
 * Создаёт запись о брони в Notion.
 * Перед созданием проверяет дубликат по полю «ID Брони».
 *
 * @param {object} data — объект BookingData (см. SPECIFICATION §7.3)
 * @returns {object} созданная или существующая запись
 */
async function createBooking(data) {
  console.log(`[notion] createBooking: ${data.bookingId}`);

  // Дедупликация: проверяем, нет ли уже такой брони
  const existing = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: 'ID Брони',
      title: { equals: String(data.bookingId) },
    },
  });

  if (existing.results.length > 0) {
    console.log(`[notion] Бронь ${data.bookingId} уже существует, пропускаем создание`);
    return parseNotionPage(existing.results[0]);
  }

  const page = await notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    properties: buildNotionProperties(data),
  });

  console.log(`[notion] Бронь создана: pageId=${page.id}, bookingId=${data.bookingId}`);
  return parseNotionPage(page);
}

/**
 * Ищет бронь по Telegram chat_id гостя.
 * Возвращает самую свежую активную бронь или null.
 *
 * @param {number|string} chatId
 * @returns {object|null}
 */
async function findBookingByChatId(chatId) {
  console.log(`[notion] findBookingByChatId: chatId=${chatId}`);

  const response = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: 'Telegram chat_id',
      number: { equals: Number(chatId) },
    },
    sorts: [{ property: 'Даты', direction: 'descending' }],
    page_size: 1,
  });

  if (response.results.length === 0) {
    console.log(`[notion] Бронь для chatId=${chatId} не найдена`);
    return null;
  }

  const booking = parseNotionPage(response.results[0]);
  console.log(`[notion] Бронь найдена: bookingId=${booking.bookingId}, гость=${booking.guestName}`);
  return booking;
}

/**
 * Обновляет статус брони по её pageId в Notion.
 *
 * @param {string} pageId — Notion page ID (не bookingId)
 * @param {string} status — новый статус (из допустимых значений SPECIFICATION §7.2)
 * @returns {object} обновлённая запись
 */
async function updateBookingStatus(pageId, status) {
  console.log(`[notion] updateBookingStatus: pageId=${pageId}, status=${status}`);

  const page = await notion.pages.update({
    page_id: pageId,
    properties: {
      'Статус': { select: { name: status } },
    },
  });

  console.log(`[notion] Статус обновлён: pageId=${pageId} → ${status}`);
  return parseNotionPage(page);
}

// ─── Новые функции (аддитивно) ────────────────────────────────────────────────

/**
 * Ищет бронь по полю «ID Брони» (title).
 * Нормализует пробелы; сравнение точное (регистр сохраняется как в Notion).
 *
 * @param {string} bookingId
 * @returns {object|null}
 */
async function findBookingByBookingId(bookingId) {
  const normalized = String(bookingId).trim().replace(/\s+/g, ' ');
  console.log(`[notion] findBookingByBookingId: id=${normalized}`);

  const response = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: 'ID Брони',
      title: { equals: normalized },
    },
    page_size: 1,
  });

  if (response.results.length === 0) {
    console.log(`[notion] findBookingByBookingId: id=${normalized} не найден`);
    return null;
  }

  const booking = parseNotionPage(response.results[0]);
  console.log(`[notion] findBookingByBookingId: id=${normalized} found pageId=${booking.pageId}`);
  return booking;
}

/**
 * Ищет бронь по номеру телефона с нормализацией:
 * убрать всё кроме цифр, ведущую 8 → 7, сравнивать последние 10 цифр.
 *
 * @param {string} phone
 * @returns {object|null}
 */
async function findBookingByPhone(phone) {
  const last10 = normalizePhoneDigits(phone);
  console.log(`[notion] findBookingByPhone: phone=${phone} → last10=${last10}`);

  const response = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: 'Телефон',
      phone_number: { contains: last10 },
    },
    page_size: 10,
  });

  if (response.results.length === 0) {
    console.log(`[notion] findBookingByPhone: не найден для last10=${last10}`);
    return null;
  }

  for (const result of response.results) {
    const booking = parseNotionPage(result);
    if (normalizePhoneDigits(booking.phone) === last10) {
      console.log(`[notion] findBookingByPhone: найден pageId=${booking.pageId}, гость=${booking.guestName}`);
      return booking;
    }
  }

  console.log(`[notion] findBookingByPhone: не найден для last10=${last10}`);
  return null;
}

/**
 * Ищет бронь по полю «Авито chat_id».
 *
 * @param {string} chatId
 * @returns {object|null}
 */
async function findBookingByAvitoChatId(chatId) {
  console.log(`[notion] findBookingByAvitoChatId: chatId=${chatId}`);

  const response = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: 'Авито chat_id',
      rich_text: { equals: String(chatId) },
    },
    page_size: 1,
  });

  if (response.results.length === 0) {
    console.log(`[notion] findBookingByAvitoChatId: chatId=${chatId} не найден`);
    return null;
  }

  const booking = parseNotionPage(response.results[0]);
  console.log(`[notion] findBookingByAvitoChatId: chatId=${chatId} found pageId=${booking.pageId}`);
  return booking;
}

/**
 * Обновляет произвольный набор полей брони.
 * Строит properties через buildNotionProperties — маппинг не дублируется.
 * Передавать только те поля, которые нужно изменить.
 *
 * @param {string} pageId — Notion page ID
 * @param {object} fields — частичный BookingData (только изменяемые поля)
 * @returns {object} обновлённая запись
 */
async function updateBookingFields(pageId, fields) {
  const keys = Object.keys(fields).join(', ');
  console.log(`[notion] updateBookingFields: pageId=${pageId}, fields=[${keys}]`);

  const page = await notion.pages.update({
    page_id: pageId,
    properties: buildNotionProperties(fields),
  });

  console.log(`[notion] updateBookingFields: обновлено pageId=${pageId}`);
  return parseNotionPage(page);
}

module.exports = {
  createBooking,
  findBookingByChatId,
  updateBookingStatus,
  findBookingByBookingId,
  findBookingByPhone,
  findBookingByAvitoChatId,
  updateBookingFields,
};
