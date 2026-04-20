import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AnswerSourceMode } from "./config.ts";

interface TextBlock {
	type: "text";
	text: string;
}

interface ConversationMessage {
	role?: string;
	content?: unknown;
	stopReason?: string;
}

interface MessageEntry {
	type: string;
	message?: ConversationMessage;
}

function isMessageEntry(entry: unknown): entry is MessageEntry {
	return !!entry && typeof entry === "object" && "type" in entry;
}

function isConversationMessage(message: unknown): message is ConversationMessage {
	return !!message && typeof message === "object";
}

function getTextContent(message: ConversationMessage): string[] {
	if (!Array.isArray(message.content)) return [];
	return message.content
		.filter((block): block is TextBlock => !!block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block && typeof block.text === "string")
		.map((block) => block.text);
}

function getBranchMessages(ctx: ExtensionContext): ConversationMessage[] {
	return ctx.sessionManager
		.getBranch()
		.filter((entry): entry is MessageEntry => isMessageEntry(entry) && entry.type === "message")
		.map((entry) => entry.message)
		.filter(isConversationMessage);
}

function getLastAssistantText(ctx: ExtensionContext): string {
	const branch = ctx.sessionManager.getBranch();

	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (!isMessageEntry(entry) || entry.type !== "message" || !isConversationMessage(entry.message)) {
			continue;
		}

		const message = entry.message;
		if (message.role !== "assistant") continue;
		if (message.stopReason !== "stop") {
			throw new Error(`Last assistant message incomplete (${message.stopReason})`);
		}

		const textParts = getTextContent(message);
		if (textParts.length > 0) {
			return textParts.join("\n");
		}
	}

	throw new Error("No assistant messages found");
}

function getLastUserText(ctx: ExtensionContext): string {
	const messages = getBranchMessages(ctx);

	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "user") continue;
		const textParts = getTextContent(message);
		if (textParts.length > 0) {
			return textParts.join("\n");
		}
	}

	throw new Error("No user messages found");
}

function getLastTurnText(ctx: ExtensionContext): string {
	const messages = getBranchMessages(ctx);
	let lastUserIndex = -1;

	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "user") continue;
		if (getTextContent(message).length === 0) continue;
		lastUserIndex = index;
		break;
	}

	if (lastUserIndex === -1) {
		throw new Error("No user messages found");
	}

	const parts: string[] = [];
	for (let index = lastUserIndex; index < messages.length; index++) {
		const message = messages[index];
		if (message.role !== "user" && message.role !== "assistant") continue;
		if (message.role === "assistant" && message.stopReason !== "stop") {
			throw new Error(`Last assistant message incomplete (${message.stopReason})`);
		}

		const text = getTextContent(message).join("\n").trim();
		if (!text) continue;
		parts.push(`${message.role === "user" ? "User" : "Assistant"}:\n${text}`);
	}

	if (parts.length === 0) {
		throw new Error("No messages found in last turn");
	}

	return parts.join("\n\n");
}

function getWholeBranchText(ctx: ExtensionContext): string {
	const messages = getBranchMessages(ctx);
	const parts: string[] = [];

	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") continue;
		if (message.role === "assistant" && message.stopReason !== "stop") {
			throw new Error(`Last assistant message incomplete (${message.stopReason})`);
		}

		const text = getTextContent(message).join("\n").trim();
		if (!text) continue;
		parts.push(`${message.role === "user" ? "User" : "Assistant"}:\n${text}`);
	}

	if (parts.length === 0) {
		throw new Error("No user or assistant messages found");
	}

	return parts.join("\n\n");
}

export function selectSourceText(ctx: ExtensionContext, mode: AnswerSourceMode): string {
	switch (mode) {
		case "last-assistant":
			return getLastAssistantText(ctx);
		case "last-user":
			return getLastUserText(ctx);
		case "last-turn":
			return getLastTurnText(ctx);
		case "whole-branch":
			return getWholeBranchText(ctx);
	}
}
