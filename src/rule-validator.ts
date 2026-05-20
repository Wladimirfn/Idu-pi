import type { AgentLabFinding, AgentLabReport } from "./agentlab-contract.js";
import type { ProjectBlueprint } from "./project-blueprint.js";
import type { ProjectFlows } from "./project-flows.js";

export type RuleValidationSeverity = "critical" | "high" | "medium" | "low";

export type RuleValidationFailure = {
	ruleId: string;
	severity: RuleValidationSeverity;
	message: string;
	field?: string;
};

export type RuleValidationWarning = {
	ruleId: string;
	message: string;
	field?: string;
};

export type RuleValidationResult = {
	ok: boolean;
	failures: RuleValidationFailure[];
	warnings: RuleValidationWarning[];
};

type FindingWithRuleIds = AgentLabFinding & { ruleIds?: string[] };

export function validateAgentLabReportAgainstRules(
	report: AgentLabReport,
	blueprint: ProjectBlueprint,
	flows: ProjectFlows,
): RuleValidationResult {
	const aggregate: RuleValidationResult = {
		ok: true,
		failures: [],
		warnings: [],
	};
	for (const finding of report.findings) {
		const result = validateFindingAgainstRules(finding, blueprint, flows);
		aggregate.failures.push(...result.failures);
		aggregate.warnings.push(...result.warnings);
	}
	aggregate.ok = aggregate.failures.length === 0;
	return aggregate;
}

export function validateFindingAgainstRules(
	finding: FindingWithRuleIds,
	blueprint: ProjectBlueprint,
	flows: ProjectFlows,
): RuleValidationResult {
	const failures: RuleValidationFailure[] = [];
	const warnings: RuleValidationWarning[] = [];

	if (!nonEmpty(finding.title)) {
		failures.push({
			ruleId: "finding.title.required",
			severity: "high",
			field: "title",
			message: "Finding title is required.",
		});
	}
	if (!nonEmpty(finding.description)) {
		failures.push({
			ruleId: "finding.description.required",
			severity: "high",
			field: "description",
			message: "Finding description is required.",
		});
	}
	if (!nonEmpty(finding.evidence)) {
		failures.push({
			ruleId: "finding.evidence.required",
			severity: "high",
			field: "evidence",
			message: "Finding evidence is required.",
		});
	}

	if (
		isHighRisk(finding.severity) &&
		finding.proposal?.requiresHumanApproval !== true
	) {
		failures.push({
			ruleId: "proposal.humanApproval.required",
			severity: "critical",
			field: "proposal.requiresHumanApproval",
			message:
				"High/critical findings require proposal.requiresHumanApproval true.",
		});
	}

	const proposalText = proposalSearchText(finding);
	if (/\bcommit\b/iu.test(proposalText) && /\blab\b/iu.test(proposalText)) {
		failures.push({
			ruleId: "lab.commit.forbidden",
			severity: "critical",
			field: "proposal",
			message: "Proposal must not commit from lab context.",
		});
	}
	if (/\bpush\b/iu.test(proposalText) && /\blab\b/iu.test(proposalText)) {
		failures.push({
			ruleId: "lab.push.forbidden",
			severity: "critical",
			field: "proposal",
			message: "Proposal must not push from lab context.",
		});
	}
	if (
		/(modify|modificar|write|edit|cambiar).*\b(repo real|real repo)\b|\b(repo real|real repo)\b.*(modify|modificar|write|edit|cambiar)/iu.test(
			proposalText,
		) &&
		/\b(clone|clon)\b/iu.test(proposalText) &&
		finding.proposal?.requiresHumanApproval !== true
	) {
		failures.push({
			ruleId: "realRepo.humanApproval.required",
			severity: "critical",
			field: "proposal.requiresHumanApproval",
			message:
				"Modifying the real repo from clone context requires human approval.",
		});
	}

	for (const action of blueprint.forbiddenActions) {
		if (matchesRule(proposalText, action)) {
			failures.push({
				ruleId: `blueprint.forbiddenActions.${slug(action)}`,
				severity: "critical",
				field: "proposal",
				message: `Proposal violates blueprint forbidden action: ${action}`,
			});
		}
	}
	for (const invariant of flows.invariants) {
		if (matchesRule(proposalText, invariant)) {
			failures.push({
				ruleId: `flows.invariants.${slug(invariant)}`,
				severity: "critical",
				field: "proposal",
				message: `Proposal violates project flow invariant: ${invariant}`,
			});
		}
	}

	for (const ruleId of finding.ruleIds ?? []) {
		if (!knownRuleIds(blueprint, flows).has(ruleId)) {
			warnings.push({
				ruleId,
				field: "ruleIds",
				message: `Unknown ruleId referenced by finding: ${ruleId}`,
			});
		}
	}

	return { ok: failures.length === 0, failures, warnings };
}

function proposalSearchText(finding: AgentLabFinding): string {
	const proposal = finding.proposal;
	return [proposal?.summary, ...(proposal?.steps ?? []), proposal?.risk]
		.filter((part): part is string => typeof part === "string")
		.join("\n");
}

function matchesRule(text: string, rule: string): boolean {
	const normalizedRule = normalize(rule);
	const normalizedText = normalize(text);
	if (normalizedRule.includes("commit") && normalizedText.includes("commit"))
		return true;
	if (normalizedRule.includes("push") && normalizedText.includes("push"))
		return true;
	if (
		(normalizedRule.includes("repo real") ||
			normalizedRule.includes("real repo")) &&
		(normalizedText.includes("repo real") ||
			normalizedText.includes("real repo"))
	) {
		return true;
	}
	return meaningfulTerms(normalizedRule).every((term) =>
		normalizedText.includes(term),
	);
}

function meaningfulTerms(normalizedRule: string): string[] {
	return normalizedRule
		.split(/[^a-z0-9]+/u)
		.filter((term) => term.length >= 4 && !STOP_WORDS.has(term));
}

const STOP_WORDS = new Set([
	"cannot",
	"pueden",
	"deben",
	"hacer",
	"without",
	"nunca",
	"never",
	"from",
	"with",
	"para",
]);

function knownRuleIds(
	blueprint: ProjectBlueprint,
	flows: ProjectFlows,
): Set<string> {
	return new Set([
		"finding.title.required",
		"finding.description.required",
		"finding.evidence.required",
		"proposal.humanApproval.required",
		"lab.commit.forbidden",
		"lab.push.forbidden",
		"realRepo.humanApproval.required",
		...blueprint.forbiddenActions.map(
			(rule) => `blueprint.forbiddenActions.${slug(rule)}`,
		),
		...flows.invariants.map((rule) => `flows.invariants.${slug(rule)}`),
	]);
}

function isHighRisk(severity: string): boolean {
	return severity === "high" || severity === "critical";
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function normalize(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/gu, "");
}

function slug(value: string): string {
	return normalize(value)
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}
