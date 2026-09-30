import { CreativeMethodsEditor } from "./CreativeMethodsEditor";
import { useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Clock3,
  FileText,
  GitCommitHorizontal,
  Loader2,
  Pencil,
  Save,
  X,
  BookOpen,
  Book,
  Layers,
  List,
  Sparkles,
  Compass,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Type,
  Maximize2,
  Minimize2,
  Eye,
  MessageSquare,
  Image as ImageIcon,
  Check,
  RotateCcw,
} from "lucide-react";
import { fetchJson, useApi, buildApiUrl } from "../hooks/use-api";
import { tr } from "../lib/app-language";

interface Revision {
  readonly id: string;
  readonly path: string;
  readonly contentType: string;
  readonly status: string;
  readonly byteLength: number;
  readonly createdAt: string;
}

interface Artifact {
  readonly id: string;
  readonly kind: string;
  readonly currentRevisionId: string | null;
  readonly revisions: ReadonlyArray<Revision>;
}

interface WorkDetail {
  readonly work: {
    readonly id: string;
    readonly title: string;
    readonly profileId: string;
    readonly language: string;
    readonly status: string;
    readonly artifacts: ReadonlyArray<Artifact>;
    readonly metadata?: Record<string, unknown>;
  };
  readonly episodes: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly startedAt: string;
  }>;
}

interface RevisionPayload {
  readonly revision: Revision;
  readonly artifactId: string;
  readonly content?: string;
  readonly dataUrl?: string;
}

export interface ChapterItem {
  readonly artifact: Artifact;
  readonly revision: Revision;
  readonly chapterNumber: number;
  readonly path: string;
}

export interface CategorizedWorkArtifacts {
  readonly finalChapters: readonly ChapterItem[];
  readonly completeManuscript?: { artifact: Artifact; revision: Revision };
  readonly outline?: { artifact: Artifact; revision: Revision };
  readonly salesPackage?: { artifact: Artifact; revision: Revision };
  readonly cover?: { artifact: Artifact; revision: Revision };
  readonly review?: { artifact: Artifact; revision: Revision };
  readonly draftChapters: readonly ChapterItem[];
  readonly otherArtifacts: ReadonlyArray<{ artifact: Artifact; revision: Revision }>;
}

