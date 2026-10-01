import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import type { Model, Api } from "@mariozechner/pi-ai";
import { resolveServicePiProvider, resolveServicePreset } from "./service-presets.js";
import { getServiceApiKey } from "./secrets.js";
import { getEndpoint } from "./providers/index.js";
import { lookupModel, inferDefaultContextWindow } from "./providers/lookup.js";
import type { InkosEndpoint } from "./providers/types.js";
import { isApiKeyOptionalForEndpoint } from "../utils/llm-endpoint-auth.js";
import { toPiApi, type LLMApiFormat } from "./api-format.js";

export interface ResolveServiceModelOptions {
  customBaseUrl?: string;
  customApiFormat?: LLMApiFormat;
  contextWindow?: number;
  maxOutput?: number;
  temperature?: number;
  topP?: number;
  thinkingBudget?: number;
  compactionThreshold?: number;
}

export interface ResolvedModel {
  model: Model<Api>;
  apiKey: string;
  writingTemperature?: number;
  temperatureRange?: readonly [number, number];
  temperatureHint?: string;
  topP?: number;
  compactionThreshold?: number;
}

export class ServiceApiKeyNotFoundError extends Error {
  constructor(readonly service: string) {
    super(`API key not found for service "${service}". Add it in .inkos/secrets.json or set the environment variable.`);
    this.name = "ServiceApiKeyNotFoundError";
  }
}

function resolveProviderCompat(
  provider: InkosEndpoint | undefined,
  baseUrl: string,
): Record<string, unknown> | undefined {
  const compat = {
    ...(provider?.compat ?? {}),
    ...(baseUrl.includes("generativelanguage.googleapis.com") ? { supportsStore: false } : {}),
  };
  return Object.keys(compat).length > 0 ? compat : undefined;
}

