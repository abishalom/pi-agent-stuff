let mod: Record<string, unknown>;

try {
	mod = await import("@earendil-works/pi-tui");
} catch {
	mod = await import("@mariozechner/pi-tui");
}

export const Container = mod.Container as typeof import("@earendil-works/pi-tui").Container;
export const Editor = mod.Editor as typeof import("@earendil-works/pi-tui").Editor;
export const Key = mod.Key as typeof import("@earendil-works/pi-tui").Key;
export const Text = mod.Text as typeof import("@earendil-works/pi-tui").Text;
export const matchesKey = mod.matchesKey as typeof import("@earendil-works/pi-tui").matchesKey;
export const truncateToWidth = mod.truncateToWidth as typeof import("@earendil-works/pi-tui").truncateToWidth;
export const visibleWidth = mod.visibleWidth as typeof import("@earendil-works/pi-tui").visibleWidth;
export const wrapTextWithAnsi = mod.wrapTextWithAnsi as typeof import("@earendil-works/pi-tui").wrapTextWithAnsi;
