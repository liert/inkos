import { searchWeb, type SearchResult, type WebSearchOptions } from "../utils/web-search.js";

export interface RankingEntry {
  readonly title: string;
  readonly author: string;
  readonly category: string;
  readonly extra: string;
}

export interface PlatformRankings {
  readonly platform: string;
  readonly entries: ReadonlyArray<RankingEntry>;
}

/**
 * Pluggable data source for the Radar agent.
 * Implement this interface to feed custom ranking/trend data
 * (e.g. from OpenClaw, custom scrapers, paid APIs).
 */
export interface RadarSource {
  readonly name: string;
  fetch(): Promise<PlatformRankings>;
}

/**
 * Wraps raw natural language text as a radar source.
 * Use this to inject external analysis (e.g. from OpenClaw) into the radar pipeline.
 */
export class TextRadarSource implements RadarSource {
  readonly name: string;
  private readonly text: string;

  constructor(text: string, name = "external") {
    this.name = name;
    this.text = text;
  }

  async fetch(): Promise<PlatformRankings> {
    return {
      platform: this.name,
      entries: [{ title: this.text, author: "", category: "", extra: "[外部分析]" }],
    };
  }
}

// ---------------------------------------------------------------------------
// Built-in sources
// ---------------------------------------------------------------------------

const FANQIE_RANK_TYPES = [
  { sideType: 10, label: "热门榜" },
  { sideType: 13, label: "黑马榜" },
] as const;

export class FanqieRadarSource implements RadarSource {
  readonly name = "fanqie";

  async fetch(): Promise<PlatformRankings> {
    const entries: RankingEntry[] = [];

    for (const { sideType, label } of FANQIE_RANK_TYPES) {
      try {
        const url = `https://api-lf.fanqiesdk.com/api/novel/channel/homepage/rank/rank_list/v2/?aid=13&limit=15&offset=0&side_type=${sideType}`;
        const res = await globalThis.fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; InkOS/0.1)" },
        });
        if (!res.ok) continue;
        const data = (await res.json()) as Record<string, unknown>;
        const list = (data as { data?: { result?: unknown[] } }).data?.result;
        if (!Array.isArray(list)) continue;

        for (const item of list) {
          const rec = item as Record<string, unknown>;
          entries.push({
            title: String(rec.book_name ?? ""),
            author: String(rec.author ?? ""),
            category: String(rec.category ?? ""),
            extra: `[${label}]`,
          });
        }
      } catch {
        // skip on network error
      }
    }

    return { platform: "番茄小说", entries };
  }
}

export class QidianRadarSource implements RadarSource {
  readonly name = "qidian";

  async fetch(): Promise<PlatformRankings> {
    const entries: RankingEntry[] = [];

    try {
      const url = "https://www.qidian.com/rank/";
      const res = await globalThis.fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!res.ok) return { platform: "起点中文网", entries };
      const html = await res.text();

      const bookPattern =
        /<a[^>]*href="\/\/book\.qidian\.com\/info\/(\d+)"[^>]*>([^<]+)<\/a>/g;
      let match: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((match = bookPattern.exec(html)) !== null) {
        const title = match[2].trim();
        if (title && !seen.has(title) && title.length > 1 && title.length < 30) {
          seen.add(title);
          entries.push({ title, author: "", category: "", extra: "[起点热榜]" });
        }
        if (entries.length >= 20) break;
      }
    } catch {
      // skip on network error
    }

    return { platform: "起点中文网", entries };
  }
}

/**
 * Optional Tavily-powered radar source to augment built-in ranking sources with external web insights.
 */
export class TavilyRadarSource implements RadarSource {
  readonly name = "tavily";
  private readonly query: string;
  private readonly options: WebSearchOptions;

  constructor(query?: string, options: WebSearchOptions = {}) {
    this.query = query?.trim() || "网络小说 热门题材 榜单 趋势 知乎盐选 番茄 起点";
    this.options = options;
  }

