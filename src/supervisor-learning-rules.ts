import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
	loadSupervisorImprovementProposalFile,
	type SupervisorImprovementProposalFile,
	type SupervisorImprovementProposalWithDecision,
} from "./supervisor-improvement-decisions.js";
import type {
	HumanIntent,
	HumanIntentConcept,
	HumanIntentRiskHint,
	HumanIntentTaskCategory,
	IntentRiskHint,
} from "./human-intent.js";

export type SupervisorLearningRuleType =
	| "intent_rule"
	| "risk_rule"
	| "alias_rule"
	| "workflow_rule";

export type SupervisorLearningRule = {
	id: string;
	type: SupervisorLearningRuleType;
	sourceProposalId: string;
	sourceProposalFile: string;
	enabled: true;
	description: string;
	match: {
		phrases: string[];
		concepts: HumanIntentConcept[];
		regex?: string[];
	};
	outcome: {
		intent?: HumanIntent;
		taskCategory?: HumanIntentTaskCategory;
		concepts: HumanIntentConcept[];
		riskHints: HumanIntentRiskHint[];
		priorityBoost?: number;
		shouldBlockIfIduActive?: boolean;
	};
	createdAt: string;
	approvedBy: "human";
};

export type SupervisorLearningRulesFile = {
	version: 1;
	updatedAt: string;
	sourceProposalFiles: string[];
	rules: SupervisorLearningRule[];
};

export type SupervisorLearningRulesApplyResult = {
	path: string;
	backupPath?: string;
	created: SupervisorLearningRule[];
	omitted: SupervisorImprovementProposalWithDecision[];
	notApplicable: SupervisorImprovementProposalWithDecision[];
	file: SupervisorLearningRulesFile;
};

export type SupervisorLearningRulesStatus = {
	path: string;
	exists: boolean;
	updatedAt?: string;
	ruleCount: number;
	enabledCount: number;
	types: SupervisorLearningRuleType[];
	rules: SupervisorLearningRule[];
	warnings: string[];
};

type ApplyOptions = {
	now?: () => Date;
};

const RULES_FILE = "supervisor-learning-rules.json";
const RULE_TYPES: SupervisorLearningRuleType[] = [
	"intent_rule",
	"risk_rule",
	"alias_rule",
	"workflow_rule",
];
const CONCEPTS: HumanIntentConcept[] = [
	"auth",
	"login",
	"session",
	"access",
	"password",
	"permission",
	"database",
	"schema",
	"security",
	"ui",
	"dashboard",
	"module",
	"flow",
	"recurring_failure",
	"urgent",
	"docs",
	"tests",
	"deployment",
	"performance",
	"cost_tokens",
	"quality",
	"maintenance",
	"task",
	"queue",
	"semantic-audit",
	"project-core",
	"configuration",
	"review",
	"unknown",
];
const RAISING_RISK_HINTS: HumanIntentRiskHint[] = [
	"security",
	"data_loss",
	"auth_change",
	"db_change",
	"architecture_change",
	"scope_change",
];
const INTENTS: HumanIntent[] = [
	"bug_report",
	"feature_request",
	"change_request",
	"documentation_task",
	"question",
	"status_check",
	"review_request",
	"command",
	"unknown",
];
const TASK_CATEGORIES: HumanIntentTaskCategory[] = [
	"bug",
	"feature",
	"refactor",
	"docs",
	"review",
	"general",
];

