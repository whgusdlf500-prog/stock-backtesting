export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const symbol = url.searchParams.get("symbol");
    const market = (url.searchParams.get("market") || "").toLowerCase();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!symbol) {
      return jsonResponse({ error: "Missing symbol" }, 400);
    }

    let finalSymbol = symbol.trim();
    if (market === "kr" && isKoreanNameInput(finalSymbol)) {
      const resolved = await resolveKoreanSymbol(finalSymbol);
      if (!resolved) {
        return jsonResponse({ error: "Korean company name not found", query: finalSymbol }, 404);
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

function isKoreanNameInput(value) {
  const v = value.trim();
  if (!v) return false;
  if (/^\d{6}\.(KS|KQ)$/i.test(v)) return false;
  return /[가-힣]/.test(v);
}

async function resolveKoreanSymbol(query) {
  const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=20&newsCount=0`;
  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });
  if (!response.ok) return null;

  const json = await response.json();
  const quotes = Array.isArray(json?.quotes) ? json.quotes : [];
  const krQuotes = quotes.filter((q) => /\.(KS|KQ)$/i.test(q?.symbol || ""));
  if (!krQuotes.length) return null;

  const normQuery = normalizeName(query);
  const exact = krQuotes.find((q) => {
    const shortName = normalizeName(q?.shortname || "");
    const longName = normalizeName(q?.longname || "");
    return shortName === normQuery || longName === normQuery;
  });
  if (exact?.symbol) return exact.symbol;

  const partial = krQuotes.find((q) => {
    const shortName = normalizeName(q?.shortname || "");
    const longName = normalizeName(q?.longname || "");
    return shortName.includes(normQuery) || longName.includes(normQuery);
  });
  if (partial?.symbol) return partial.symbol;

  return krQuotes[0]?.symbol || null;
}

function normalizeName(v) {
  return String(v).toLowerCase().replace(/\s+/g, "");
}
