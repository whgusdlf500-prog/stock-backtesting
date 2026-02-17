const MAPPING_JSON_URL = "https://stock-backtesting-gmc.pages.dev/company-mappings.json";
const MAPPING_CACHE_TTL_MS = 10 * 60 * 1000;
const MARKET_UNIVERSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let mappingCache = { at: 0, data: null };
let universeCache = { at: 0, kr: null, us: null };

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    try {
      const url = new URL(request.url);
      const symbol = (url.searchParams.get("symbol") || "").trim();
      const market = (url.searchParams.get("market") || "").toLowerCase();
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");

      if (!symbol) {
        return jsonResponse({ error: "Missing symbol" }, 400);
      }

      const mappings = await loadMappings();

      let finalSymbol = symbol;
      if (!isTickerFormat(finalSymbol)) {
        const resolved = await resolveSymbolByMarket(finalSymbol, market, mappings);
        if (!resolved) {
          const suggestions = await fetchYahooSuggestions(finalSymbol, market);
          return jsonResponse({ error: "Company name not found", query: finalSymbol, market, suggestions }, 404);
        }
        finalSymbol = resolved;
      }

      const period1 = Number(from) || 0;
      const period2 = Number(to) || Math.floor(Date.now() / 1000);

      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?period1=${period1}&period2=${period2}&interval=1mo&events=history`;
      const upstream = await fetch(yahooUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      const data = await upstream.text();
      return new Response(data, {
        status: upstream.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Resolved-Symbol": finalSymbol,
          ...corsHeaders()
        }
      });
    } catch (error) {
      return jsonResponse({ error: "Worker error", message: String(error) }, 500);
    }
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Resolved-Symbol"
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function isTickerFormat(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  if (/^\^[A-Z0-9._-]+$/i.test(v)) return true;
  if (/^\d{6}\.(KS|KQ)$/i.test(v)) return true;
  return /^[A-Z][A-Z0-9.-]{0,10}$/i.test(v);
}

async function resolveSymbolByMarket(query, market, mappings) {
  const candidates = buildCandidateKeys(query);

  for (const key of candidates) {
    const dynamic = findSymbolInMappings(key, market, mappings);
    if (dynamic) return dynamic;
  }

  if (market === "kr") {
    for (const key of candidates) {
      const mapped = KR_NAME_TO_SYMBOL[key];
      if (mapped) return mapped;
    }
  }

  if (market === "us") {
    for (const key of candidates) {
      const mapped = US_NAME_TO_SYMBOL[key];
      if (mapped) return mapped;
    }
  }

  const universeMapped = await resolveFromMarketUniverse(candidates, market);
  if (universeMapped) return universeMapped;

  const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=20&newsCount=0`;
  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });
  if (!response.ok) return null;

  const json = await response.json();
  const quotes = Array.isArray(json?.quotes) ? json.quotes : [];

  const filtered = quotes.filter((q) => {
    const s = (q?.symbol || "").toUpperCase();
    if (!s) return false;
    if (market === "kr") return /\.(KS|KQ)$/.test(s);
    if (market === "us") return !s.includes(".") && (q?.quoteType === "EQUITY" || q?.quoteType === "ETF");
    return true;
  });

  if (!filtered.length) return null;

  const exact = filtered.find((q) => {
    const shortName = normalizeName(q?.shortname || "");
    const longName = normalizeName(q?.longname || "");
    return candidates.includes(shortName) || candidates.includes(longName);
  });
  if (exact?.symbol) return exact.symbol;

  const partial = filtered.find((q) => {
    const shortName = normalizeName(q?.shortname || "");
    const longName = normalizeName(q?.longname || "");
    return candidates.some((key) => shortName.includes(key) || longName.includes(key));
  });
  if (partial?.symbol) return partial.symbol;

  return filtered[0]?.symbol || null;
}

async function resolveFromMarketUniverse(candidates, market) {
  if (!candidates?.length) return null;
  if (market === "kr") {
    const kr = await loadKrUniverse();
    if (!kr) return null;
    for (const key of candidates) {
      const mapped = kr[key];
      if (mapped) return mapped;
    }
    return null;
  }
  if (market === "us") {
    const us = await loadSp500Universe();
    if (!us) return null;
    for (const key of candidates) {
      const mapped = us[key];
      if (mapped) return mapped;
    }
  }
  return null;
}

async function fetchYahooSuggestions(query, market) {
  try {
    const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
    const response = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!response.ok) return [];
    const json = await response.json();
    const quotes = Array.isArray(json?.quotes) ? json.quotes : [];
    return quotes
      .filter((q) => {
        const s = String(q?.symbol || "").toUpperCase();
        if (!s) return false;
        if (market === "kr") return /\.(KS|KQ)$/.test(s);
        if (market === "us") return !s.includes(".") && (q?.quoteType === "EQUITY" || q?.quoteType === "ETF");
        return true;
      })
      .slice(0, 5)
      .map((q) => ({
        symbol: String(q?.symbol || "").toUpperCase(),
        name: String(q?.shortname || q?.longname || "")
      }));
  } catch {
    return [];
  }
}

async function loadKrUniverse() {
  const now = Date.now();
  if (universeCache.kr && now - universeCache.at < MARKET_UNIVERSE_CACHE_TTL_MS) {
    return universeCache.kr;
  }

  try {
    const [kospiMap, kosdaqMap] = await Promise.all([
      fetchKrMarketMap("stockMkt", ".KS"),
      fetchKrMarketMap("kosdaqMkt", ".KQ")
    ]);
    const merged = { ...(kospiMap || {}), ...(kosdaqMap || {}) };
    universeCache.kr = merged;
    universeCache.at = now;
    return merged;
  } catch {
    return universeCache.kr;
  }
}

