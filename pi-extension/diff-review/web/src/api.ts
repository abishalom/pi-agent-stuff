import type {
	BootstrapPayload,
	DiffFileDetail,
	DiffMode,
	DiffTree,
	ReviewReply,
	SessionClosedEvent,
	SessionStateEvent,
} from "./types.ts";

function getSecret() {
	return new URL(window.location.href).searchParams.get("secret") ?? "";
}

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
	const url = new URL(pathname, window.location.href);
	url.searchParams.set("secret", getSecret());
	const response = await fetch(url, init);
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error((body as { error?: string }).error ?? `request failed: ${response.status}`);
	}
	return body as T;
}

export function fetchSession() {
	return requestJson<BootstrapPayload>("/api/session");
}

export function fetchFile(path: string) {
	const url = new URL("/api/file", window.location.href);
	url.searchParams.set("secret", getSecret());
	url.searchParams.set("path", path);
	return requestJson<DiffFileDetail>(url.pathname + url.search);
}

export function fetchTree() {
	return requestJson<DiffTree>("/api/tree");
}

export function setDiffMode(requestedMode: DiffMode) {
	return requestJson<{ requestedMode: DiffMode; effectiveMode: DiffMode; warning?: string }>("/api/diff-mode", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ requestedMode }),
	});
}

export function submitReview() {
	return requestJson<{ roundId: string }>("/api/submit", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
}

export function connectEvents(handlers: {
	onSessionState(event: SessionStateEvent): void;
	onReply(event: ReviewReply): void;
	onSessionClosed(event: SessionClosedEvent): void;
	onError(message: string): void;
}) {
	const url = new URL("/api/events", window.location.href);
	url.searchParams.set("secret", getSecret());
	const source = new EventSource(url);
	source.addEventListener("session-state", (event) => handlers.onSessionState(JSON.parse((event as MessageEvent).data)));
	source.addEventListener("reply", (event) => handlers.onReply(JSON.parse((event as MessageEvent).data)));
	source.addEventListener("session-closed", (event) => handlers.onSessionClosed(JSON.parse((event as MessageEvent).data)));
	source.onerror = () => handlers.onError("Connection lost. Attempting to reconnect…");
	return source;
}
