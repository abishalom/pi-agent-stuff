let mod: Record<string, unknown>;

try {
	mod = await import("@earendil-works/pi-ai");
} catch {
	mod = await import("@mariozechner/pi-ai");
}

export const completeSimple = mod.completeSimple as typeof import("@earendil-works/pi-ai").completeSimple;
