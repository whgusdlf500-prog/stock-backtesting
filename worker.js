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

      let finalSymbol = symbol;
      if (!isTickerFormat(finalSymbol)) {
        const resolved = await resolveSymbolByMarket(finalSymbol, market);
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

async function resolveSymbolByMarket(query, market) {
  const normalized = normalizeName(query);

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
  "카카오": "035720.KS",
  "lg에너지솔루션": "373220.KS",
  "삼성바이오로직스": "207940.KS",
  "셀트리온": "068270.KS",
  "포스코홀딩스": "005490.KS",
  "posco홀딩스": "005490.KS",
  "포스코퓨처엠": "003670.KS",
  "삼성sdi": "006400.KS",
  "lg화학": "051910.KS",
  "한화에어로스페이스": "012450.KS",
  "한화오션": "042660.KS",
  "한국전력": "015760.KS",
  "sk이노베이션": "096770.KS",
  "sk텔레콤": "017670.KS",
  "kt": "030200.KS",
  "kt&g": "033780.KS",
  "ktg": "033780.KS",
  "kb금융": "105560.KS",
  "신한지주": "055550.KS",
  "하나금융지주": "086790.KS",
  "우리금융지주": "316140.KS",
  "메리츠금융지주": "138040.KS",
  "삼성생명": "032830.KS",
  "삼성화재": "000810.KS",
  "db손해보험": "005830.KS",
  "현대해상": "001450.KS",
  "미래에셋증권": "006800.KS",
  "삼성증권": "016360.KS",
  "현대모비스": "012330.KS",
  "현대건설": "000720.KS",
  "삼성물산": "028260.KS",
  "두산에너빌리티": "034020.KS",
  "대한항공": "003490.KS",
  "한국항공우주": "047810.KS",
  "s-oil": "010950.KS",
  "에스오일": "010950.KS",
  "롯데케미칼": "011170.KS",
  "금호석유": "011780.KS",
  "한화솔루션": "009830.KS",
  "cj제일제당": "097950.KS",
  "아모레퍼시픽": "090430.KS",
  "오리온": "271560.KS",
  "농심": "004370.KS",
  "코웨이": "021240.KS",
  "크래프톤": "259960.KS",
  "엔씨소프트": "036570.KS",
  "넷마블": "251270.KS",
  "하이브": "352820.KS",
  "sk스퀘어": "402340.KS",
  "sk바이오팜": "326030.KS",
  "유한양행": "000100.KS",
  "고려아연": "010130.KS",
  "삼성중공업": "010140.KS",
  "한국타이어앤테크놀로지": "161390.KS",
  "포스코인터내셔널": "047050.KS"
};

const US_NAME_TO_SYMBOL = {
  "애플": "AAPL",
  "마이크로소프트": "MSFT",
  "엔비디아": "NVDA",
  "아마존": "AMZN",
  "알파벳": "GOOGL",
  "구글": "GOOGL",
  "메타": "META",
  "테슬라": "TSLA",
  "버크셔해서웨이": "BRK-B",
  "브로드컴": "AVGO",
  "제이피모건": "JPM",
  "jp모건": "JPM",
  "비자": "V",
  "마스터카드": "MA",
  "넷플릭스": "NFLX",
  "코카콜라": "KO",
  "펩시": "PEP",
  "월마트": "WMT",
  "코스트코": "COST",
  "존슨앤드존슨": "JNJ",
  "프록터앤드갬블": "PG",
  "프록터앤갬블": "PG",
  "유나이티드헬스": "UNH",
  "엑슨모빌": "XOM",
  "쉐브론": "CVX",
  "머크": "MRK",
  "애브비": "ABBV",
  "일라이릴리": "LLY",
  "amd": "AMD",
  "인텔": "INTC",
  "시스코": "CSCO",
  "오라클": "ORCL",
  "어도비": "ADBE",
  "세일즈포스": "CRM",
  "맥도날드": "MCD",
  "디즈니": "DIS",
  "보잉": "BA",
  "골드만삭스": "GS",
  "모건스탠리": "MS",
  "캐터필러": "CAT",
  "허니웰": "HON",
  "퀄컴": "QCOM",
  "텍사스인스트루먼트": "TXN",
  "암젠": "AMGN",
  "화이자": "PFE",
  "스타벅스": "SBUX",
  "나이키": "NKE",
  "액센츄어": "ACN"
};
