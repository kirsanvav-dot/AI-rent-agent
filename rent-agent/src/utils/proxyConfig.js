/**
 * Прокси для исходящих запросов к api.telegram.org (RU-серверы без прямого доступа).
 * TELEGRAM_PROXY: socks5://127.0.0.1:10808 или http://host:port
 */

function getTelegramProxyUrl() {
  const url = process.env.TELEGRAM_PROXY?.trim();
  return url || '';
}

function isSocksProxy(url) {
  return /^socks/i.test(url);
}

function buildRequestOptionsForTelegramBot() {
  const proxy = getTelegramProxyUrl();
  if (!proxy) return {};

  if (isSocksProxy(proxy)) {
    const { SocksProxyAgent } = require('socks-proxy-agent');
    const agent = new SocksProxyAgent(proxy);
    return { agent, proxy: false };
  }

  return { proxy };
}

function buildAxiosProxyConfig() {
  const proxy = getTelegramProxyUrl();
  if (!proxy) return {};

  if (isSocksProxy(proxy)) {
    const { SocksProxyAgent } = require('socks-proxy-agent');
    const agent = new SocksProxyAgent(proxy);
    return { httpAgent: agent, httpsAgent: agent, proxy: false };
  }

  return { proxy };
}

module.exports = {
  getTelegramProxyUrl,
  buildRequestOptionsForTelegramBot,
  buildAxiosProxyConfig,
};
