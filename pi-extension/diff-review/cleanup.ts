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
	const errors: Error[] = [];
	for (const session of store.listByPiSessionKey(piSessionKey)) {
		store.emitSessionClosed(session.reviewSessionId);
		try {
			await store.getServer(session.reviewSessionId)?.close?.();
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		} finally {
			store.detachServer(session.reviewSessionId);
			store.remove(session.reviewSessionId);
		}
	}
	if (errors.length === 1) {
		throw errors[0];
	}
	if (errors.length > 1) {
		throw new AggregateError(errors, "Failed to close one or more diff review servers");
	}
}