function revisionDifference(current: string, selected: string): string {
  const before = current.split("\n"), after = selected.split("\n");
  let start = 0, suffix = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  while (suffix < Math.min(before.length, after.length) - start && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  return [
    ...before.slice(start, before.length - suffix).map(line => `− ${line}`),
    ...after.slice(start, after.length - suffix).map(line => `+ ${line}`),
  ].join("\n");
}

function categorizeArtifacts(artifacts: ReadonlyArray<Artifact>): CategorizedWorkArtifacts {
  const finalChapters: ChapterItem[] = [];
  const draftChapters: ChapterItem[] = [];
  const otherArtifacts: Array<{ artifact: Artifact; revision: Revision }> = [];
  let completeManuscript: { artifact: Artifact; revision: Revision } | undefined;
  let outline: { artifact: Artifact; revision: Revision } | undefined;
  let salesPackage: { artifact: Artifact; revision: Revision } | undefined;
  let cover: { artifact: Artifact; revision: Revision } | undefined;
  let review: { artifact: Artifact; revision: Revision } | undefined;

  for (const artifact of artifacts) {
    const revision = artifact.revisions.find(r => r.id === artifact.currentRevisionId) ?? artifact.revisions.at(-1);
    if (!revision) continue;

    const path = revision.path;

    const finalChMatch = path.match(/source\/final\/chapters\/(\d+)\.md$/i);
    if (finalChMatch) {
      finalChapters.push({
        artifact,
        revision,
        chapterNumber: parseInt(finalChMatch[1], 10),
        path,
      });
      continue;
    }

    const draftChMatch = path.match(/chapters\/(\d+)\.md$/i);
    if (draftChMatch && !path.includes("final")) {
      draftChapters.push({
        artifact,
        revision,
        chapterNumber: parseInt(draftChMatch[1], 10),
        path,
      });
      continue;
    }

    if (/\.(jpe?g|png|webp)$/i.test(path) || artifact.kind === "image") {
      cover = { artifact, revision };
      continue;
    }

    if (
      path.startsWith("source/final/")
      && path.endsWith(".md")
      && !path.includes("sales-package")
      && !path.includes("cover-prompt")
      && !path.includes("cover-request")
    ) {
      completeManuscript = { artifact, revision };
      continue;
    }

    if (path.includes("outline") || path.endsWith("brief.md")) {
      if (!outline || path.includes("outline")) outline = { artifact, revision };
      continue;
    }

    if (path.includes("sales-package.md")) {
      salesPackage = { artifact, revision };
      continue;
    }

    if (path.includes("reviews/") || path.includes("draft-review")) {
      review = { artifact, revision };
      continue;
    }

    otherArtifacts.push({ artifact, revision });
  }

  finalChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
  draftChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

  return {
    finalChapters,
    completeManuscript,
    outline,
    salesPackage,
    cover,
    review,
    draftChapters,
    otherArtifacts,
  };
}

function parseMarkdownDocument(raw: string): { title?: string; body: string } {
  const lines = raw.split("\n");
  const titleLine = lines.find((l) => l.startsWith("# "));
  const title = titleLine ? titleLine.replace(/^#\s*/, "").trim() : undefined;
  const body = lines
    .filter((l) => l !== titleLine)
    .join("\n")
    .trim();
  return { title, body };
}

const THEME_STYLES: Record<string, { bg: string; text: string; border: string; desc: string }> = {
  paper: {
    bg: "bg-[#fbf7ee] dark:bg-[#1e1c19]",
    text: "text-[#2e2a27] dark:text-[#dfdbd5]",
    border: "border-[#e6dece] dark:border-[#38332f]",
    desc: "羊皮纸",
  },
  mint: {
    bg: "bg-[#edf5ed] dark:bg-[#182318]",
    text: "text-[#1d2b1d] dark:text-[#cce0cc]",
    border: "border-[#d2e4d2] dark:border-[#2d3f2d]",
    desc: "护眼绿",
  },
  default: {
    bg: "bg-card",
    text: "text-foreground",
    border: "border-border/50",
    desc: "经典白",
  },
  dark: {
    bg: "bg-[#141416]",
    text: "text-[#dedee3]",
    border: "border-[#2b2b33]",
    desc: "夜间黑",
  },
};

const FONT_SIZE_STYLES: Record<string, string> = {
  sm: "text-[15px] leading-7",
  md: "text-[17px] leading-8 md:leading-[2.2]",
  lg: "text-[19px] leading-9 md:leading-[2.4]",
  xl: "text-[21px] leading-10 md:leading-[2.6]",
};

export function WorkInspector({ workId, onBack, onChat }: {
  readonly workId: string;
  readonly onBack: () => void;
  readonly onChat: (workId: string, profileId: string) => void;
}) {
  const { data, loading, error, refetch } = useApi<WorkDetail>(`/works/${encodeURIComponent(workId)}`);
  const previewSequence = useRef(0);
  const readerScrollRef = useRef<HTMLDivElement>(null);
  const zenScrollRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<"reader" | "artifacts" | "methods" | "episodes">("reader");
  const [previewRevisionId, setPreviewRevisionId] = useState("");
  const [selected, setSelected] = useState<RevisionPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [comparison, setComparison] = useState<RevisionPayload | null>(null);
  const [events, setEvents] = useState<Array<{ seq: number; type: string; payload: unknown }> | null>(null);

  // Novel reader settings
  const [readerTheme, setReaderTheme] = useState<"paper" | "mint" | "default" | "dark">("paper");
  const [fontSize, setFontSize] = useState<"sm" | "md" | "lg" | "xl">("md");
  const [fontFamily, setFontFamily] = useState<"serif" | "sans">("serif");
  const [zenMode, setZenMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Categorize artifacts
  const categorized = useMemo(() => {
    return categorizeArtifacts(data?.work.artifacts ?? []);
  }, [data?.work.artifacts]);

  const currentRevisions = useMemo(() => data?.work.artifacts.map((artifact) => ({
    artifact,
    revision: artifact.revisions.find((revision) => revision.id === artifact.currentRevisionId) ?? artifact.revisions.at(-1),
  })) ?? [], [data]);

  const selectedArtifact = useMemo(() => {
    return data?.work.artifacts.find(artifact => artifact.id === selected?.artifactId);
  }, [data?.work.artifacts, selected?.artifactId]);

  // Open a specific revision
  const openRevision = async (artifact: Artifact, revision: Revision) => {
    const sequence = ++previewSequence.current;
    setPreviewRevisionId(revision.id);
    setPreviewLoading(true);
    setOperationError("");
    setComparison(null);
    try {
      const payload = await fetchJson<RevisionPayload>(
        `/works/${encodeURIComponent(workId)}/artifacts/${encodeURIComponent(artifact.id)}/revisions/${encodeURIComponent(revision.id)}`,
      );
      if (sequence !== previewSequence.current) return;
      setSelected(payload);
      setDraft(payload.content ?? "");
      setEditing(false);
      readerScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      zenScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setOperationError(String(err));
    } finally {
      if (sequence === previewSequence.current) setPreviewLoading(false);
    }
  };

  // Auto-open first chapter or primary manuscript on load
  useEffect(() => {
    if (!data || selected || previewLoading) return;
    const artifacts = data.work.artifacts;
    if (!artifacts || artifacts.length === 0) return;

    const ch1 = categorized.finalChapters[0];
    const complete = categorized.completeManuscript;
    const firstOther = currentRevisions[0];

    const target = ch1 ?? complete ?? firstOther;
    if (target?.artifact && target.revision) {
      void openRevision(target.artifact, target.revision);
    }
  }, [data, categorized, currentRevisions]);

  // Fullscreen / Zen mode handling
  const toggleFullscreen = () => {
    if (!zenMode) {
      setZenMode(true);
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } else {
      setZenMode(false);
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && zenMode) {
        setZenMode(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && zenMode) {
        setZenMode(false);
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [zenMode]);

  // Save new revision
  const saveRevision = async () => {
    if (selected?.content === undefined || !editing) return;
    setSaving(true);
    setOperationError("");
    try {
      await fetchJson(
        `/project/artifacts/${encodeURIComponent(`works/${workId}/${selected.revision.path}`).replaceAll("%2F", "/")}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: draft, expectedRevisionId: selected.revision.id }),
        },
      );
      setEditing(false);
      await refetch();
      if (selectedArtifact) {
        const latest = selectedArtifact.revisions.at(-1);
        if (latest) {
          await openRevision(selectedArtifact, latest);
        }
      }
    } catch (err) {
      setOperationError(String(err));
    } finally {
      setSaving(false);
    }
  };

  // Compare with current revision
  const compareCurrent = async () => {
    if (!selectedArtifact?.currentRevisionId) return;
    try {
      setComparison(await fetchJson<RevisionPayload>(
        `/works/${encodeURIComponent(workId)}/artifacts/${encodeURIComponent(selectedArtifact.id)}/revisions/${encodeURIComponent(selectedArtifact.currentRevisionId)}`,
      ));
    } catch (err) {
      setOperationError(String(err));
    }
  };

  // Adopt revision
  const adoptRevision = async () => {
    if (!selected || !selectedArtifact) return;
    try {
      await fetchJson(
        `/works/${encodeURIComponent(workId)}/artifacts/${encodeURIComponent(selected.artifactId)}/revisions/${encodeURIComponent(selected.revision.id)}/adopt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedCurrentRevisionId: selectedArtifact.currentRevisionId }),
        },
      );
      setComparison(null);
      await refetch();
    } catch (err) {
      setOperationError(String(err));
    }
  };

  // Compute cover image URL
  const coverUrl = useMemo(() => {
    if (!categorized.cover?.revision.path) return null;
    return buildApiUrl(`/project/files/works/${encodeURIComponent(workId)}/${categorized.cover.revision.path}`);
  }, [categorized.cover, workId]);

  // Total character count
  const totalCharacters = useMemo(() => {
    if (categorized.finalChapters.length > 0) {
      return categorized.finalChapters.reduce((acc, c) => acc + c.revision.byteLength, 0);
    }
    return categorized.completeManuscript?.revision.byteLength ?? 0;
  }, [categorized]);

  // Chapter navigation helpers
  const currentChapterIndex = useMemo(() => {
    if (!selected) return -1;
    return categorized.finalChapters.findIndex(c => c.artifact.id === selected.artifactId);
  }, [categorized.finalChapters, selected]);

  const prevChapter = currentChapterIndex > 0 ? categorized.finalChapters[currentChapterIndex - 1] : undefined;
  const nextChapter = currentChapterIndex >= 0 && currentChapterIndex < categorized.finalChapters.length - 1
    ? categorized.finalChapters[currentChapterIndex + 1]
    : undefined;

  // Parsed markdown
  const parsedMarkdown = useMemo(() => {
    if (!selected?.content) return null;
    return parseMarkdownDocument(selected.content);
  }, [selected?.content]);

  const activeTheme = THEME_STYLES[readerTheme] ?? THEME_STYLES.paper;
  const activeFontSize = FONT_SIZE_STYLES[fontSize] ?? FONT_SIZE_STYLES.md;

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <Loader2 className="animate-spin text-primary" size={28} />
        <span className="text-sm text-muted-foreground">{tr("正在加载作品内容...", "Loading work content...")}</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-destructive">
        {error ?? "Work not found"}
      </div>
    );
  }

  const intent = typeof data.work.metadata?.intent === "string" ? data.work.metadata.intent : undefined;

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} /> {tr("返回创作库", "Back to library")}
        </button>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onChat(data.work.id, data.work.profileId)}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <MessageSquare size={14} />
            {tr("与 Agent 继续创作", "Continue with Agent")}
          </button>
        </div>
      </div>

      {/* Book Showcase Hero Header */}
      <div className="paper-sheet rounded-2xl p-6 md:p-7 shadow-md relative overflow-hidden">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          {/* Cover Book Plate */}
          <div className="shrink-0 w-28 h-40 md:w-32 md:h-44 rounded-xl overflow-hidden shadow-lg border border-border/60 bg-muted/30 relative group">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={data.work.title}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 cursor-pointer"
                onClick={() => categorized.cover && openRevision(categorized.cover.artifact, categorized.cover.revision)}
                title={tr("点击查看封面原图", "Click to view full cover")}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-gradient-to-br from-primary/10 to-primary/5">
                <BookOpen size={28} className="text-primary/60 mb-2" />
                <span className="font-serif font-bold text-xs text-foreground line-clamp-2">{data.work.title}</span>
              </div>
            )}
          </div>

          {/* Book Details */}
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-primary px-2 py-0.5 rounded-full bg-primary/10">
                {data.work.profileId}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {data.work.id}
              </span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground font-medium uppercase">
                {data.work.language}
              </span>
            </div>

            <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground tracking-tight">
              {data.work.title}
            </h1>

            {intent && (
              <p className="text-xs md:text-sm text-muted-foreground line-clamp-2 leading-relaxed italic border-l-2 border-primary/40 pl-3">
                {intent}
              </p>
            )}

            {/* Stats Bar */}
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground font-medium">
              {categorized.finalChapters.length > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary/50 text-foreground">
                  <Layers size={13} className="text-primary" />
                  <span>{categorized.finalChapters.length} {tr("个章节", "chapters")}</span>
                </span>
              )}
              {totalCharacters > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary/50 text-foreground">
                  <FileText size={13} className="text-primary" />
                  <span>{Math.round(totalCharacters / 3).toLocaleString()} {tr("字", "chars")}</span>
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">
                <CheckCircle2 size={13} />
                <span>{data.work.status}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/50 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("reader")}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === "reader"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          <BookOpen size={14} />
          {tr("小说阅读与编辑", "Novel Reader & Editor")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("artifacts")}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === "artifacts"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          <GitCommitHorizontal size={14} />
          {tr("全部生成物与版本", "All Artifacts & Revisions")}
          <span className="rounded-full bg-secondary px-1.5 py-0.2 text-[10px]">{data.work.artifacts.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("methods")}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === "methods"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          <Compass size={14} />
          {tr("创作配置与方法", "Creative Profile & Methods")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("episodes")}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === "episodes"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          <Clock3 size={14} />
          {tr("执行记录", "Execution History")}
          <span className="rounded-full bg-secondary px-1.5 py-0.2 text-[10px]">{data.episodes.length}</span>
        </button>
      </div>

      {operationError && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center justify-between">
          <span>{operationError}</span>
          <button type="button" onClick={() => setOperationError("")}><X size={14} /></button>
        </div>
      )}

      {/* TAB 1: Novel Reader & Editor */}
      {activeTab === "reader" && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 h-[calc(100vh-210px)] min-h-[580px]">
          {/* Left Table of Contents Sidebar */}
          {sidebarOpen && (
            <aside className="md:col-span-4 lg:col-span-3 h-full flex flex-col rounded-2xl border border-border/50 bg-card overflow-hidden shadow-xs">
              <div className="p-3.5 border-b border-border/40 flex items-center justify-between bg-muted/20">
                <div className="flex items-center gap-2">
                  <List size={15} className="text-primary" />
                  <span className="font-semibold text-xs text-foreground uppercase tracking-wider">{tr("作品目录", "Table of Contents")}</span>
                </div>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {categorized.finalChapters.length > 0 ? `${categorized.finalChapters.length} ${tr("章", "Ch.")}` : `${data.work.artifacts.length} ${tr("项", "items")}`}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-4">
                {/* 1. Final Chapters */}
                {categorized.finalChapters.length > 0 && (
                  <div className="space-y-1">
                    <div className="px-2 py-1 text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <BookOpen size={12} className="text-primary" />
                      <span>{tr("正文章节", "Chapters")}</span>
                    </div>
                    {categorized.finalChapters.map((ch) => {
                      const isCurrent = selected?.artifactId === ch.artifact.id;
                      return (
                        <button
                          key={ch.artifact.id}
                          type="button"
                          onClick={() => void openRevision(ch.artifact, ch.revision)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                            isCurrent
                              ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                              : "text-foreground hover:bg-muted/60"
                          }`}
                        >
                          <span className="truncate">
                            {tr(`第 ${ch.chapterNumber} 章`, `Chapter ${ch.chapterNumber}`)}
                          </span>
                          <span className={`text-[10px] font-mono shrink-0 ml-2 ${isCurrent ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                            {Math.round(ch.revision.byteLength / 3).toLocaleString()} {tr("字", "w")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 2. Primary Creative Assets */}
                <div className="space-y-1">
                  <div className="px-2 py-1 text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles size={12} className="text-amber-500" />
                    <span>{tr("核心交付稿与物料", "Deliverables")}</span>
                  </div>

                  {categorized.completeManuscript && (
                    <button
                      type="button"
                      onClick={() => categorized.completeManuscript && void openRevision(categorized.completeManuscript.artifact, categorized.completeManuscript.revision)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                        selected?.artifactId === categorized.completeManuscript.artifact.id
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                          : "text-foreground hover:bg-muted/60"
                      }`}
                    >
                      <span className="truncate font-medium">{tr("📖 全篇小说正文", "📖 Full Manuscript")}</span>
                      <span className="text-[10px] font-mono opacity-80 shrink-0 ml-2">.md</span>
                    </button>
                  )}

                  {categorized.outline && (
                    <button
                      type="button"
                      onClick={() => categorized.outline && void openRevision(categorized.outline.artifact, categorized.outline.revision)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                        selected?.artifactId === categorized.outline.artifact.id
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                          : "text-foreground hover:bg-muted/60"
                      }`}
                    >
                      <span className="truncate">{tr("💡 故事大纲与设定", "💡 Story Outline")}</span>
                      <span className="text-[10px] font-mono opacity-80 shrink-0 ml-2">.md</span>
                    </button>
                  )}

                  {categorized.salesPackage && (
                    <button
                      type="button"
                      onClick={() => categorized.salesPackage && void openRevision(categorized.salesPackage.artifact, categorized.salesPackage.revision)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                        selected?.artifactId === categorized.salesPackage.artifact.id
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                          : "text-foreground hover:bg-muted/60"
                      }`}
                    >
                      <span className="truncate">{tr("🎯 宣发物料与卖点", "🎯 Sales Package")}</span>
                      <span className="text-[10px] font-mono opacity-80 shrink-0 ml-2">.md</span>
                    </button>
                  )}

                  {categorized.review && (
                    <button
                      type="button"
                      onClick={() => categorized.review && void openRevision(categorized.review.artifact, categorized.review.revision)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                        selected?.artifactId === categorized.review.artifact.id
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                          : "text-foreground hover:bg-muted/60"
                      }`}
                    >
                      <span className="truncate">{tr("🔍 文学审校与质检", "🔍 Quality Review")}</span>
                      <span className="text-[10px] font-mono opacity-80 shrink-0 ml-2">.md</span>
                    </button>
                  )}

                  {categorized.cover && (
                    <button
                      type="button"
                      onClick={() => categorized.cover && void openRevision(categorized.cover.artifact, categorized.cover.revision)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs transition-colors cursor-pointer ${
                        selected?.artifactId === categorized.cover.artifact.id
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                          : "text-foreground hover:bg-muted/60"
                      }`}
                    >
                      <span className="truncate">{tr("🎨 封面海报原图", "🎨 Cover Art")}</span>
                      <span className="text-[10px] font-mono opacity-80 shrink-0 ml-2">image</span>
                    </button>
                  )}
                </div>

                {/* 3. Drafts / Other files */}
                {categorized.draftChapters.length > 0 && (
                  <details className="group px-2">
                    <summary className="text-[11px] font-bold text-muted-foreground cursor-pointer select-none py-1 hover:text-foreground">
                      {tr("草稿历史章节", "Draft chapters")} ({categorized.draftChapters.length})
                    </summary>
                    <div className="mt-1 space-y-1 pl-2 border-l border-border/40">
                      {categorized.draftChapters.map((ch) => (
                        <button
                          key={ch.artifact.id}
                          type="button"
                          onClick={() => void openRevision(ch.artifact, ch.revision)}
                          className={`w-full text-left px-2 py-1.5 rounded-lg text-xs truncate cursor-pointer ${
                            selected?.artifactId === ch.artifact.id
                              ? "bg-primary text-primary-foreground font-medium"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                          }`}
                        >
                          {tr(`草稿第 ${ch.chapterNumber} 章`, `Draft Ch. ${ch.chapterNumber}`)}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </aside>
          )}

          {/* Right Novel Reader & Editor Pane */}
          <main className={`${sidebarOpen ? "md:col-span-8 lg:col-span-9" : "col-span-12"} h-full flex flex-col rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm`}>
            {/* Reader Controls Toolbar */}
            <div className="p-3 border-b border-border/40 flex flex-wrap items-center justify-between gap-3 bg-muted/20 shrink-0">
              {/* Document Identity & Revision selector */}
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title={sidebarOpen ? tr("折叠目录", "Collapse contents") : tr("展开目录", "Expand contents")}
                >
                  <List size={16} />
                </button>

                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground truncate max-w-[200px] sm:max-w-xs">
                    {parsedMarkdown?.title || selected?.revision.path || tr("未选择文件", "No file selected")}
                  </div>
                  {selected && (
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {selected.revision.path}
                    </div>
                  )}
                </div>

                {/* Revision Switcher */}
                {selected && selectedArtifact && selectedArtifact.revisions.length > 1 && (
                  <select
                    aria-label={tr("选择作品版本", "Select revision")}
                    className="ml-2 rounded-lg border border-border/60 bg-background px-2 py-1 text-xs font-mono text-muted-foreground focus:text-foreground"
                    value={previewRevisionId || selected.revision.id}
                    onChange={(e) => {
                      const rev = selectedArtifact.revisions.find(r => r.id === e.target.value);
                      if (rev) void openRevision(selectedArtifact, rev);
                    }}
                  >
                    {selectedArtifact.revisions.map((rev) => (
                      <option key={rev.id} value={rev.id}>
                        {rev.status === "current" ? "★ " : ""}{rev.id.slice(0, 10)} ({rev.status})
                      </option>
                    ))}
                  </select>
                )}

                {/* Compare Diff Button */}
                {selected && selectedArtifact?.currentRevisionId && selectedArtifact.currentRevisionId !== selected.revision.id && (
                  <button
                    type="button"
                    onClick={() => void compareCurrent()}
                    className="px-2.5 py-1 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  >
                    {tr("比对当前版", "Diff")}
                  </button>
                )}

                {/* Adopt Revision Button */}
                {selected && selectedArtifact && selectedArtifact.currentRevisionId !== selected.revision.id && (
                  <button
                    type="button"
                    onClick={() => void adoptRevision()}
                    className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    {tr("采用此版本", "Adopt")}
                  </button>
                )}
              </div>

              {/* Reader Display & Edit Mode Tools */}
              <div className="flex items-center gap-2">
                {/* Theme Selector (Paper, Mint, Default, Dark) */}
                <div className="flex items-center gap-1 bg-background/80 border border-border/50 rounded-lg p-0.5">
                  {(["paper", "mint", "default", "dark"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setReaderTheme(t)}
                      className={`w-6 h-6 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center justify-center ${
                        readerTheme === t ? "ring-2 ring-primary scale-105" : "opacity-70 hover:opacity-100"
                      } ${THEME_STYLES[t].bg} ${THEME_STYLES[t].text}`}
                      title={THEME_STYLES[t].desc}
                    >
                      {t === "paper" ? "📜" : t === "mint" ? "🌿" : t === "dark" ? "🌙" : "⚪"}
                    </button>
                  ))}
                </div>

                {/* Font Size Adjuster */}
                <div className="hidden sm:flex items-center gap-0.5 bg-background/80 border border-border/50 rounded-lg p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const sizes: Array<"sm" | "md" | "lg" | "xl"> = ["sm", "md", "lg", "xl"];
                      const idx = sizes.indexOf(fontSize);
                      if (idx > 0) setFontSize(sizes[idx - 1]);
                    }}
                    disabled={fontSize === "sm"}
                    className="px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-30 cursor-pointer font-bold"
                    title={tr("缩小字号", "Decrease font size")}
                  >
                    A-
                  </button>
                  <span className="text-[10px] text-muted-foreground font-mono px-1">{fontSize.toUpperCase()}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const sizes: Array<"sm" | "md" | "lg" | "xl"> = ["sm", "md", "lg", "xl"];
                      const idx = sizes.indexOf(fontSize);
                      if (idx < sizes.length - 1) setFontSize(sizes[idx + 1]);
                    }}
                    disabled={fontSize === "xl"}
                    className="px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-30 cursor-pointer font-bold"
                    title={tr("放大字号", "Increase font size")}
                  >
                    A+
                  </button>
                </div>

                {/* Font Family Toggle (Serif vs Sans) */}
                <button
                  type="button"
                  onClick={() => setFontFamily(fontFamily === "serif" ? "sans" : "serif")}
                  className="hidden sm:flex px-2 py-1 rounded-lg border border-border/50 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                  title={tr("切换衬线体与黑体", "Toggle Serif / Sans")}
                >
                  {fontFamily === "serif" ? tr("宋体", "Serif") : tr("黑体", "Sans")}
                </button>

                {/* Fullscreen / Zen Mode Toggle */}
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="p-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors"
                  title={tr("全屏专注阅读", "Enter Fullscreen")}
                >
                  <Maximize2 size={15} />
                </button>

                {/* Edit / Save Toggle */}
                {editing ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void saveRevision()}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      <span>{saving ? tr("保存中...", "Saving...") : tr("保存新版本", "Save")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <Eye size={13} />
                      <span>{tr("返回阅读", "Preview")}</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!selected || selected.dataUrl !== undefined}
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border/60 bg-background text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer shadow-xs disabled:opacity-40"
                  >
                    <Pencil size={13} />
                    <span>{tr("直接编辑", "Edit")}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Version Diff Comparison Banner */}
            {comparison?.content !== undefined && selected?.content !== undefined && (
              <div className="m-3 rounded-xl border border-border/60 bg-background/95 p-4 text-xs font-mono shadow-md">
                <div className="flex items-center justify-between font-semibold mb-2">
                  <span className="text-primary">{tr("版本差异对比（− 当前版本，+ 所选版本）", "Version Diff: − Current, + Selected")}</span>
                  <button type="button" onClick={() => setComparison(null)} className="text-muted-foreground hover:text-foreground cursor-pointer">
                    <X size={15} />
                  </button>
                </div>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/30 p-3 leading-5 text-[11.5px]">
                  {revisionDifference(comparison.content, selected.content)}
                </pre>
              </div>
            )}

            {/* Main Reading / Editing Content Sheet */}
            <div
              ref={readerScrollRef}
              className={`flex-1 overflow-y-auto p-4 sm:p-8 lg:p-12 transition-colors duration-300 ${activeTheme.bg} ${activeTheme.text}`}
            >
              {previewLoading ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center gap-3">
                  <Loader2 className="animate-spin text-primary" size={24} />
                  <span className="text-xs text-muted-foreground">{tr("正在打开章节内容...", "Opening chapter...")}</span>
                </div>
              ) : selected?.dataUrl ? (
                /* Image Preview Mode */
                <div className="flex flex-col items-center justify-center p-4 sm:p-8 space-y-4">
                  <div className="max-w-md w-full rounded-2xl overflow-hidden shadow-2xl border border-border/50 bg-background/50">
                    <img
                      src={selected.dataUrl}
                      alt={selected.revision.path}
                      className="w-full h-auto object-contain max-h-[550px]"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {selected.revision.path} · {(selected.revision.byteLength / 1024).toFixed(1)} KB
                  </div>
                </div>
              ) : editing ? (
                /* Direct In-place Editing Mode */
                <div className="h-full flex flex-col space-y-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                    <span>{tr("支持 Ctrl+S 快捷保存", "Press Ctrl+S to save")}</span>
                    <span>{draft.replace(/\s/g, "").length.toLocaleString()} {tr("字", "chars")}</span>
                  </div>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                        e.preventDefault();
                        void saveRevision();
                      }
                    }}
                    placeholder={tr("在此直接编写正文...", "Write your manuscript here...")}
                    className="min-h-[500px] flex-1 w-full resize-none rounded-xl border border-border/60 bg-background/60 p-4 sm:p-6 font-mono text-sm leading-7 outline-none focus:border-primary shadow-inner"
                  />
                </div>
              ) : selected?.content ? (
                /* Authentic Novel Reader View */
                <div className="max-w-2xl lg:max-w-3xl mx-auto space-y-8">
                  {/* Chapter Header */}
                  <div className="text-center border-b border-border/30 pb-6 mb-8">
                    {currentChapterIndex >= 0 && (
                      <div className="text-xs uppercase tracking-widest text-primary font-bold mb-2">
                        {tr(`第 ${categorized.finalChapters[currentChapterIndex].chapterNumber} 章`, `Chapter ${categorized.finalChapters[currentChapterIndex].chapterNumber}`)}
                      </div>
                    )}
                    <h2 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-foreground">
                      {parsedMarkdown?.title || selected.revision.path}
                    </h2>
                    <div className="mt-3 flex items-center justify-center gap-3 text-xs text-muted-foreground/70 font-mono">
                      <span>{(selected.content.replace(/\s/g, "").length).toLocaleString()} {tr("字", "chars")}</span>
                      <span>·</span>
                      <span>{selected.revision.status}</span>
                    </div>
                  </div>

                  {/* Novel Paragraphs */}
                  <div className={`space-y-5 text-justify ${fontFamily === "serif" ? "font-serif" : "font-sans"} ${activeFontSize}`}>
                    {parsedMarkdown?.body ? (
                      parsedMarkdown.body.split(/\n\n+/).filter(Boolean).map((para, idx) => {
                        const trimmed = para.trim();
                        if (trimmed.startsWith("## ")) {
                          return (
                            <h3 key={idx} className="text-lg sm:text-xl font-bold font-serif my-6 pt-4 border-t border-border/20 text-center">
                              {trimmed.replace(/^##\s*/, "")}
                            </h3>
                          );
                        }
                        if (trimmed.startsWith("### ")) {
                          return (
                            <h4 key={idx} className="text-base font-semibold my-4 text-center">
                              {trimmed.replace(/^###\s*/, "")}
                            </h4>
                          );
                        }
                        return (
                          <p key={idx} className="indent-[2em] my-3.5 tracking-wide select-text">
                            {trimmed}
                          </p>
                        );
                      })
                    ) : (
                      <pre className="whitespace-pre-wrap font-mono text-xs">{selected.content}</pre>
                    )}
                  </div>

                  {/* Chapter Bottom Pagination Navigation */}
                  {categorized.finalChapters.length > 0 && currentChapterIndex >= 0 && (
                    <div className="mt-14 pt-6 border-t border-border/30 flex items-center justify-between">
                      <button
                        type="button"
                        disabled={!prevChapter}
                        onClick={() => prevChapter && void openRevision(prevChapter.artifact, prevChapter.revision)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-border/60 hover:bg-muted disabled:opacity-25 disabled:pointer-events-none transition-colors cursor-pointer"
                      >
                        <ChevronLeft size={16} />
                        <span>{tr("上一章", "Previous chapter")}</span>
                      </button>

                      <span className="text-xs text-muted-foreground font-mono">
                        {currentChapterIndex + 1} / {categorized.finalChapters.length}
                      </span>

                      <button
                        type="button"
                        disabled={!nextChapter}
                        onClick={() => nextChapter && void openRevision(nextChapter.artifact, nextChapter.revision)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-25 disabled:pointer-events-none transition-opacity cursor-pointer shadow-xs"
                      >
                        <span>{tr("下一章", "Next chapter")}</span>
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
                  <BookOpen size={32} className="opacity-40" />
                  <span>{tr("请在左侧目录选择要阅读或编辑的章节", "Select a chapter from the table of contents to read or edit.")}</span>
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      {/* TAB 2: All Artifacts and Revisions (Preserved developer & raw assets list) */}
      {activeTab === "artifacts" && (
        <section className="space-y-4">
          <div className="mb-4 flex items-center gap-2">
            <FileText size={18} className="text-primary" />
            <h2 className="text-xl font-semibold">{tr("全部生成物与版本", "Artifacts and revisions")}</h2>
          </div>
          <div className="grid gap-3">
            {currentRevisions.map(({ artifact, revision }) => (
              <div
                key={artifact.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-border/55 bg-card p-4 transition hover:border-primary/40 hover:bg-primary/[0.02]"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm text-foreground truncate">{revision?.path ?? artifact.id}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {artifact.kind} · {artifact.revisions.length} revision(s) · {revision?.status}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {revision && (
                    <button
                      type="button"
                      onClick={() => {
                        void openRevision(artifact, revision);
                        setActiveTab("reader");
                      }}
                      className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground text-xs font-semibold transition-colors cursor-pointer"
                    >
                      {tr("阅读与编辑", "Read & Edit")}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {currentRevisions.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {tr("尚无生成物。", "No artifacts yet.")}
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB 3: Creative Profile & Methods */}
      {activeTab === "methods" && (
        <section className="space-y-4">
          <CreativeMethodsEditor profileId={data.work.profileId} />
        </section>
      )}

      {/* TAB 4: Execution History */}
      {activeTab === "episodes" && (
        <section className="space-y-4">
          <div className="mb-4 flex items-center gap-2">
            <Clock3 size={18} className="text-primary" />
            <h2 className="text-xl font-semibold">{tr("执行记录", "Execution history")}</h2>
          </div>
          <div className="space-y-2">
            {data.episodes.map((episode) => (
              <button
                type="button"
                key={episode.id}
                onClick={() => {
                  void fetchJson<{ events: Array<{ seq: number; type: string; payload: unknown }> }>(
                    `/episodes/${encodeURIComponent(episode.id)}`,
                  )
                    .then((result) => setEvents(result.events))
                    .catch((err) => setOperationError(String(err)));
                }}
                className="flex w-full items-center justify-between rounded-xl border border-border/45 bg-secondary/20 px-4 py-3 text-sm hover:bg-secondary/40 transition-colors cursor-pointer"
              >
                <span className="truncate font-mono text-xs">{episode.id}</span>
                <span className={`ml-4 shrink-0 font-medium text-xs px-2 py-0.5 rounded-full ${
                  episode.status === "completed" ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"
                }`}>
                  {episode.status}
                </span>
              </button>
            ))}
            {data.episodes.length === 0 && (
              <div className="text-sm text-muted-foreground rounded-xl border border-dashed border-border p-8 text-center">
                {tr("尚无执行记录。", "No Episodes yet.")}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Raw Episode Event Stream Modal */}
      {events && (
        <div className="fixed inset-0 z-[100] overflow-auto bg-background/95 p-8 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto">
            <button
              type="button"
              className="mb-4 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted cursor-pointer"
              onClick={() => setEvents(null)}
            >
              {tr("关闭执行记录", "Close execution history")}
            </button>
            <div className="space-y-2">
              {events.map((event) => (
                <details key={event.seq} className="rounded-xl border border-border/50 bg-card p-3">
                  <summary className="cursor-pointer font-mono text-xs font-medium">
                    #{event.seq} · {event.type}
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap break-all text-xs font-mono bg-secondary/30 p-3 rounded-lg">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </details>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Zen Reader Modal mounted via Portal to document.body */}
      {zenMode && typeof document !== "undefined" && createPortal(
        <div className={`fixed inset-0 z-[9999] flex flex-col ${activeTheme.bg} ${activeTheme.text}`}>
          {/* Top Bar */}
          <div className="px-4 sm:px-8 py-3 border-b border-border/40 flex items-center justify-between gap-4 bg-background/60 backdrop-blur-md shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <BookOpen size={18} className="text-primary shrink-0" />
              <span className="font-serif font-bold text-sm sm:text-base text-foreground truncate">
                {parsedMarkdown?.title || data.work.title}
              </span>
              {currentChapterIndex >= 0 && (
                <span className="text-xs text-muted-foreground font-mono shrink-0">
                  ({currentChapterIndex + 1}/{categorized.finalChapters.length})
                </span>
              )}
            </div>

            {/* Center Controls */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Theme Selector */}
              <div className="flex items-center gap-1 bg-background/80 border border-border/50 rounded-lg p-0.5">
                {(["paper", "mint", "default", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setReaderTheme(t)}
                    className={`w-6 h-6 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center justify-center ${
                      readerTheme === t ? "ring-2 ring-primary scale-105" : "opacity-70 hover:opacity-100"
                    } ${THEME_STYLES[t].bg} ${THEME_STYLES[t].text}`}
                    title={THEME_STYLES[t].desc}
                  >
                    {t === "paper" ? "📜" : t === "mint" ? "🌿" : t === "dark" ? "🌙" : "⚪"}
                  </button>
                ))}
              </div>

              {/* Font Size A- / A+ */}
              <div className="hidden sm:flex items-center gap-1 bg-background/80 border border-border/50 rounded-lg px-2 py-0.5 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    const sizes: Array<"sm" | "md" | "lg" | "xl"> = ["sm", "md", "lg", "xl"];
                    const idx = sizes.indexOf(fontSize);
                    if (idx > 0) setFontSize(sizes[idx - 1]);
                  }}
                  disabled={fontSize === "sm"}
                  className="px-1 hover:text-primary disabled:opacity-30 cursor-pointer"
                >
                  A-
                </button>
                <span className="text-[10px] text-muted-foreground font-mono px-1">{fontSize.toUpperCase()}</span>
                <button
                  type="button"
                  onClick={() => {
                    const sizes: Array<"sm" | "md" | "lg" | "xl"> = ["sm", "md", "lg", "xl"];
                    const idx = sizes.indexOf(fontSize);
                    if (idx < sizes.length - 1) setFontSize(sizes[idx + 1]);
                  }}
                  disabled={fontSize === "xl"}
                  className="px-1 hover:text-primary disabled:opacity-30 cursor-pointer"
                >
                  A+
                </button>
              </div>

              {/* Font Family Toggle */}
              <button
                type="button"
                onClick={() => setFontFamily(fontFamily === "serif" ? "sans" : "serif")}
                className="hidden sm:flex px-2.5 py-1 rounded-lg border border-border/50 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
              >
                {fontFamily === "serif" ? tr("宋体", "Serif") : tr("黑体", "Sans")}
              </button>

              {/* Exit Fullscreen */}
              <button
                type="button"
                onClick={toggleFullscreen}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border/60 bg-background text-xs font-semibold text-foreground hover:bg-muted cursor-pointer shadow-xs transition-colors"
              >
                <Minimize2 size={14} />
                <span>{tr("退出全屏 (Esc)", "Exit Fullscreen (Esc)")}</span>
              </button>
            </div>
          </div>

          {/* Reading Area */}
          <div ref={zenScrollRef} className="flex-1 overflow-y-auto px-6 py-10 md:px-16 lg:px-32">
            <div className="max-w-3xl mx-auto space-y-8">
              {/* Header */}
              <div className="text-center border-b border-border/30 pb-6 mb-8">
                {currentChapterIndex >= 0 && (
                  <div className="text-xs uppercase tracking-widest text-primary font-bold mb-2">
                    {tr(`第 ${categorized.finalChapters[currentChapterIndex].chapterNumber} 章`, `Chapter ${categorized.finalChapters[currentChapterIndex].chapterNumber}`)}
                  </div>
                )}
                <h1 className="text-3xl sm:text-4xl font-serif font-bold tracking-tight text-foreground">
                  {parsedMarkdown?.title || selected?.revision.path}
                </h1>
                <div className="mt-3 flex items-center justify-center gap-3 text-xs opacity-60 font-mono">
                  <span>{(selected?.content?.replace(/\s/g, "").length ?? 0).toLocaleString()} {tr("字", "chars")}</span>
                </div>
              </div>

              {/* Paragraphs */}
              <div className={`space-y-6 text-justify ${fontFamily === "serif" ? "font-serif" : "font-sans"} ${activeFontSize}`}>
                {parsedMarkdown?.body ? (
                  parsedMarkdown.body.split(/\n\n+/).filter(Boolean).map((para, idx) => {
                    const trimmed = para.trim();
                    if (trimmed.startsWith("## ")) {
                      return (
                        <h2 key={idx} className="text-xl sm:text-2xl font-bold font-serif my-8 pt-4 border-t border-border/20 text-center">
                          {trimmed.replace(/^##\s*/, "")}
                        </h2>
                      );
                    }
                    if (trimmed.startsWith("### ")) {
                      return (
                        <h3 key={idx} className="text-lg font-semibold my-6 text-center">
                          {trimmed.replace(/^###\s*/, "")}
                        </h3>
                      );
                    }
                    return (
                      <p key={idx} className="indent-[2em] my-4 tracking-wide leading-relaxed md:leading-[2.4] select-text">
                        {trimmed}
                      </p>
                    );
                  })
                ) : (
                  <pre className="whitespace-pre-wrap font-mono text-xs">{selected?.content}</pre>
                )}
              </div>

              {/* Bottom Pagination */}
              {categorized.finalChapters.length > 0 && currentChapterIndex >= 0 && (
                <div className="mt-16 pt-8 border-t border-border/30 flex items-center justify-between pb-12">
                  <button
                    type="button"
                    disabled={!prevChapter}
                    onClick={() => prevChapter && void openRevision(prevChapter.artifact, prevChapter.revision)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold border border-border/60 hover:bg-muted disabled:opacity-25 disabled:pointer-events-none transition-colors cursor-pointer"
                  >
                    <ChevronLeft size={16} />
                    <span>{tr("上一章", "Previous chapter")}</span>
                  </button>

                  <span className="text-sm opacity-60 font-mono">
                    {currentChapterIndex + 1} / {categorized.finalChapters.length}
                  </span>

                  <button
                    type="button"
                    disabled={!nextChapter}
                    onClick={() => nextChapter && void openRevision(nextChapter.artifact, nextChapter.revision)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-25 disabled:pointer-events-none transition-opacity cursor-pointer shadow-md"
                  >
                    <span>{tr("下一章", "Next chapter")}</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
