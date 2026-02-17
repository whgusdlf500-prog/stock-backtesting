const MAPPING_JSON_URL = "https://stock-backtesting-gmc.pages.dev/company-mappings.json";
const MAPPING_CACHE_TTL_MS = 10 * 60 * 1000;
let mappingCache = { at: 0, data: null };

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
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
        return jsonResponse({ error: "Company name not found", query: finalSymbol, market }, 404);
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
    return jsonResponse({ error: "Pages function error", message: String(error) }, 500);
  }
}

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
  const normalized = normalizeName(query);
  const dynamic = findSymbolInMappings(normalized, market, mappings);
  if (dynamic) return dynamic;

  if (market === "kr") {
    const mapped = KR_NAME_TO_SYMBOL[normalized];
    if (mapped) return mapped;
  }

  if (market === "us") {
    const mapped = US_NAME_TO_SYMBOL[normalized];
    if (mapped) return mapped;
  }

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
    return shortName === normalized || longName === normalized;
  });
  if (exact?.symbol) return exact.symbol;

  const partial = filtered.find((q) => {
    const shortName = normalizeName(q?.shortname || "");
    const longName = normalizeName(q?.longname || "");
    return shortName.includes(normalized) || longName.includes(normalized);
  });
  if (partial?.symbol) return partial.symbol;

  return filtered[0]?.symbol || null;
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

function normalizeName(v) {
  return String(v)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9a-z\u3131-\u318e\uac00-\ud7a3&]/g, "");
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
