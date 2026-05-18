export type DiffMode = "working-tree-vs-head" | "merge-base-vs-head";
export type DiffFileStatus = "modified" | "added" | "deleted" | "renamed" | "binary";
export type TargetSide = "old" | "new";

export type DiffProviderModeState = {
	requestedMode: DiffMode;
	effectiveMode: DiffMode;
	warning?: string;
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

export type DiffProvider = {
	loadTree(): Promise<DiffTree>;
	loadFile(path: string): Promise<DiffFileDetail>;
	loadModeState(): Promise<DiffProviderModeState>;
};

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
