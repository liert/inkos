import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import { Eye, EyeOff, Loader2, ArrowLeft, Plus, Trash2, X, Settings, RotateCcw, SlidersHorizontal, Check } from "lucide-react";
import { ServiceQuickLinks } from "../components/ServiceQuickLinks";
import { tr } from "../lib/app-language";
import { isLLMApiFormat } from "@actalk/inkos-core/llm/api-format";
import {
  deleteServiceConfig,
  matchServiceConfigEntryForDetail,
  mergeServiceDetailModels,
  probeServiceForDetail,
  rehydrateServiceConnectionStatus,
  saveServiceConfig,
  type ServiceDetailConnectionStatus as ConnectionStatus,
  type ServiceDetailDetectedConfig as DetectedConfig,
  type ServiceDetailModelInfo as ModelInfo,
  type ServiceDetailVerifiedProbe as VerifiedProbe,
  type LLMApiFormat,
} from "./service-detail-state";

interface Nav {
  toServices: () => void;
}

function DetailSkeleton() {
  return (
    <div className="max-w-xl mx-auto space-y-6 animate-pulse">
      <div className="h-4 w-16 bg-muted rounded" />
      <div className="h-7 w-40 bg-muted rounded" />
      <div className="space-y-2"><div className="h-3 w-16 bg-muted/60 rounded" /><div className="h-10 w-full bg-muted/40 rounded-lg" /></div>
      <div className="h-9 w-24 bg-muted/40 rounded-lg" />
    </div>
  );
}

