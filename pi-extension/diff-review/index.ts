import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDiffReviewReplyTool } from "./reply-tool.ts";
import { createReviewSessionStore } from "./state.ts";

const reviewSessionStore = createReviewSessionStore();

export default function diffReviewExtension(pi: ExtensionAPI) {
	pi.registerCommand("diff-review", {
		description: "Open the local diff review workflow",
		handler: async () => {
			throw new Error("not implemented yet");
		},
	});

	registerDiffReviewReplyTool(pi, reviewSessionStore);
}
