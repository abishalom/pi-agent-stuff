export async function shutdownSessionsForPiSessionKey(
	store: {
		listByPiSessionKey(piSessionKey: string): Array<{ reviewSessionId: string }>;
		emitSessionClosed(reviewSessionId: string): void;
		getServer(reviewSessionId: string): { close(): Promise<void> | void } | null;
		detachServer(reviewSessionId: string): void;
		remove(reviewSessionId: string): void;
	},
	piSessionKey: string,
) {
	for (const session of store.listByPiSessionKey(piSessionKey)) {
		store.emitSessionClosed(session.reviewSessionId);
		await store.getServer(session.reviewSessionId)?.close?.();
		store.detachServer(session.reviewSessionId);
		store.remove(session.reviewSessionId);
	}
}