export function applySupervisorLearningRules(
	pathOrLatest: string,
	reportsPath: string,
	options: ApplyOptions = {},
): SupervisorLearningRulesApplyResult {
	const proposalFile = loadSupervisorImprovementProposalFile(
		pathOrLatest,
		reportsPath,
	);
	const now = options.now?.() ?? new Date();
	const createdAt = now.toISOString();
	const applicable: SupervisorLearningRule[] = [];
	const omitted: SupervisorImprovementProposalWithDecision[] = [];
	const notApplicable: SupervisorImprovementProposalWithDecision[] = [];

	for (const proposal of proposalFile.proposals) {
		if (!hasRecordedHumanApproval(proposal)) {
			omitted.push(proposal);
			continue;
		}
		const rule = ruleFromProposal(proposal, proposalFile, createdAt);
		if (rule) applicable.push(rule);
		else notApplicable.push(proposal);
	}

	const rulesPath = learningRulesPath(reportsPath);
	const existing = loadSupervisorLearningRules(reportsPath);
	const existingRules = existing.file?.rules ?? [];
	const mergedRules = dedupeRules([...existingRules, ...applicable]);
	const sourceProposalFiles = Array.from(
		new Set([
			...(existing.file?.sourceProposalFiles ?? []),
			basename(proposalFile.path),
		]),
	);
	const file: SupervisorLearningRulesFile = {
		version: 1,
		updatedAt: createdAt,
		sourceProposalFiles,
		rules: mergedRules,
	};
	mkdirSync(resolve(reportsPath), { recursive: true });
	const backupPath = existsSync(rulesPath)
		? backupLearningRules(rulesPath, reportsPath, now)
		: undefined;
	writeFileSync(rulesPath, `${JSON.stringify(file, null, 2)}\n`);
	return {
		path: rulesPath,
		backupPath,
		created: applicable,
		omitted,
		notApplicable,
		file,
	};
}

export function getSupervisorLearningRulesStatus(
	reportsPath: string,
): SupervisorLearningRulesStatus {
	const path = learningRulesPath(reportsPath);
	const loaded = loadSupervisorLearningRules(reportsPath);
	if (!loaded.file) {
		return {
			path,
			exists: false,
			ruleCount: 0,
			enabledCount: 0,
			types: [],
			rules: [],
			warnings: loaded.warnings,
		};
	}
	return {
		path,
		exists: true,
		updatedAt: loaded.file.updatedAt,
		ruleCount: loaded.file.rules.length,
		enabledCount: loaded.file.rules.filter((rule) => rule.enabled).length,
		types: Array.from(new Set(loaded.file.rules.map((rule) => rule.type))),
		rules: loaded.file.rules,
		warnings: loaded.warnings,
	};
}

