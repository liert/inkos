import { describe, expect, it, vi } from "vitest";
import {
  buildDefaultRadarSources,
  searchMarketRadarRankings,
  FanqieRadarSource,
  QidianRadarSource,
  TavilyRadarSource,
} from "../agents/radar-source.js";
import { createScanMarketRadarTool, createResearchWebTool } from "../agent/agent-tools.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Radar Sources and Tooling", () => {
  it("buildDefaultRadarSources defaults to Tomato and Qidian", () => {
    const sources = buildDefaultRadarSources();
    expect(sources.map((s) => s.name)).toEqual(["fanqie", "qidian"]);
  });

  it("buildDefaultRadarSources filters platform when specified", () => {
    const tomatoOnly = buildDefaultRadarSources({ platform: "tomato" });
    expect(tomatoOnly.map((s) => s.name)).toEqual(["fanqie"]);

    const qidianOnly = buildDefaultRadarSources({ platform: "qidian" });
    expect(qidianOnly.map((s) => s.name)).toEqual(["qidian"]);
  });

  it("buildDefaultRadarSources appends Tavily only when key is configured", () => {
    const withoutKey = buildDefaultRadarSources({
      searchOptions: {},
      includeTavilyIfConfigured: true,
    });
    expect(withoutKey.some((s) => s instanceof TavilyRadarSource)).toBe(false);

    const withKey = buildDefaultRadarSources({
      searchOptions: { apiKey: "test-tavily-key" },
      includeTavilyIfConfigured: true,
    });
    expect(withKey.some((s) => s instanceof TavilyRadarSource)).toBe(true);
  });

  it("searchMarketRadarRankings returns formatted SearchResult entries", async () => {
    const mockFanqie = vi.spyOn(FanqieRadarSource.prototype, "fetch").mockResolvedValueOnce({
      platform: "番茄小说",
      entries: [
        { title: "绝世武神", author: "笔落", category: "玄幻", extra: "[热门榜]" },
        { title: "商业对赌反杀", author: "青云", category: "都市", extra: "[黑马榜]" },
      ],
    });
    const mockQidian = vi.spyOn(QidianRadarSource.prototype, "fetch").mockResolvedValueOnce({
      platform: "起点中文网",
      entries: [
        { title: "宿命之环", author: "爱潜水的乌贼", category: "西幻", extra: "[起点热榜]" },
      ],
    });

    const results = await searchMarketRadarRankings("商业 反杀", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain("商业对赌反杀");
    expect(results[0].url).toContain("inkos://radar/");

    mockFanqie.mockRestore();
    mockQidian.mockRestore();
  });

  it("createScanMarketRadarTool executes pipeline radar and persists json result", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-radar-tool-"));
    try {
      const mockRunRadar = vi.fn().mockResolvedValue({
        marketSummary: "当前都市逆袭与商业反杀题材热度上升",
        recommendations: [
          {
            platform: "tomato",
            genre: "都市职场",
            concept: "女审计师上市前夜资产反杀",
            reasoning: "契合黑马榜反转情绪",
            benchmarkTitles: ["合伙清算"],
          },
        ],
        timestamp: "2026-10-01T08-00-00-000Z",
      });
      const fakePipeline = { runRadar: mockRunRadar } as any;

      const tool = createScanMarketRadarTool(fakePipeline, root);
      expect(tool.name).toBe("scan_market_radar");

      const result = await tool.execute("call-1", { topic: "都市反杀", platform: "tomato" });
      expect(mockRunRadar).toHaveBeenCalledWith({ topic: "都市反杀", platform: "tomato" });
      expect(result.content[0].type).toBe("text");
      expect((result.content[0] as any).text).toContain("都市逆袭与商业反杀题材");
      expect((result.details as any)?.kind).toBe("radar_result");

      // Verify file persisted in radar/
      const saved = JSON.parse(await readFile((result.details as any).filePath, "utf-8"));
      expect(saved.marketSummary).toContain("都市逆袭与商业反杀题材");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("createResearchWebTool falls back to built-in market radar when Tavily key is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-research-tool-"));
    const origKey = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    const mockFanqie = vi.spyOn(FanqieRadarSource.prototype, "fetch").mockResolvedValueOnce({
      platform: "番茄小说",
      entries: [
        { title: "商业短篇爆款", author: "测试", category: "都市", extra: "[热门榜]" },
      ],
    });
    const mockQidian = vi.spyOn(QidianRadarSource.prototype, "fetch").mockResolvedValueOnce({
      platform: "起点中文网",
      entries: [],
    });

    try {
      const tool = createResearchWebTool(root);
      const result = await tool.execute("call-2", {
        topic: "商业短篇小说 爆款题材 市场趋势",
        purpose: "开书调研",
        depth: "quick",
      });

      expect((result.details as any)?.sources.length).toBeGreaterThan(0);
      expect((result.details as any)?.partialFailures).toHaveLength(0);
      expect((result.content[0] as any).text).toContain("Sources collected:");
    } finally {
      if (origKey) process.env.TAVILY_API_KEY = origKey;
      mockFanqie.mockRestore();
      mockQidian.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
