import {
	formatBlueprintForPrompt,
	loadProjectBlueprint,
} from "./project-blueprint.js";
import { formatFlowsForPrompt, loadProjectFlows } from "./project-flows.js";

export type LabProjectContext = {
	text: string;
};

const MAX_CONTEXT_CHARS = 1800;

export function loadLabProjectContext(
	projectPath: string,
): LabProjectContext | undefined {
	try {
		return formatLabProjectContext(
			formatBlueprintForPrompt(loadProjectBlueprint(projectPath)),
			formatFlowsForPrompt(loadProjectFlows(projectPath)),
		);
	} catch {
		return undefined;
	}
}

export function formatLabProjectContext(
	blueprintText: string,
	flowsText: string,
): LabProjectContext {
	const text = [
		"Contexto resumido del proyecto real para orientar la revisión:",
		truncateSection("Blueprint", blueprintText),
		truncateSection("Project flows", flowsText),
	].join("\n");
	return {
		text:
			text.length <= MAX_CONTEXT_CHARS
				? text
				: `${text.slice(0, MAX_CONTEXT_CHARS - 20).trimEnd()}\n[contexto truncado]`,
	};
}

function truncateSection(title: string, value: string): string {
	return `${title}:\n${redact(value)
		.slice(0, Math.floor(MAX_CONTEXT_CHARS / 2))
		.trimEnd()}`;
}

function redact(value: string): string {
	return value.replace(
		/(token|secret|password|api[_-]?key)\s*[:=]\s*\S+/giu,
		"$1: [redacted]",
	);
}
