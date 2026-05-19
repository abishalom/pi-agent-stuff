export type DiffMode = "working-tree-vs-head" | "merge-base-vs-head";
export type DiffFileStatus = "modified" | "added" | "deleted" | "renamed" | "binary";
export type TargetSide = "old" | "new";
export type ConnectionState = "connecting" | "open" | "closed" | "error";
export type ThreadSortMode = "creation-desc" | "last-activity-desc" | "line-number-asc";

export type LineAnchor = {
	path: string;
	startLine: number;
	endLine: number;
	targetSide: TargetSide;
};

export type ReviewComment = {
	id: string;
	path: string;
	body: string;
	status: "open" | "submitted" | "resolved";
	line?: LineAnchor;
	createdAt?: number;
};

export type ReviewReply = {
	id: string;
	reviewSessionId: string;
	submissionRoundId: string;
	threadId?: string;
	commentId?: string;
	path: string;
	reply: string;
	line?: LineAnchor;
	recordedAt: number;
};

export type ReviewThread = {
	id: string;
	path: string;
	root: ReviewComment;
	userReplies?: ReviewComment[];
	replies: ReviewReply[];
};

export type ReviewSubmissionRound = {
	id: string;
	reviewSessionId: string;
	threadIds: string[];
	createdAt?: number;
	completedAt?: number;
};

export type DiffTreeEntry = {
	path: string;
	status: DiffFileStatus;
	previousPath?: string;
};

export type DiffTree = {
	paths: string[];
	changedPaths: string[];
	changedFiles: DiffTreeEntry[];
};

export type DiffFileLoadError = {
	code: "unreadable" | "missing";
	message: string;
};

export type DiffFileDetail = {
	path: string;
	status: DiffFileStatus | "unchanged";
	previousPath?: string;
	currentContent: string | null;
	oldContent: string | null;
	newContent: string | null;
	isBinary: boolean;
	oldBinary: boolean;
	newBinary: boolean;
	currentBinary: boolean;
	loadError?: DiffFileLoadError;
};

export type BootstrapPayload = {
	reviewSessionId: string;
	repoRoot: string;
	diffMode: DiffMode;
	requestedMode: DiffMode;
	effectiveMode: DiffMode;
	warning?: string;
	pendingSubmission: ReviewSubmissionRound | null;
	submissionHistory: ReviewSubmissionRound[];
	files: Array<{ path: string }>;
	threads: ReviewThread[];
} & DiffTree;

export type SessionStateEvent = {
	reviewSessionId: string;
	repoRoot: string;
	diffMode: DiffMode;
	pendingSubmission: ReviewSubmissionRound | null;
	submissionHistory: ReviewSubmissionRound[];
};

export type SessionClosedEvent = {
	reviewSessionId: string;
	message?: string;
};

export type DraftComment =
	| {
		id: string;
		kind: "thread";
		path: string;
		line?: LineAnchor;
		text: string;
	}
	| {
		id: string;
		kind: "reply";
		threadId: string;
		path: string;
		line?: LineAnchor;
		text: string;
	};
