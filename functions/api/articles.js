const OWNER = "whgusdlf500-prog";
const REPO = "stock-backtesting";
const BRANCH = "main";
const API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/articles?ref=${BRANCH}`;

export async function onRequestGet() {
  try {
    const listRes = await fetch(API_URL, {
      headers: {
        "User-Agent": "stock-backtesting-pages"
      }
    });

    if (!listRes.ok) {
      return jsonResponse({ error: "Failed to load article list" }, 502);
    }

    const files = await listRes.json();
    const htmlFiles = (Array.isArray(files) ? files : [])
      .filter((f) => f?.type === "file" && String(f?.name || "").endsWith(".html"))
      .filter((f) => !["index.html", "article-template.html"].includes(f.name));

    const items = await Promise.all(
      htmlFiles.map(async (f) => {
        const rawRes = await fetch(f.download_url, {
          headers: {
            "User-Agent": "stock-backtesting-pages"
          }
        });
        if (!rawRes.ok) {
          return {
            path: `/articles/${f.name}`,
            title: fileNameToTitle(f.name),
            description: "분석 글"
          };
        }

        const html = await rawRes.text();
        return {
          path: `/articles/${f.name}`,
          title: extractTagText(html, "title") || fileNameToTitle(f.name),
          description: extractMetaDescription(html) || "분석 글"
        };
      })
    );

    items.sort((a, b) => a.path < b.path ? 1 : -1);
    return jsonResponse({ items, updated_at: new Date().toISOString() }, 200, {
      "Cache-Control": "public, max-age=300"
    });
  } catch (error) {
    return jsonResponse({ error: "Unexpected error", message: String(error) }, 500);
  }
}

function extractTagText(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = html.match(re);
  return m ? stripHtml(m[1]).trim() : "";
}

function extractMetaDescription(html) {
  const m = html.match(/<meta\\s+name=["']description["']\\s+content=["']([^"']+)["']/i);
  return m ? m[1].trim() : "";
}

function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, "");
}

function fileNameToTitle(name) {
  return String(name || "")
    .replace(/\.html$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders
    }
  });
}
