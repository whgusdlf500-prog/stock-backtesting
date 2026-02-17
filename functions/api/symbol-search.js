export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const q = (url.searchParams.get("q") || "").trim();
    const market = (url.searchParams.get("market") || "").toLowerCase();

    if (!q) {
      return jsonResponse({ items: [] });
    }

    const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0`;
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!res.ok) {
      return jsonResponse({ items: [] });
    }

    const json = await res.json();
    const quotes = Array.isArray(json?.quotes) ? json.quotes : [];

    const items = quotes
      .filter((row) => {
        const s = String(row?.symbol || "").toUpperCase();
        if (!s) return false;
        if (market === "kr") return /\.(KS|KQ)$/.test(s);
        if (market === "us") return !s.includes(".") && (row?.quoteType === "EQUITY" || row?.quoteType === "ETF");
        return true;
      })
      .slice(0, 10)
      .map((row) => ({
        symbol: String(row?.symbol || "").toUpperCase(),
        shortName: String(row?.shortname || ""),
        longName: String(row?.longname || "")
      }));

    return jsonResponse({ items });
  } catch (error) {
    return jsonResponse({ items: [], error: String(error) }, 500);
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