export function ServiceDetailPage({ serviceId, nav }: { serviceId: string; nav: Nav }) {
  // -- Service store --
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);
  const setStoreModels = useServiceStore((s) => s.setLiveModels);
  const clearStoreModels = useServiceStore((s) => s.clearModels);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  const svc = services.find((s) => s.service === serviceId);
  const isCustom = serviceId === "custom" || serviceId.startsWith("custom:");
  const persistedCustomName = serviceId.startsWith("custom:") ? decodeURIComponent(serviceId.slice("custom:".length)) : "";

  // -- Local form state --
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [customName, setCustomName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [topP, setTopP] = useState("0.95");
  const [contextWindow, setContextWindow] = useState("128000");
  const [maxOutput, setMaxOutput] = useState("4096");
  const [thinkingBudget, setThinkingBudget] = useState("0");
  const [apiFormat, setApiFormat] = useState<LLMApiFormat>("chat");
  const [stream, setStream] = useState(true);
  const [detectedModel, setDetectedModel] = useState<string>("");
  const [detectedConfig, setDetectedConfig] = useState<DetectedConfig | null>(null);
  const [verifiedProbe, setVerifiedProbe] = useState<VerifiedProbe | null>(null);
  const [configuredModels, setConfiguredModels] = useState<ModelInfo[]>([]);
  const [editingModel, setEditingModel] = useState<ModelInfo | null>(null);
  const [modelIdInput, setModelIdInput] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  // -- Unified connection status --
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle" });

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ services: Array<Record<string, unknown>> }>("/services/config")
      .then((data) => {
        if (cancelled) return;
        const matched = matchServiceConfigEntryForDetail(data.services ?? [], serviceId);
        if (!matched) return;
        if (isCustom) {
          setCustomName(String(matched.name ?? persistedCustomName));
          setBaseUrl(String(matched.baseUrl ?? ""));
        }
        if (typeof matched.temperature === "number") setTemperature(String(matched.temperature));
        if (typeof matched.topP === "number") setTopP(String(matched.topP));
        if (typeof matched.contextWindow === "number") setContextWindow(String(matched.contextWindow));
        if (typeof matched.maxOutput === "number") setMaxOutput(String(matched.maxOutput));
        if (typeof matched.thinkingBudget === "number") setThinkingBudget(String(matched.thinkingBudget));
        if (isLLMApiFormat(matched.apiFormat)) setApiFormat(matched.apiFormat);
        if (typeof matched.stream === "boolean") setStream(matched.stream);

        const rawConfigs = (matched.modelConfigs && typeof matched.modelConfigs === "object")
          ? matched.modelConfigs as Record<string, Record<string, unknown>>
          : {};

        if (Array.isArray(matched.models)) {
          const modelsWithConfigs = matched.models
            .filter((model): model is string => typeof model === "string")
            .map((id) => {
              const cfg = rawConfigs[id] ?? {};
              return {
                id,
                ...(typeof cfg.contextWindow === "number" ? { contextWindow: cfg.contextWindow } : {}),
                ...(typeof cfg.maxOutput === "number" ? { maxOutput: cfg.maxOutput } : {}),
                ...(typeof cfg.temperature === "number" ? { temperature: cfg.temperature } : {}),
                ...(typeof cfg.topP === "number" ? { topP: cfg.topP } : {}),
                ...(typeof cfg.thinkingBudget === "number" ? { thinkingBudget: cfg.thinkingBudget } : {}),
              };
            });
          setConfiguredModels(mergeServiceDetailModels(modelsWithConfigs));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isCustom, persistedCustomName, serviceId]);

  const resolvedCustomName = persistedCustomName || customName.trim() || "Custom";
  const effectiveServiceId = isCustom ? `custom:${resolvedCustomName}` : serviceId;
  const label = isCustom ? (customName || persistedCustomName || tr("自定义服务", "Custom service")) : (svc?.label ?? serviceId);
  const storeModels = useServiceStore((s) => s.modelsByService[effectiveServiceId]);

  useEffect(() => {
    let cancelled = false;
    void rehydrateServiceConnectionStatus({
      effectiveServiceId,
      shouldVerify: Boolean(svc?.connected),
      isCustom,
      baseUrl,
      apiFormat,
      stream,
    })
      .then((result) => {
        if (cancelled) return;
        setApiKey(result.apiKey);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setStatus(result.status);
        if (result.status.state === "connected") {
          setStoreModels(effectiveServiceId, result.status.models);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ state: "idle" });
      });
    return () => { cancelled = true; };
  }, [
    apiFormat,
    baseUrl,
    effectiveServiceId,
    isCustom,
    setStoreModels,
    stream,
    svc?.connected,
  ]);

  if (loading) return <DetailSkeleton />;

  // -- Derived state --
  const isConnected = Boolean(svc?.connected);
  const apiKeyOptional = Boolean(svc?.apiKeyOptional);
  const models = mergeServiceDetailModels(
    configuredModels,
    status.state === "connected" ? status.models : undefined,
    storeModels,
  );
  const hasModelCatalog = models.length > 0 || status.state === "connected";
  const isBusy = status.state === "testing" || status.state === "saving";

  // -- Handlers --
  const handleTest = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey && !isCustom && !apiKeyOptional) {
      setStatus({ state: "error", message: tr("请先输入 API Key", "Enter an API key first") });
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: tr("请先填写 Base URL", "Enter a base URL first") });
      return;
    }
    setApiKey(trimmedKey);
    setSaveFeedback(null);
    setStatus({ state: "testing" });
    try {
      const preferredModel = modelIdInput.trim() || configuredModels[0]?.id || detectedModel || undefined;
      const result = await probeServiceForDetail(effectiveServiceId, {
        apiKey: trimmedKey,
        apiFormat,
        stream,
        ...(preferredModel ? { preferredModel } : {}),
        ...(isCustom ? { baseUrl: baseUrl.trim() } : {}),
      });
      if (result.ok) {
        const models = result.models ?? [];
        const verifiedApiFormat = result.detected?.apiFormat ?? apiFormat;
        const verifiedStream = typeof result.detected?.stream === "boolean" ? result.detected.stream : stream;
        const verifiedBaseUrl = isCustom ? (result.detected?.baseUrl ?? baseUrl.trim()) : "";
        if (result.detected?.apiFormat) setApiFormat(result.detected.apiFormat);
        if (typeof result.detected?.stream === "boolean") setStream(result.detected.stream);
        if (isCustom && result.detected?.baseUrl) setBaseUrl(result.detected.baseUrl);
        setDetectedModel(result.selectedModel ?? "");
        setDetectedConfig(result.detected ?? null);
        setVerifiedProbe({
          apiKey: trimmedKey,
          baseUrl: verifiedBaseUrl,
          apiFormat: verifiedApiFormat,
          stream: verifiedStream,
          models,
          selectedModel: result.selectedModel,
          detected: result.detected,
        });
        const mergedModels = mergeServiceDetailModels(configuredModels, preferredModel ? [preferredModel] : undefined, models);
        setConfiguredModels(mergedModels);
        setStatus({ state: "connected", models: mergedModels });
        setStoreModels(effectiveServiceId, mergedModels); // Write to global store
      } else {
        setVerifiedProbe(null);
        setStatus({ state: "error", message: result.error ?? tr("连接失败", "Connection failed") });
        clearStoreModels(effectiveServiceId);
      }
    } catch (e) {
      setVerifiedProbe(null);
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("连接失败", "Connection failed") });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(tr(`删除“${label}”的配置和密钥？`, `Delete the config and key for “${label}”?`))) return;
    setStatus({ state: "saving" });
    try {
      await deleteServiceConfig(effectiveServiceId);
      clearStoreModels(effectiveServiceId);
      await refreshServices();
      nav.toServices();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("删除失败", "Delete failed") });
    }
  };

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    setApiKey(trimmedKey);
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: tr("请先填写 Base URL", "Enter a base URL first") });
      return;
    }
    setStatus({ state: "saving" });
    try {
      const result = await saveServiceConfig({
        effectiveServiceId,
        serviceId,
        isCustom,
        apiKeyOptional,
        resolvedCustomName,
        apiKey: trimmedKey,
        baseUrl,
        apiFormat,
        stream,
        temperature,
        topP,
        contextWindow,
        maxOutput,
        thinkingBudget,
        detectedModel,
        configuredModels,
        verifiedProbe,
      });
      if (result.status.state === "connected") {
        if (result.detectedConfig?.apiFormat) setApiFormat(result.detectedConfig.apiFormat);
        if (typeof result.detectedConfig?.stream === "boolean") setStream(result.detectedConfig.stream);
        if (isCustom && result.detectedConfig?.baseUrl) setBaseUrl(result.detectedConfig.baseUrl);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setConfiguredModels(result.status.models);
        setStoreModels(effectiveServiceId, result.status.models);
        setStatus(result.status);
        setSaveFeedback(tr(
          `已保存 ${result.status.models.length} 个模型，创作选择器将使用这份目录。`,
          `Saved ${result.status.models.length} models. The writing picker will use this catalog.`,
        ));
      } else {
        setStatus(result.status);
        if (result.status.state === "error") return;
      }
      await refreshServices();
      await fetchBankModels();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("保存失败", "Save failed") });
    }
  };

  const handleResetAdvancedDefaults = () => {
    setTemperature("0.7");
    setTopP("0.95");
    setContextWindow("128000");
    setMaxOutput("4096");
    setThinkingBudget("0");
  };

  const handleSaveModelOverride = (updated: ModelInfo) => {
    const next = configuredModels.map((m) =>
      m.id.toLowerCase() === updated.id.toLowerCase() ? updated : m
    );
    setConfiguredModels(next);
    setStoreModels(effectiveServiceId, next);
    if (status.state === "connected") setStatus({ state: "connected", models: next });
    setEditingModel(null);
  };

  const handleAddModel = () => {
    const next = mergeServiceDetailModels(configuredModels, [modelIdInput]);
    if (next.length === configuredModels.length) return;
    setConfiguredModels(next);
    setStoreModels(effectiveServiceId, next);
    if (status.state === "connected") setStatus({ state: "connected", models: next });
    setModelIdInput("");
  };

  const handleRemoveModel = (modelId: string) => {
    const next = models.filter((model) => model.id.toLowerCase() !== modelId.toLowerCase());
    setConfiguredModels(next);
    setStoreModels(effectiveServiceId, next);
    if (status.state === "connected") setStatus({ state: "connected", models: next });
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={nav.toServices}
        className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors"
      >
        <ArrowLeft size={14} />
        {tr("返回服务商管理", "Back to providers")}
      </button>

      {/* Title + status */}
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{label}</h1>
        {isConnected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
            {tr("已连接", "Connected")}
          </span>
        )}
      </div>
      <ServiceQuickLinks serviceId={serviceId} />

      <div className="space-y-5">
        {/* Custom fields */}
        {isCustom && (
        <div className="grid grid-cols-2 gap-4">
            <Field label={tr("服务名称", "Service name")}>
              <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
                placeholder={tr("例如：本地 Ollama", "e.g. local Ollama")} className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Base URL">
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono" />
            </Field>
          </div>
        )}

        {/* API Key */}
        <Field label={apiKeyOptional ? tr("API Key（可选）", "API key (optional)") : "API Key"}>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"} value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} placeholder={apiKeyOptional ? tr("本地服务可留空", "Optional for local service") : "sk-..."}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 pr-10 text-sm font-mono"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>

        {/* Actions + feedback */}
        <div className="flex items-center gap-2">
          <button onClick={handleTest} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-border/60 hover:bg-secondary/50 transition-colors disabled:opacity-50">
            {status.state === "testing" && <Loader2 size={12} className="animate-spin" />}
            {tr("测试连接", "Test connection")}
          </button>
          <button onClick={handleSave} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
            {status.state === "saving" && <Loader2 size={12} className="animate-spin" />}
            {tr("保存", "Save")}
          </button>
          {(isConnected || isCustom) && (
            <button onClick={handleDelete} disabled={isBusy}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50">
              <Trash2 size={12} />
              {tr("删除配置", "Delete config")}
            </button>
          )}
          {/* Status feedback */}
          {status.state === "connected" && (
            <span className="text-xs text-emerald-500">
              {saveFeedback ?? (
                <>
                  {tr(`连接成功，${models.length} 个模型`, `Connected, ${models.length} models`)}
                  {detectedModel
                    ? tr(
                        `，已自动匹配 ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "anthropic" ? "Anthropic Messages" : detectedConfig.apiFormat === "responses" ? "Responses" : "Chat / Completions"} / ${detectedConfig.stream ? "流式" : "非流式"}` : ""}`,
                        `, auto-matched ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "anthropic" ? "Anthropic Messages" : detectedConfig.apiFormat === "responses" ? "Responses" : "Chat / Completions"} / ${detectedConfig.stream ? "streaming" : "non-streaming"}` : ""}`,
                      )
                    : ""}
                </>
              )}
            </span>
          )}
          {status.state === "error" && (
            <span className="text-xs text-destructive">{status.message}</span>
          )}
          {status.state === "saved" && (
            <span className="text-xs text-emerald-500">{saveFeedback ?? tr("已保存", "Saved")}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={tr("协议类型", "Protocol")}>
            <select
              value={apiFormat}
              onChange={(e) => setApiFormat(e.target.value as LLMApiFormat)}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <option value="chat">OpenAI Chat Completions</option>
              <option value="responses">OpenAI Responses</option>
              <option value="anthropic">Anthropic Messages</option>
            </select>
          </Field>

          <Field label={tr("流式响应", "Streaming")}>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm">
              <input
                type="checkbox"
                checked={stream}
                onChange={(e) => setStream(e.target.checked)}
              />
              <span>{stream ? tr("开启", "On") : tr("关闭", "Off")}</span>
            </label>
          </Field>
        </div>

        {/* Models */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">
            {tr(`模型目录（${models.length}）`, `Model catalog (${models.length})`)}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={modelIdInput}
              onChange={(event) => setModelIdInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddModel();
                }
              }}
              placeholder={tr("输入模型 ID，例如 gemini-3.1-pro", "Enter a model ID, e.g. gemini-3.1-pro")}
              className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
            />
            <button
              type="button"
              onClick={handleAddModel}
              disabled={!modelIdInput.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs hover:bg-secondary/50 disabled:opacity-40"
            >
              <Plus size={13} />
              {tr("添加", "Add")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground/60">
            {tr("先点“测试连接”拉取最新列表，再点“保存”写入创作选择器。内置目录只在还没有保存过快照时作为兜底。", "Click “Test connection” to fetch the latest list, then “Save” to write it into the writing picker. The built-in catalog is only a fallback before a snapshot is saved.")}
          </p>
          {hasModelCatalog && (
          <div className="space-y-2">
            {models.length > 0 ? (
              <div className="flex gap-1.5 flex-wrap">
                {models.map((m) => {
                  const hasCustom = m.contextWindow !== undefined
                    || m.maxOutput !== undefined
                    || m.temperature !== undefined
                    || m.topP !== undefined
                    || m.thinkingBudget !== undefined;
                  return (
                    <span
                      key={m.id}
                      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400 border border-emerald-500/15"
                    >
                      <span className="font-mono">{m.name ?? m.id}</span>
                      {hasCustom && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono font-medium">
                          {m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : tr("自定义", "Custom")}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingModel(m)}
                        aria-label={tr(`配置模型 ${m.id}`, `Configure model ${m.id}`)}
                        title={tr("配置此模型的高级参数（非必填）", "Configure advanced parameters for this model")}
                        className="rounded-sm opacity-60 hover:opacity-100 transition-opacity text-foreground/80 hover:text-foreground"
                      >
                        <Settings size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveModel(m.id)}
                        aria-label={tr(`移除模型 ${m.id}`, `Remove model ${m.id}`)}
                        className="rounded-sm opacity-60 hover:opacity-100 transition-opacity"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60">{tr("点击“测试连接”查看可用模型", "Click “Test connection” to list available models")}</p>
            )}
          </div>
          )}
        </div>

        {/* Advanced params */}
        <details className="group pt-2 border-t border-border/20" open={false}>
          <summary className="text-xs text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground transition-colors py-2 flex items-center justify-between">
            <span className="font-medium flex items-center gap-1.5">
              <SlidersHorizontal size={13} />
              {tr("高级参数（非必填）", "Advanced Parameters (Optional)")}
            </span>
            <span className="text-[10px] text-muted-foreground/50">
              {tr("已设默认值，留空自动生效", "Defaults set, optional")}
            </span>
          </summary>
          <div className="space-y-4 pt-3 pb-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground/70 bg-secondary/30 p-2.5 rounded-lg border border-border/30">
              <span>{tr("这些参数将作为本服务下所有模型的通用默认值，也可点击各模型右侧的 ⚙️ 设置专属参数。", "These parameters apply as defaults for all models in this service. Individual models can also have dedicated overrides via ⚙️.")}</span>
              <button
                type="button"
                onClick={handleResetAdvancedDefaults}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border/40 hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2"
                title={tr("将所有高级参数恢复为系统推荐默认值", "Reset all parameters to system defaults")}
              >
                <RotateCcw size={11} />
                {tr("恢复默认值", "Reset defaults")}
              </button>
            </div>

            {/* Context Window */}
            <Field label={tr("上下文窗口 (Context Window, tokens)", "Context Window (tokens)")}>
              <div className="space-y-1.5">
                <input
                  type="number"
                  value={contextWindow}
                  onChange={(e) => setContextWindow(e.target.value)}
                  placeholder="128000"
                  min="1000"
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
                />
                <div className="flex gap-1.5 flex-wrap">
                  {[
                    { label: "32K", value: "32768" },
                    { label: "64K", value: "65536" },
                    { label: "128K (推荐默认)", value: "128000" },
                    { label: "200K", value: "200000" },
                    { label: "1M", value: "1000000" },
                  ].map((pill) => (
                    <button
                      key={pill.value}
                      type="button"
                      onClick={() => setContextWindow(pill.value)}
                      className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                        contextWindow === pill.value
                          ? "bg-primary text-primary-foreground border-primary font-medium"
                          : "bg-secondary/40 text-muted-foreground border-border/40 hover:bg-secondary"
                      }`}
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                  {tr(
                    "单次请求支持的最大上下文总量（包含提示词与生成文本），默认 128,000。若遇到“上下文超预算”错误，可调大此值匹配模型实际窗口。",
                    "Maximum context window tokens. Default is 128,000. Increase if context budget errors occur to match model's actual capacity.",
                  )}
                </p>
              </div>
            </Field>

            {/* Max Output */}
            <Field label={tr("最大输出长度 (Max Output Tokens)", "Max Output Tokens")}>
              <div className="space-y-1.5">
                <input
                  type="number"
                  value={maxOutput}
                  onChange={(e) => setMaxOutput(e.target.value)}
                  placeholder="4096"
                  min="256"
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
                />
                <div className="flex gap-1.5 flex-wrap">
                  {[
                    { label: "2K", value: "2048" },
                    { label: "4K (推荐默认)", value: "4096" },
                    { label: "8K", value: "8192" },
                    { label: "16K", value: "16384" },
                  ].map((pill) => (
                    <button
                      key={pill.value}
                      type="button"
                      onClick={() => setMaxOutput(pill.value)}
                      className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                        maxOutput === pill.value
                          ? "bg-primary text-primary-foreground border-primary font-medium"
                          : "bg-secondary/40 text-muted-foreground border-border/40 hover:bg-secondary"
                      }`}
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                  {tr(
                    "单次生成允许的最大 token 数量，默认 4,096。",
                    "Maximum generated tokens per request. Default is 4,096.",
                  )}
                </p>
              </div>
            </Field>

            {/* Temperature */}
            <Field label={tr("采样温度 (Temperature)", "Temperature")}>
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    className="flex-1 accent-primary h-1"
                  />
                  <input
                    type="number"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    min="0"
                    max="2"
                    step="0.05"
                    className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground/60">
                  {tr("控制回答创造力与随机度（0.0 严谨，2.0 奔放），默认 0.70。", "Controls randomness and creativity. Default is 0.70.")}
                </p>
              </div>
            </Field>

            {/* Top-P */}
            <Field label={tr("Top-P 采样 (Nucleus Sampling)", "Top-P Sampling")}>
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={topP}
                    onChange={(e) => setTopP(e.target.value)}
                    className="flex-1 accent-primary h-1"
                  />
                  <input
                    type="number"
                    value={topP}
                    onChange={(e) => setTopP(e.target.value)}
                    min="0"
                    max="1"
                    step="0.01"
                    className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground/60">
                  {tr("核采样阈值，推荐保持默认值 0.95。", "Nucleus sampling threshold. Default is 0.95.")}
                </p>
              </div>
            </Field>

            {/* Thinking Budget */}
            <Field label={tr("思考预算 (Thinking Budget, tokens)", "Thinking Budget (tokens)")}>
              <div className="space-y-1">
                <input
                  type="number"
                  value={thinkingBudget}
                  onChange={(e) => setThinkingBudget(e.target.value)}
                  placeholder="0"
                  min="0"
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
                />
                <p className="text-[11px] text-muted-foreground/60">
                  {tr("针对思考推理模型（例如 DeepSeek R1、o1 等）的思考 token 预算，0 表示关闭或自动。", "Thinking token budget for reasoning models. 0 for auto/disabled.")}
                </p>
              </div>
            </Field>
          </div>
        </details>
      </div>

      {/* Model-specific settings modal */}
      {editingModel && (
        <ModelSettingsModal
          model={editingModel}
          serviceDefaults={{
            contextWindow,
            maxOutput,
            temperature,
            topP,
            thinkingBudget,
          }}
          onSave={handleSaveModelOverride}
          onClose={() => setEditingModel(null)}
        />
      )}
    </div>
  );
}

function ModelSettingsModal({
  model,
  serviceDefaults,
  onSave,
  onClose,
}: {
  model: ModelInfo;
  serviceDefaults: {
    contextWindow: string;
    maxOutput: string;
    temperature: string;
    topP: string;
    thinkingBudget: string;
  };
  onSave: (updated: ModelInfo) => void;
  onClose: () => void;
}) {
  const [contextWindow, setContextWindow] = useState(
    model.contextWindow !== undefined ? String(model.contextWindow) : ""
  );
  const [maxOutput, setMaxOutput] = useState(
    model.maxOutput !== undefined ? String(model.maxOutput) : ""
  );
  const [temperature, setTemperature] = useState(
    model.temperature !== undefined ? String(model.temperature) : ""
  );
  const [topP, setTopP] = useState(
    model.topP !== undefined ? String(model.topP) : ""
  );
  const [thinkingBudget, setThinkingBudget] = useState(
    model.thinkingBudget !== undefined ? String(model.thinkingBudget) : ""
  );

  const handleClear = () => {
    setContextWindow("");
    setMaxOutput("");
    setTemperature("");
    setTopP("");
    setThinkingBudget("");
  };

  const handleApply = () => {
    const parsedCw = contextWindow.trim() ? parseInt(contextWindow, 10) : undefined;
    const parsedMo = maxOutput.trim() ? parseInt(maxOutput, 10) : undefined;
    const parsedTemp = temperature.trim() ? parseFloat(temperature) : undefined;
    const parsedTp = topP.trim() ? parseFloat(topP) : undefined;
    const parsedTb = thinkingBudget.trim() ? parseInt(thinkingBudget, 10) : undefined;

    onSave({
      id: model.id,
      name: model.name,
      contextWindow: parsedCw !== undefined && !Number.isNaN(parsedCw) ? parsedCw : undefined,
      maxOutput: parsedMo !== undefined && !Number.isNaN(parsedMo) ? parsedMo : undefined,
      temperature: parsedTemp !== undefined && !Number.isNaN(parsedTemp) ? parsedTemp : undefined,
      topP: parsedTp !== undefined && !Number.isNaN(parsedTp) ? parsedTp : undefined,
      thinkingBudget: parsedTb !== undefined && !Number.isNaN(parsedTb) ? parsedTb : undefined,
    });
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border border-border/70 bg-card p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <div>
            <h3 className="text-base font-semibold font-serif text-foreground">
              {tr("配置模型专属高级参数", "Model Advanced Parameters")}
            </h3>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{model.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-muted-foreground/75 leading-relaxed bg-secondary/30 p-2.5 rounded-lg border border-border/30">
          {tr(
            "非必填项。留空时将自动继承服务的高级参数（括号内所示）。",
            "Optional. Leave blank to inherit service-level defaults (shown in brackets).",
          )}
        </p>

        <div className="space-y-3.5">
          {/* Context Window */}
          <Field label={tr("上下文窗口 (Context Window, tokens)", "Context Window (tokens)")}>
            <div className="space-y-1.5">
              <input
                type="number"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder={tr(`继承服务默认 (${serviceDefaults.contextWindow})`, `Inherit default (${serviceDefaults.contextWindow})`)}
                min="1000"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs font-mono"
              />
              <div className="flex gap-1 flex-wrap">
                {["32768", "65536", "128000", "200000", "1000000"].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setContextWindow(val)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-border/40 bg-secondary/30 hover:bg-secondary text-muted-foreground"
                  >
                    {val === "128000" ? "128K" : val === "1000000" ? "1M" : val === "200000" ? "200K" : val === "65536" ? "64K" : "32K"}
                  </button>
                ))}
              </div>
            </div>
          </Field>

          {/* Max Output */}
          <Field label={tr("最大输出长度 (Max Output Tokens)", "Max Output Tokens")}>
            <div className="space-y-1.5">
              <input
                type="number"
                value={maxOutput}
                onChange={(e) => setMaxOutput(e.target.value)}
                placeholder={tr(`继承服务默认 (${serviceDefaults.maxOutput})`, `Inherit default (${serviceDefaults.maxOutput})`)}
                min="256"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs font-mono"
              />
              <div className="flex gap-1 flex-wrap">
                {["2048", "4096", "8192", "16384"].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setMaxOutput(val)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-border/40 bg-secondary/30 hover:bg-secondary text-muted-foreground"
                  >
                    {val === "4096" ? "4K" : val === "8192" ? "8K" : val === "16384" ? "16K" : "2K"}
                  </button>
                ))}
              </div>
            </div>
          </Field>

          {/* Temperature */}
          <Field label={tr("采样温度 (Temperature)", "Temperature")}>
            <input
              type="number"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder={tr(`继承服务默认 (${serviceDefaults.temperature})`, `Inherit default (${serviceDefaults.temperature})`)}
              min="0"
              max="2"
              step="0.05"
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs font-mono"
            />
          </Field>

          {/* Top-P */}
          <Field label={tr("Top-P 采样", "Top-P")}>
            <input
              type="number"
              value={topP}
              onChange={(e) => setTopP(e.target.value)}
              placeholder={tr(`继承服务默认 (${serviceDefaults.topP})`, `Inherit default (${serviceDefaults.topP})`)}
              min="0"
              max="1"
              step="0.01"
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs font-mono"
            />
          </Field>

          {/* Thinking Budget */}
          <Field label={tr("思考预算 (Thinking Budget, tokens)", "Thinking Budget (tokens)")}>
            <input
              type="number"
              value={thinkingBudget}
              onChange={(e) => setThinkingBudget(e.target.value)}
              placeholder={tr(`继承服务默认 (${serviceDefaults.thinkingBudget})`, `Inherit default (${serviceDefaults.thinkingBudget})`)}
              min="0"
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-1.5 text-xs font-mono"
            />
          </Field>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border/40">
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {tr("清除专属配置 (继承服务默认)", "Clear overrides")}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-border/60 text-xs hover:bg-secondary transition-colors"
            >
              {tr("取消", "Cancel")}
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs hover:bg-primary/90 transition-colors"
            >
              <Check size={12} />
              {tr("确定", "Apply")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-muted-foreground/70 font-medium">{label}</label>
      {children}
    </div>
  );
}
