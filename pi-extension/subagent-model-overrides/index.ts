import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface AgentOverride {
  model?: string;
  thinking?: ThinkingLevel;
}

type OverridesConfig = Record<string, AgentOverride>;

const VALID_THINKING = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);
const extensionDir = dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = join(extensionDir, "../../config/subagent-model-overrides.json");

function loadOverrides(): OverridesConfig {
  if (!existsSync(defaultConfigPath)) return {};

  try {
    const raw = readFileSync(defaultConfigPath, "utf8");
    const parsed = JSON.parse(raw) as OverridesConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error(`Failed to load subagent model overrides from ${defaultConfigPath}: ${error}`);
    return {};
  }
}

function parseProviderModel(spec?: string): { provider: string; model: string } | null {
  if (!spec) return null;
  const slash = spec.indexOf("/");
  if (slash === -1) return null;

  const provider = spec.slice(0, slash).trim();
  const model = spec.slice(slash + 1).trim();
  if (!provider || !model) return null;
  return { provider, model };
}

async function applyOverride(pi: ExtensionAPI, ctx: ExtensionContext, overrides: OverridesConfig) {
  const agentName = process.env.PI_SUBAGENT_AGENT?.trim();
  if (!agentName) return;

  const override = overrides[agentName];
  if (!override) return;

  if (override.model) {
    const parsed = parseProviderModel(override.model);
    if (!parsed) {
      ctx.ui.notify(
        `subagent-model-overrides: invalid model for ${agentName}: ${override.model}. Expected provider/model.`,
        "warning",
      );
    } else {
      const model = ctx.modelRegistry.find(parsed.provider, parsed.model);
      if (!model) {
        ctx.ui.notify(
          `subagent-model-overrides: model not found for ${agentName}: ${override.model}`,
          "warning",
        );
      } else {
        const success = await pi.setModel(model);
        if (!success) {
          ctx.ui.notify(
            `subagent-model-overrides: no API key available for ${override.model}`,
            "warning",
          );
        }
      }
    }
  }

  if (override.thinking) {
    if (!VALID_THINKING.has(override.thinking)) {
      ctx.ui.notify(
        `subagent-model-overrides: invalid thinking level for ${agentName}: ${override.thinking}`,
        "warning",
      );
    } else {
      pi.setThinkingLevel(override.thinking);
    }
  }
}

export default function subagentModelOverridesExtension(pi: ExtensionAPI) {
  let overrides: OverridesConfig = {};

  pi.on("session_start", async (_event, ctx) => {
    overrides = loadOverrides();
    await applyOverride(pi, ctx, overrides);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (Object.keys(overrides).length === 0) {
      overrides = loadOverrides();
    }
    await applyOverride(pi, ctx, overrides);
  });
}
