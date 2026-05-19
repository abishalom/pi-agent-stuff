export function EmptyState({ title, detail }: { title: string; detail?: string | null }) {
	return (
		<div style={{ padding: 24, color: "#94a3b8" }}>
			<h3 style={{ marginTop: 0 }}>{title}</h3>
			{detail ? <p>{detail}</p> : null}
		</div>
	);
}