export async function resolveServiceModel(
  service: string,
  modelId: string,
  projectRoot: string,
  customBaseUrl?: string,
  customApiFormat?: LLMApiFormat,
  options?: ResolveServiceModelOptions,
): Promise<ResolvedModel> {
  // Determine pi-ai provider
  const baseService = service.startsWith("custom:") ? "custom" : service;
  const preset = resolveServicePreset(baseService);
  const endpoint = getEndpoint(baseService);
  const effectiveApiFormat = options?.customApiFormat ?? customApiFormat;
  const piProvider = baseService === "ollama"
    ? "ollama"
    : service.startsWith("custom:") && effectiveApiFormat === "anthropic"
      ? "anthropic"
      : resolveServicePiProvider(baseService) ?? "openai";
  const apiType = service.startsWith("custom:")
    ? toPiApi(effectiveApiFormat ?? "chat")
    : (preset?.api ?? "openai-completions");
  const configuredBaseUrl = options?.customBaseUrl ?? customBaseUrl ?? preset?.baseUrl ?? "";
  const endpointModel = lookupModel(baseService, modelId);

  // Get pi-ai Model — may return undefined for model IDs not in the built-in registry
  const piModel = getModel(piProvider as any, modelId as any) as Model<Api> | undefined;
  const effectiveBaseUrl = configuredBaseUrl || piModel?.baseUrl || "";
  const compat = apiType === "openai-completions"
    ? resolveProviderCompat(endpoint, effectiveBaseUrl)
    : undefined;

  if (!effectiveBaseUrl) {
    throw new Error(
      `Cannot resolve model "${modelId}" for service "${service}": no baseUrl available.`,
    );
  }

  // Resolve API key after baseUrl/provider are known so local/self-hosted endpoints
  // such as Ollama can be used without forcing a fake secret.
  const apiKey = await getServiceApiKey(projectRoot, service);
  if (!apiKey && !isApiKeyOptionalForEndpoint({ provider: preset?.providerFamily, baseUrl: effectiveBaseUrl })) {
    throw new ServiceApiKeyNotFoundError(service);
  }

  // Read configured service and model overrides from inkos.json if available
  let configuredEntry: Record<string, unknown> | undefined;
  if (projectRoot) {
    try {
      const raw = await readFile(join(projectRoot, "inkos.json"), "utf-8");
      const parsed = JSON.parse(raw);
      const services = Array.isArray(parsed?.llm?.services) ? parsed.llm.services : [];
      configuredEntry = services.find((entry: Record<string, unknown>) => {
        if (typeof entry.service !== "string") return false;
        if (service.startsWith("custom:")) {
          return entry.service === "custom" && `custom:${String(entry.name ?? "")}` === service;
        }
        return entry.service === service;
      });
    } catch {
      // inkos.json not found or invalid — fallback safely
    }
  }

  const modelConfigs = configuredEntry?.modelConfigs && typeof configuredEntry.modelConfigs === "object"
    ? (configuredEntry.modelConfigs as Record<string, Record<string, unknown>>)
    : undefined;
  const modelConfig = modelConfigs?.[modelId];

  const effectiveContextWindow = options?.contextWindow
    ?? (typeof modelConfig?.contextWindow === "number" ? modelConfig.contextWindow : undefined)
    ?? (typeof configuredEntry?.contextWindow === "number" ? configuredEntry.contextWindow : undefined)
    ?? endpointModel?.contextWindowTokens
    ?? piModel?.contextWindow
    ?? inferDefaultContextWindow(modelId);

  const effectiveMaxOutput = options?.maxOutput
    ?? (typeof modelConfig?.maxOutput === "number" ? modelConfig.maxOutput : undefined)
    ?? (typeof configuredEntry?.maxOutput === "number" ? configuredEntry.maxOutput : undefined)
    ?? endpointModel?.maxOutput
    ?? piModel?.maxTokens
    ?? 16384;

  const effectiveTemperature = options?.temperature
    ?? (typeof modelConfig?.temperature === "number" ? modelConfig.temperature : undefined)
    ?? (typeof configuredEntry?.temperature === "number" ? configuredEntry.temperature : undefined)
    ?? preset?.writingTemperature;

  const effectiveTopP = options?.topP
    ?? (typeof modelConfig?.topP === "number" ? modelConfig.topP : undefined)
    ?? (typeof configuredEntry?.topP === "number" ? configuredEntry.topP : undefined);

  const effectiveThinkingBudget = options?.thinkingBudget
    ?? (typeof modelConfig?.thinkingBudget === "number" ? modelConfig.thinkingBudget : undefined)
    ?? (typeof configuredEntry?.thinkingBudget === "number" ? configuredEntry.thinkingBudget : undefined)
    ?? 0;

  const effectiveCompactionThreshold = options?.compactionThreshold
    ?? (typeof modelConfig?.compactionThreshold === "number" ? modelConfig.compactionThreshold : undefined)
    ?? (typeof configuredEntry?.compactionThreshold === "number" ? configuredEntry.compactionThreshold : undefined);

  const model: Model<Api> = {
    id: modelId,
    name: piModel?.name ?? modelId,
    api: apiType as Api,
    provider: piProvider,
    baseUrl: effectiveBaseUrl,
    reasoning: effectiveThinkingBudget > 0 || (piModel?.reasoning ?? false),
    input: piModel?.input ?? ["text"] as ("text" | "image")[],
    cost: piModel?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: effectiveContextWindow,
    maxTokens: effectiveMaxOutput,
    ...(compat ? { compat: compat as Model<Api>["compat"] } : {}),
    ...(effectiveCompactionThreshold !== undefined ? { compactionThreshold: effectiveCompactionThreshold } : {}),
  };

  return {
    model,
    apiKey: apiKey ?? "",
    writingTemperature: effectiveTemperature,
    temperatureRange: preset?.temperatureRange,
    temperatureHint: preset?.temperatureHint,
    topP: effectiveTopP,
    compactionThreshold: effectiveCompactionThreshold,
  };
}
