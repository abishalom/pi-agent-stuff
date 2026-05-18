export type DiffMode = "working-tree-vs-head" | "merge-base-vs-head";
export type TargetSide = "old" | "new";

export type DiffLineReference = {
	startLine: number;
	endLine: number;
	targetSide: TargetSide;
};

export type DiffReviewComment = {
	id: string;
	path: string;
	body: string;
	status: "open" | "submitted" | "resolved";
	line?: DiffLineReference;
};

export type DiffReviewReply = {
	id: string;
	commentId?: string;
	threadId?: string;
	path: string;
	reply: string;
	line?: DiffLineReference;
	recordedAt: number;
};

export type DiffReviewThread = {
	id: string;
	path: string;
	root: DiffReviewComment;
	replies: DiffReviewReply[];
};

export type DiffReviewFileReference = {
	path: string;
};

export type ReviewSubmissionRound = {
	id: string;
	reviewSessionId: string;
	threadIds: string[];
	createdAt?: number;
	completedAt?: number;
};

export type ReviewSession = {
	piSessionKey: string;
	repoRoot: string;
	reviewSessionId: string;
	serverSecret: string;
	diffMode: DiffMode;
	files: DiffReviewFileReference[];
	threads: DiffReviewThread[];
	pendingSubmission: ReviewSubmissionRound | null;
	submissionHistory: ReviewSubmissionRound[];
	nextSubmissionRound: number;
	nextReplyId: number;
};

export type ReviewSessionSeed = Partial<Omit<ReviewSession, "piSessionKey" | "repoRoot">> & {
	piSessionKey: string;
	repoRoot: string;
};

export type DiffReviewReplyParams = {
	reviewSessionId: string;
	submissionRoundId: string;
	threadId?: string;
	commentId?: string;
	path: string;
	line?: DiffLineReference;
	reply: string;
};

export type RecordedDiffReviewReply = DiffReviewReply & {
	reviewSessionId: string;
	submissionRoundId: string;
};
