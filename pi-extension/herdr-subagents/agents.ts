import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  parseFrontmatter,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentCatalog,
  AgentDefinition,
  AgentDiagnostic,
  AgentSource,
  Placement,
  ThinkingLevel,
} from "./types.ts";

const VALID_THINKING = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const VALID_PLACEMENT = new Set<Placement>(["tab", "split"]);
const VALID_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const ORCHESTRATION_TOOLS = new Set([
  "subagent",
  "subagent_followup",
  "subagent_interrupt",
  "get_subagent_result",
  "subagents_list",
]);

interface AgentFrontmatter extends Record<string, unknown> {
  name?: unknown;
  description?: unknown;
  model?: unknown;
  thinking?: unknown;
  placement?: unknown;
  tools?: unknown;
}

interface AgentOverride {
  model?: unknown;
  thinking?: unknown;
}

interface Candidate {
  normalizedName?: string;
  definition?: AgentDefinition;
  diagnostic?: AgentDiagnostic;
  path: string;
  source: AgentSource;
}

export interface LoadAgentCatalogOptions {
  cwd: string;
  trusted: boolean;
  bundledDir: string;
  policyPath: string;
  parentThinking: ThinkingLevel;
  availableTools?: Iterable<string>;
  globalAgentsDir?: string;
}

function diagnostic(source: AgentSource, path: string, message: string, name?: string): AgentDiagnostic {
  return { source, path, message, ...(name ? { name } : {}) };
}

function readPolicy(path: string, diagnostics: AgentDiagnostic[]): Record<string, AgentOverride> {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      diagnostics.push(diagnostic("bundled", path, "model policy must be a JSON object"));
      return {};
    }
    return value as Record<string, AgentOverride>;
  } catch (error) {
    diagnostics.push(diagnostic("bundled", path, `cannot parse model policy: ${String(error)}`));
    return {};
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseTools(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (typeof value !== "string") return undefined;
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function parseCandidate(
  path: string,
  source: AgentSource,
  policy: Record<string, AgentOverride>,
  parentThinking: ThinkingLevel,
  availableTools?: Set<string>,
): Candidate {
  let parsed: { frontmatter: AgentFrontmatter; body: string };
  try {
    parsed = parseFrontmatter<AgentFrontmatter>(readFileSync(path, "utf8"));
  } catch (error) {
    return { path, source, diagnostic: diagnostic(source, path, `cannot parse definition: ${String(error)}`) };
  }

  const rawName = stringField(parsed.frontmatter.name);
  if (!rawName) {
    return { path, source, diagnostic: diagnostic(source, path, "missing required frontmatter field: name") };
  }
  const name = rawName.toLowerCase();
  if (!VALID_NAME.test(name)) {
    return {
      path,
      source,
      normalizedName: name,
      diagnostic: diagnostic(source, path, `invalid agent name: ${rawName}`, name),
    };
  }

  const override = policy[name] ?? {};
  const errors: string[] = [];
  const overrideModel = stringField(override.model);
  const overrideThinking = stringField(override.thinking);
  if (Object.hasOwn(override, "model") && !overrideModel) errors.push("model policy override must be a non-empty string");
  if (Object.hasOwn(override, "thinking") && !overrideThinking) errors.push("thinking policy override must be a non-empty string");
  const description = stringField(parsed.frontmatter.description);
  const model = overrideModel ?? stringField(parsed.frontmatter.model);
  const rawThinking = overrideThinking ?? stringField(parsed.frontmatter.thinking) ?? parentThinking;
  const rawPlacement = stringField(parsed.frontmatter.placement) ?? "tab";
  const tools = parseTools(parsed.frontmatter.tools);

  if (!description) errors.push("missing required frontmatter field: description");
  if (!model) errors.push("model is required after policy overlay");
  if (!VALID_THINKING.has(rawThinking as ThinkingLevel)) errors.push(`invalid thinking level: ${rawThinking}`);
  if (!VALID_PLACEMENT.has(rawPlacement as Placement)) errors.push(`invalid placement: ${rawPlacement}`);
  if (!tools) {
    errors.push("tools must be a comma-separated string");
  } else {
    const orchestration = tools.filter((tool) => ORCHESTRATION_TOOLS.has(tool));
    if (orchestration.length) errors.push(`nested orchestration tools are unavailable: ${orchestration.join(", ")}`);
    if (availableTools) {
      const unknown = tools.filter((tool) => !availableTools.has(tool));
      if (unknown.length) errors.push(`unknown tools: ${unknown.join(", ")}`);
    }
  }
  if (!parsed.body.trim()) errors.push("role prompt body is required");

  if (errors.length) {
    return {
      path,
      source,
      normalizedName: name,
      diagnostic: diagnostic(source, path, errors.join("; "), name),
    };
  }

  return {
    path,
    source,
    normalizedName: name,
    definition: {
      name,
      description: description!,
      model: model!,
      thinking: rawThinking as ThinkingLevel,
      placement: rawPlacement as Placement,
      tools: tools!,
      body: parsed.body.trim(),
      source,
      sourcePath: path,
    },
  };
}

function scopeFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(dir, entry.name))
    .sort();
}

export function loadAgentCatalog(options: LoadAgentCatalogOptions): AgentCatalog {
  const diagnostics: AgentDiagnostic[] = [];
  const policy = readPolicy(options.policyPath, diagnostics);
  const availableTools = options.availableTools ? new Set(options.availableTools) : undefined;
  const scopes: Array<{ source: AgentSource; dir: string; enabled: boolean }> = [
    { source: "bundled", dir: options.bundledDir, enabled: true },
    { source: "global", dir: options.globalAgentsDir ?? join(getAgentDir(), "agents"), enabled: true },
    { source: "project", dir: join(options.cwd, CONFIG_DIR_NAME, "agents"), enabled: options.trusted },
  ];
  const merged = new Map<string, AgentDefinition>();

  for (const scope of scopes) {
    if (!scope.enabled) continue;
    let files: string[];
    try {
      files = scopeFiles(scope.dir);
    } catch (error) {
      diagnostics.push(diagnostic(scope.source, scope.dir, `cannot read agent directory: ${String(error)}`));
      continue;
    }

    const candidates = files.map((path) =>
      parseCandidate(path, scope.source, policy, options.parentThinking, availableTools),
    );
    const byName = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      if (candidate.normalizedName) {
        const group = byName.get(candidate.normalizedName) ?? [];
        group.push(candidate);
        byName.set(candidate.normalizedName, group);
      } else if (candidate.diagnostic) {
        diagnostics.push(candidate.diagnostic);
      }
    }

    for (const [name, group] of byName) {
      if (group.length > 1) {
        merged.delete(name);
        const paths = group.map((item) => item.path).join(", ");
        for (const item of group) {
          diagnostics.push(diagnostic(scope.source, item.path, `duplicate agent name ${name}; conflicts: ${paths}`, name));
        }
        continue;
      }
      const candidate = group[0]!;
      if (candidate.diagnostic || !candidate.definition) {
        merged.delete(name);
        diagnostics.push(candidate.diagnostic ?? diagnostic(scope.source, candidate.path, "invalid definition", name));
        continue;
      }
      merged.set(name, candidate.definition);
    }
  }

  const definitions = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  return {
    definitions,
    diagnostics,
    get(name: string) {
      return byName.get(name.trim().toLowerCase());
    },
  };
}