async function fetchKrMarketMap(marketType, suffix) {
  const url = `https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&marketType=${marketType}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://kind.krx.co.kr/"
    }
  });
  if (!res.ok) return {};

  const buf = await res.arrayBuffer();
  let html = "";
  try {
    html = new TextDecoder("euc-kr").decode(buf);
  } catch {
    html = new TextDecoder().decode(buf);
  }

  const map = {};
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html))) {
    const row = rowMatch[1];
    const tdMatches = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tdMatches.length < 2) continue;

    const rawName = stripHtml(tdMatches[0][1]);
    const rawCode = stripHtml(tdMatches[1][1]).replace(/\D/g, "");
    if (!rawName || rawCode.length !== 6) continue;

    const symbol = `${rawCode}${suffix}`;
    const keys = buildCandidateKeys(rawName);
    for (const key of keys) {
      map[key] = symbol;
    }
  }

  return map;
}

async function loadSp500Universe() {
  const now = Date.now();
  if (universeCache.us && now - universeCache.at < MARKET_UNIVERSE_CACHE_TTL_MS) {
    return universeCache.us;
  }

  try {
    const res = await fetch("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });
    if (!res.ok) return universeCache.us;
    const html = await res.text();
    const map = parseSp500FromWikipedia(html);
    universeCache.us = map;
    universeCache.at = now;
    return map;
  } catch {
    return universeCache.us;
  }
}

function parseSp500FromWikipedia(html) {
  const map = {};
  const tableMatch = html.match(/<table[^>]*id="constituents"[\s\S]*?<\/table>/i);
  if (!tableMatch) return map;

  const table = tableMatch[0];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(table))) {
    const row = rowMatch[1];
    const tdMatches = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tdMatches.length < 2) continue;

    const rawSymbol = stripHtml(tdMatches[0][1]).trim();
    const rawName = stripHtml(tdMatches[1][1]).trim();
    if (!rawSymbol || !rawName) continue;

    const symbol = rawSymbol.replace(/\./g, "-").toUpperCase();
    const keys = buildCandidateKeys(rawName);
    for (const key of keys) {
      map[key] = symbol;
    }
    map[normalizeName(symbol)] = symbol;
  }
  return map;
}

async function loadMappings() {
  const now = Date.now();
  if (mappingCache.data && now - mappingCache.at < MAPPING_CACHE_TTL_MS) {
    return mappingCache.data;
  }

  try {
    const res = await fetch(MAPPING_JSON_URL, {
      headers: {
        "Cache-Control": "no-cache"
      }
    });
    if (!res.ok) return mappingCache.data;

    const json = await res.json();
    const data = indexMappings(json);
    mappingCache = { at: now, data };
    return data;
  } catch {
    return mappingCache.data;
  }
}

function indexMappings(json) {
  const markets = json?.markets || {};
  const indexed = { kr: {}, us: {}, all: {} };

  for (const marketKey of ["kr", "us"]) {
    const list = Array.isArray(markets[marketKey]) ? markets[marketKey] : [];
    for (const row of list) {
      const symbol = String(row?.symbol || "").toUpperCase();
      if (!symbol) continue;

      const aliases = [row?.ko, row?.en, symbol].concat(Array.isArray(row?.aliases) ? row.aliases : []);
      for (const alias of aliases) {
        const k = normalizeName(alias || "");
        if (!k) continue;
        indexed[marketKey][k] = symbol;
        indexed.all[k] = symbol;
      }
    }
  }

  return indexed;
}

function findSymbolInMappings(normalizedQuery, market, mappings) {
  if (!mappings || !normalizedQuery) return null;
  if (market === "kr" || market === "us") {
    return mappings[market]?.[normalizedQuery] || null;
  }
  return mappings.all?.[normalizedQuery] || null;
}

function buildCandidateKeys(input) {
  const base = normalizeName(input);
  if (!base) return [];

  const transforms = [
    (v) => v.replace(/^주식회사/, ""),
    (v) => v.replace(/주식회사/g, ""),
    (v) => v.replace(/^엘지/, "lg"),
    (v) => v.replace(/엘지/g, "lg"),
    (v) => v.replace(/^에스케이/, "sk"),
    (v) => v.replace(/에스케이/g, "sk"),
    (v) => v.replace(/케이티앤지/g, "ktg"),
    (v) => v.replace(/앤드/g, "and"),
    (v) => v.replace(/&/g, "and"),
    (v) => v.replace(/and/g, "&")
  ];

  const set = new Set([base]);
  const queue = [base];

  while (queue.length) {
    const cur = queue.shift();
    for (const fn of transforms) {
      const next = normalizeName(fn(cur));
      if (!next || set.has(next)) continue;
      set.add(next);
      queue.push(next);
    }
  }

  return Array.from(set);
}

function normalizeName(v) {
  return String(v)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9a-z\u3131-\u318e\uac00-\ud7a3&]/g, "");
}

function stripHtml(v) {
  return String(v || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const KR_NAME_TO_SYMBOL = {
  "삼성전자": "005930.KS",
  "삼성전자우": "005935.KS",
  "sk하이닉스": "000660.KS",
  "lg전자": "066570.KS",
  "엘지전자": "066570.KS",
  "현대차": "005380.KS",
  "기아": "000270.KS",
  "네이버": "035420.KS",
  "naver": "035420.KS",
  "카카오": "035720.KS"
};

const US_NAME_TO_SYMBOL = {
  "애플": "AAPL",
  "마이크로소프트": "MSFT",
  "엔비디아": "NVDA",
  "아마존": "AMZN",
  "알파벳": "GOOGL",
  "구글": "GOOGL",
  "메타": "META",
  "테슬라": "TSLA"
};
