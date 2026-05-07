let mod: Record<string, unknown>;

try {
	mod = await import("@earendil-works/pi-coding-agent");
} catch {
	mod = await import("@mariozechner/pi-coding-agent");
}

export const BorderedLoader = mod.BorderedLoader as typeof import("@earendil-works/pi-coding-agent").BorderedLoader;
export const DynamicBorder = mod.DynamicBorder as typeof import("@earendil-works/pi-coding-agent").DynamicBorder;