export function loadSupervisorLearningRules(reportsPath: string): {
	file?: SupervisorLearningRulesFile;
	warnings: string[];
} {
	const path = learningRulesPath(reportsPath);
	if (!existsSync(path)) return { warnings: [] };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return { file: normalizeLearningRulesFile(parsed), warnings: [] };
	} catch (error) {
		return {
			warnings: [
				`No pude cargar supervisor-learning-rules.json: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
}

export function formatSupervisorLearningRulesApplyResult(
	result: SupervisorLearningRulesApplyResult,
): string {
	return [
		"Supervisor Learning Rules Applied",
		"",
		"Ruta:",
		result.path,
		"",
		"Reglas creadas:",
		...(result.created.length
			? result.created.map(
					(rule) => `- ${rule.id} ${rule.type} ${rule.description}`,
				)
			: ["- ninguna"]),
		"",
		"Propuestas omitidas:",
		...(result.omitted.length
			? result.omitted.map(
					(proposal) => `- ${proposal.id} ${proposal.type} ${proposal.status}`,
				)
			: ["- ninguna"]),
		"",
		"No aplicables todavía:",
		...(result.notApplicable.length
			? result.notApplicable.map(
					(proposal) => `- ${proposal.id} ${proposal.type}`,
				)
			: ["- ninguna"]),
		...(result.backupPath ? ["", "Backup:", result.backupPath] : []),
		"",
		"Nota segura:",
		"Sólo actualicé reglas dinámicas en reports. No modifiqué código, skills, Constitution ni Project Core. No ejecuté AgentLabs.",
	].join("\n");
}

export function formatSupervisorLearningRulesStatus(
	status: SupervisorLearningRulesStatus,
): string {
	return [
		"Supervisor Learning Rules Status",
		"",
		"Ruta:",
		status.path,
		"",
		"Existe:",
		status.exists ? "sí" : "no",
		"Reglas:",
		String(status.ruleCount),
		"Enabled:",
		String(status.enabledCount),
		"Tipos activos:",
		status.types.length ? status.types.join(", ") : "ninguno",
		...(status.updatedAt ? ["Última actualización:", status.updatedAt] : []),
		"",
		"Detalle:",
		...(status.rules.length
			? status.rules.map(
					(rule) =>
						`- ${rule.id} ${rule.type} enabled=${String(rule.enabled)} source=${rule.sourceProposalFile}`,
				)
			: ["- ninguna"]),
		...(status.warnings.length
			? ["", "Warnings:", ...status.warnings.map((item) => `- ${item}`)]
			: []),
		"",
		"Nota segura:",
		"Las reglas dinámicas sólo suman señales; no desactivan guardrails ni bajan riesgo.",
	].join("\n");
}

export function learningRulesPath(reportsPath: string): string {
	return join(resolve(reportsPath), RULES_FILE);
}

export function legacyRiskFromLearningRules(
	rules: SupervisorLearningRule[],
	text: string,
): IntentRiskHint | undefined {
	const matches = matchingRules(rules, text);
	if (matches.some((rule) => rule.outcome.shouldBlockIfIduActive))
		return "high";
	if (
		matches.some((rule) =>
			rule.outcome.riskHints.some((hint) =>
				["security", "data_loss", "auth_change", "db_change"].includes(hint),
			),
		)
	)
		return "high";
	if (
		matches.some(
			(rule) => rule.outcome.priorityBoost && rule.outcome.priorityBoost > 0,
		)
	)
		return "medium";
	return undefined;
}

export function matchingRules(
	rules: SupervisorLearningRule[],
	text: string,
): SupervisorLearningRule[] {
	const normalized = normalize(text);
	return rules.filter((rule) => {
		if (!rule.enabled) return false;
		if (
			rule.match.phrases.some((phrase) =>
				normalized.includes(normalize(phrase)),
			)
		)
			return true;
		return (rule.match.regex ?? []).some((pattern) =>
			safeRegexMatch(pattern, normalized),
		);
	});
}

function ruleFromProposal(
	proposal: SupervisorImprovementProposalWithDecision,
	proposalFile: SupervisorImprovementProposalFile,
	createdAt: string,
): SupervisorLearningRule | undefined {
	if (
		![
			"intent_rule_update",
			"classifier_review",
			"workflow_improvement",
		].includes(proposal.type)
	) {
		return undefined;
	}
	const text = `${proposal.title} ${proposal.description} ${proposal.evidence.join(" ")}`;
	const concepts = conceptsFromText(text);
	const phrases = phrasesFromText(text);
	if (
		proposal.type === "classifier_review" &&
		!phrases.length &&
		!concepts.length
	)
		return undefined;
	if (
		proposal.type === "intent_rule_update" &&
		!phrases.length &&
		!concepts.length
	)
		return undefined;
	const isAuth = concepts.some((concept) =>
		["auth", "login", "session", "access"].includes(concept),
	);
	const isDb = concepts.some((concept) =>
		["database", "schema"].includes(concept),
	);
	const isWorkflow = proposal.type === "workflow_improvement";
	return {
		id: `learn-${proposal.id}`,
		type: isWorkflow
			? "workflow_rule"
			: isAuth || isDb
				? "intent_rule"
				: "alias_rule",
		sourceProposalId: proposal.id,
		sourceProposalFile: basename(proposalFile.path),
		enabled: true,
		description: proposal.title,
		match: {
			phrases,
			concepts,
		},
		outcome: {
			intent: isWorkflow ? "command" : "bug_report",
			taskCategory: isWorkflow ? "general" : "bug",
			concepts,
			riskHints: isWorkflow ? [] : riskHintsFor(concepts),
			priorityBoost: isWorkflow ? 0 : 2,
			shouldBlockIfIduActive:
				!isWorkflow && (isAuth || isDb || concepts.includes("security")),
		},
		createdAt,
		approvedBy: "human",
	};
}

function hasRecordedHumanApproval(
	proposal: SupervisorImprovementProposalWithDecision,
): boolean {
	return (
		proposal.status === "approved" &&
		proposal.decision?.decision === "approved" &&
		(proposal.decision.source === "cli" ||
			proposal.decision.source === "telegram")
	);
}

function conceptsFromText(text: string): HumanIntentConcept[] {
	const normalized = normalize(text);
	const concepts: HumanIntentConcept[] = [];
	if (
		/auth|login|loggin|loguin|legin|session|sesion|entrar|acceso/u.test(
			normalized,
		)
	) {
		concepts.push("auth", "login", "session");
	}
	if (
		/db|database|base-de-datos|schema|sql|sqlite|postgres/u.test(normalized)
	) {
		concepts.push("database", "schema");
	}
	if (/security|seguridad|password|contrasena|token/u.test(normalized))
		concepts.push("security");
	if (/queue|cola|prompt|si|no|stop|cancel|workflow|flujo/u.test(normalized))
		concepts.push("queue", "flow");
	return Array.from(new Set(concepts));
}

function phrasesFromText(text: string): string[] {
	const normalized = normalize(text);
	const phrases: string[] = [];
	const semanticTokens = normalized
		.split("-")
		.filter((token) => token.length >= 5)
		.filter(
			(token) =>
				![
					"clasificar",
					"classified",
					"review",
					"revisar",
					"bug",
					"high",
					"como",
				].includes(token),
		);
	phrases.push(...semanticTokens.slice(0, 8));
	for (const phrase of [
		"falla",
		"base de datos",
		"db",
		"schema",
		"database",
		"login",
		"loggin",
		"loguin",
		"legin",
		"session",
		"sesion",
		"no puedo entrar",
		"me saca",
		"queue",
		"cola",
		"prompt",
		"stop",
		"cancel",
	]) {
		if (normalized.includes(normalize(phrase))) phrases.push(phrase);
	}
	return Array.from(new Set(phrases));
}

function riskHintsFor(concepts: HumanIntentConcept[]): HumanIntentRiskHint[] {
	const risks: HumanIntentRiskHint[] = [];
	if (
		concepts.some((concept) =>
			["auth", "login", "session", "security"].includes(concept),
		)
	) {
		risks.push("auth_change", "security");
	}
	if (concepts.some((concept) => ["database", "schema"].includes(concept))) {
		risks.push("db_change", "data_loss");
	}
	return Array.from(new Set(risks));
}

function dedupeRules(
	rules: SupervisorLearningRule[],
): SupervisorLearningRule[] {
	const seen = new Map<string, SupervisorLearningRule>();
	for (const rule of rules) {
		const key = `${rule.sourceProposalFile}:${rule.sourceProposalId}:${rule.type}`;
		seen.set(key, rule);
	}
	return [...seen.values()];
}

function backupLearningRules(
	path: string,
	reportsPath: string,
	now: Date,
): string {
	const backupPath = join(
		resolve(reportsPath),
		`supervisor-learning-rules.backup-${timestamp(now)}.json`,
	);
	copyFileSync(path, backupPath);
	return backupPath;
}

function normalizeLearningRulesFile(
	value: unknown,
): SupervisorLearningRulesFile {
	if (!isRecord(value)) throw new Error("Archivo de reglas inválido.");
	if (value.version !== 1) throw new Error("Versión de reglas inválida.");
	if (typeof value.updatedAt !== "string")
		throw new Error("updatedAt inválido.");
	if (!isStringArray(value.sourceProposalFiles))
		throw new Error("sourceProposalFiles inválido.");
	if (!Array.isArray(value.rules)) throw new Error("rules inválido.");
	return {
		version: 1,
		updatedAt: value.updatedAt,
		sourceProposalFiles: value.sourceProposalFiles,
		rules: value.rules.map(normalizeRule),
	};
}

function normalizeRule(value: unknown): SupervisorLearningRule {
	if (!isRecord(value)) throw new Error("Regla inválida.");
	if (!RULE_TYPES.includes(value.type as SupervisorLearningRuleType))
		throw new Error("Tipo de regla inválido.");
	if (value.enabled !== true)
		throw new Error("Regla dinámica no puede estar disabled en LEARN-3A.");
	if (!isRecord(value.match) || !isRecord(value.outcome))
		throw new Error("Regla sin match/outcome válido.");
	const phrases = isStringArray(value.match.phrases) ? value.match.phrases : [];
	const concepts = isConceptArray(value.match.concepts)
		? value.match.concepts
		: [];
	const regex =
		value.match.regex === undefined
			? undefined
			: limitedRegexArray(value.match.regex);
	const outcomeConcepts = isConceptArray(value.outcome.concepts)
		? value.outcome.concepts
		: [];
	const riskHints = normalizeRaisingRiskHints(value.outcome.riskHints);
	const intent = INTENTS.includes(value.outcome.intent as HumanIntent)
		? (value.outcome.intent as HumanIntent)
		: undefined;
	const taskCategory = TASK_CATEGORIES.includes(
		value.outcome.taskCategory as HumanIntentTaskCategory,
	)
		? (value.outcome.taskCategory as HumanIntentTaskCategory)
		: undefined;
	return {
		id: stringField(value, "id"),
		type: value.type as SupervisorLearningRuleType,
		sourceProposalId: stringField(value, "sourceProposalId"),
		sourceProposalFile: stringField(value, "sourceProposalFile"),
		enabled: true,
		description: stringField(value, "description"),
		match: { phrases, concepts, ...(regex ? { regex } : {}) },
		outcome: {
			...(intent ? { intent } : {}),
			...(taskCategory ? { taskCategory } : {}),
			concepts: outcomeConcepts,
			riskHints,
			...(typeof value.outcome.priorityBoost === "number" &&
			value.outcome.priorityBoost > 0
				? { priorityBoost: Math.min(value.outcome.priorityBoost, 5) }
				: {}),
			...(value.outcome.shouldBlockIfIduActive === true
				? { shouldBlockIfIduActive: true }
				: {}),
		},
		createdAt: stringField(value, "createdAt"),
		approvedBy: "human",
	};
}

function limitedRegexArray(value: unknown): string[] | undefined {
	if (!isStringArray(value)) throw new Error("regex inválido.");
	const safe = value
		.filter((pattern) => pattern.length <= 80 && !/[+*{]{2,}/u.test(pattern))
		.slice(0, 5);
	return safe.length ? safe : undefined;
}

function safeRegexMatch(pattern: string, normalizedText: string): boolean {
	try {
		if (pattern.length > 80 || /[+*{]{2,}/u.test(pattern)) return false;
		return new RegExp(pattern, "iu").test(normalizedText);
	} catch {
		return false;
	}
}

function stringField(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || !value.trim())
		throw new Error(`Campo inválido: ${key}`);
	return value;
}

function isConceptArray(value: unknown): value is HumanIntentConcept[] {
	return (
		Array.isArray(value) &&
		value.every((item) => CONCEPTS.includes(item as HumanIntentConcept))
	);
}

function normalizeRaisingRiskHints(value: unknown): HumanIntentRiskHint[] {
	if (value === undefined) return [];
	if (!isRiskArray(value)) {
		throw new Error(
			"Archivo de reglas inválido: riskHints sólo puede subir riesgo.",
		);
	}
	return value;
}

function isRiskArray(value: unknown): value is HumanIntentRiskHint[] {
	return (
		Array.isArray(value) &&
		value.every((item) =>
			RAISING_RISK_HINTS.includes(item as HumanIntentRiskHint),
		)
	);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-|-$/gu, "");
}

function timestamp(date: Date): string {
	const compact = date
		.toISOString()
		.replace(/[^0-9]/gu, "")
		.slice(0, 14);
	return `${compact.slice(0, 8)}-${compact.slice(8, 14)}`;
}