  async fetch(): Promise<PlatformRankings> {
    try {
      const results = await searchWeb(this.query, 6, this.options);
      const entries: RankingEntry[] = results.map((r) => ({
        title: r.title,
        author: "",
        category: "全网热度",
        extra: `[外网分析: ${r.snippet ? r.snippet.slice(0, 100) : r.url}]`,
      }));
      return { platform: "全网搜索趋势 (Tavily)", entries };
    } catch {
      // Tavily is optional: if no key or error, return empty gracefully without throwing
      return { platform: "全网搜索趋势 (Tavily)", entries: [] };
    }
  }
}

/**
 * Build default radar sources: always includes Tomato (Fanqie) and Qidian.
 * Optionally appends Tavily when a key is present or configured.
 */
export function buildDefaultRadarSources(options?: {
  readonly topic?: string;
  readonly platform?: "all" | "tomato" | "qidian" | "other";
  readonly searchOptions?: WebSearchOptions;
  readonly includeTavilyIfConfigured?: boolean;
}): ReadonlyArray<RadarSource> {
  const sources: RadarSource[] = [];
  const platform = options?.platform ?? "all";

  if (platform === "all" || platform === "tomato") {
    sources.push(new FanqieRadarSource());
  }
  if (platform === "all" || platform === "qidian") {
    sources.push(new QidianRadarSource());
  }

  const hasTavilyKey = Boolean(
    options?.searchOptions?.apiKey ||
    (options?.searchOptions?.apiKeyEnv ? process.env[options.searchOptions.apiKeyEnv] : undefined) ||
    process.env.TAVILY_API_KEY,
  );

  if ((hasTavilyKey || options?.includeTavilyIfConfigured) && hasTavilyKey) {
    sources.push(new TavilyRadarSource(options?.topic, options?.searchOptions));
  }

  return sources;
}

/**
 * Searches real-time novel rankings from built-in Market Radar sources (Fanqie + Qidian).
 * Used as a zero-config, highly-reliable default or fallback search provider.
 */
export async function searchMarketRadarRankings(
  query?: string,
  maxResults = 10,
): Promise<ReadonlyArray<SearchResult>> {
  const sources = [new FanqieRadarSource(), new QidianRadarSource()];
  const rankings = await Promise.all(sources.map((s) => s.fetch().catch(() => ({ platform: s.name, entries: [] }))));
  const allEntries: Array<{ platform: string; entry: RankingEntry }> = [];
  for (const r of rankings) {
    for (const e of r.entries) {
      if (e.title?.trim()) {
        allEntries.push({ platform: r.platform, entry: e });
      }
    }
  }

  const terms = (query ?? "")
    .toLowerCase()
    .split(/[\s,，、+]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !["2024", "2025", "小说", "题材", "市场", "趋势", "爆款"].includes(t));

  let filtered = allEntries;
  if (terms.length > 0) {
    const scored = allEntries.map((item) => {
      const text = `${item.platform} ${item.entry.title} ${item.entry.author} ${item.entry.category} ${item.entry.extra}`.toLowerCase();
      const score = terms.reduce((acc, term) => (text.includes(term) ? acc + 1 : acc), 0);
      return { item, score };
    });
    const matches = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    if (matches.length > 0) {
      filtered = matches.map((m) => m.item);
    }
  }

  return filtered.slice(0, maxResults).map(({ platform, entry }) => ({
    title: `[${platform}${entry.extra ? ` ${entry.extra}` : ""}] 《${entry.title}》 ${entry.author ? `(作者: ${entry.author})` : ""} ${entry.category ? `[${entry.category}]` : ""}`.trim(),
    url: `inkos://radar/${encodeURIComponent(platform)}/${encodeURIComponent(entry.title)}`,
    snippet: `实时热度榜单作品: 《${entry.title}》，所属平台: ${platform}，榜单标签: ${entry.extra}，分类: ${entry.category || "综合"}。`,
  }));
}
