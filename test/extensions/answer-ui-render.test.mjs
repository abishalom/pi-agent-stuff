import test from "node:test";
import assert from "node:assert/strict";
import { QnAComponent } from "../../pi-extension/answer/ui.ts";
import { visibleWidth } from "../../pi-extension/lib/pi-tui-compat.ts";

test("QnAComponent keeps rendered lines within terminal width for long question lists", () => {
	const questions = Array.from({ length: 52 }, (_, index) => ({
		question: `Question ${index + 1}?`,
	}));
	const component = new QnAComponent(
		questions,
		{ requestRender() {}, terminal: { rows: 24 } },
		() => {},
	);

	const lines = component.render(83);
	const tooWide = lines
		.map((line, index) => ({ index, width: visibleWidth(line) }))
		.filter(({ width }) => width > 83);

	assert.deepEqual(tooWide, []);
});
