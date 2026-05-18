import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DiffReviewReplyParams } from "./types.ts";

const diffReviewReplyTool = defineTool({
	name: "diff_review_reply",
	label: "Diff Review Reply",
	description: "Reply to a diff review request",
	parameters: Type.Object({
		body: Type.String({ description: "Reply text to send back to the diff review flow" }),
	}),
	async execute(_toolCallId, _params: DiffReviewReplyParams) {
		throw new Error("not implemented yet");
	},
});

export default function diffReviewExtension(pi: ExtensionAPI) {
	pi.registerCommand("diff-review", {
		description: "Open the local diff review workflow",
		handler: async () => {
			throw new Error("not implemented yet");
		},
	});

	pi.registerTool(diffReviewReplyTool);
}
