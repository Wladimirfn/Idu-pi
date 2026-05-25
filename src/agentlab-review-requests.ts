import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
	buildAgentLabReviewRequest,
	mapRiskToAgentLabSpecialties,
	validateAgentLabReviewRequest,
	type AgentLabReviewRequest,
	type AgentLabSpecialty,
} from "./agentlab-supervisor-contract.js";
import type { ProjectPostflightReport } from "./project-postflight.js";
import {
	buildSemanticAgentTaskPlan,
	type SemanticAgentTaskCandidate,
	type SemanticAgentTaskPlan,
} from "./semantic-agent-tasks.js";
import { reviewSkillDraft, type SkillDraftPlan } from "./skill-drafts.js";

export type AgentLabReviewRequestSource =
	| "postflight"
	| "skill_draft"
	| "semantic_agent_tasks"
	| "supervisor_improvements"
	| "project_core_constitution"
	| "manual";

export type AgentLabReviewRequestPlan = {
	generatedAt: string;
	projectId: string;
	source: AgentLabReviewRequestSource;
	warning: "Solicitud AgentLab. No ejecuta revisión por sí sola.";
	requests: AgentLabReviewRequest[];
	errors: string[];
	path?: string;
};

export type AgentLabReviewRequestReview = {
	path: string;
	name: string;
	valid: boolean;
	errors: string[];
	plan?: AgentLabReviewRequestPlan;
};

export type CreateAgentLabReviewRequestsInput = {
	source: AgentLabReviewRequestSource;
	reportsPath: string;
	projectId: string;
	projectPath: string;
	postflightReport?: ProjectPostflightReport;
	skillDraftPathOrLatest?: string;
	semanticAgentTaskPathOrLatest?: string;
	semanticAgentTaskPlan?: SemanticAgentTaskPlan;
	manualObjective?: string;
	manualContext?: string;
	now?: () => Date;
};

const WARNING = "Solicitud AgentLab. No ejecuta revisión por sí sola." as const;
const REQUEST_RE = /^agentlab-review-request-\d{8}-\d{6}\.json$/u;
const HIGH_RISKS = new Set(["high", "blocker"]);

export function createAgentLabReviewRequests(
	input: CreateAgentLabReviewRequestsInput,
): AgentLabReviewRequestPlan {
	const now = input.now?.() ?? new Date();
	const generatedAt = now.toISOString();
	const requests = buildRequests(input, generatedAt);
	const errors = validateRequests(requests);
	const plan: AgentLabReviewRequestPlan = {
		generatedAt,
		projectId: input.projectId,
		source: input.source,
		warning: WARNING,
		requests,
		errors,
	};
	mkdirSync(input.reportsPath, { recursive: true });
	const fileName = `agentlab-review-request-${timestamp(now)}.json`;
	const path = join(input.reportsPath, fileName);
	writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
	return { ...plan, path };
}

export function reviewAgentLabReviewRequest(
	pathOrLatest: string,
	reportsPath: string,
): AgentLabReviewRequestReview {
	const resolved = resolveRequestPath(pathOrLatest, reportsPath);
	if (!resolved.valid) {
		return {
			path: resolved.path,
			name: basename(resolved.path),
			valid: false,
			errors: resolved.errors,
		};
	}
	try {
		const raw = JSON.parse(readFileSync(resolved.path, "utf8")) as unknown;
		const plan = normalizePlan(raw);
		const errors = validateRequests(plan.requests);
		return {
			path: resolved.path,
			name: basename(resolved.path),
			valid: errors.length === 0,
			errors,
			plan,
		};
	} catch (error) {
		return {
			path: resolved.path,
			name: basename(resolved.path),
			valid: false,
			errors: [error instanceof Error ? error.message : String(error)],
		};
	}
}

export function formatAgentLabReviewRequestPlan(
	plan: AgentLabReviewRequestPlan,
): string {
	return [
		"AgentLab Review Requests Created",
		"",
		"Fuente:",
		plan.source,
		"",
		"Ruta:",
		plan.path ?? "- no escrita",
		"",
		"Requests:",
		...formatRequests(plan.requests),
		"",
		"Errores:",
		...formatList(plan.errors),
		"",
		"Nota segura:",
		"Solo creé solicitudes de revisión. No ejecuté AgentLabs, no apliqué skills ni reglas.",
	].join("\n");
}

export function formatAgentLabReviewRequestReview(
	review: AgentLabReviewRequestReview,
): string {
	if (!review.valid || !review.plan) {
		return [
			"AgentLab Review Request Review",
			"",
			"Archivo:",
			review.name || review.path,
			"",
			"Válido:",
			"no",
			"",
			"Errores:",
			...formatList(review.errors),
			"",
			"Nota segura:",
			"No ejecuté AgentLabs.",
		].join("\n");
	}
	return [
		"AgentLab Review Request Review",
		"",
		"Archivo:",
		review.name,
		"",
		"Válido:",
		"sí",
		"",
		"Specialties:",
		...formatList([
			...new Set(review.plan.requests.map((request) => request.specialty)),
		]),
		"",
		"Requests:",
		...review.plan.requests.flatMap(formatRequestDetail),
		"",
		"Nota segura:",
		"Solicitud AgentLab solamente. No ejecuté AgentLabs ni modifiqué el repo real.",
	].join("\n");
}

function buildRequests(
	input: CreateAgentLabReviewRequestsInput,
	createdAt: string,
): AgentLabReviewRequest[] {
	switch (input.source) {
		case "postflight":
			return requestsFromPostflight(input, createdAt);
		case "skill_draft":
			return requestsFromSkillDraft(input, createdAt);
		case "semantic_agent_tasks":
			return requestsFromSemanticTasks(input, createdAt);
		case "manual":
			return requestsFromManual(input, createdAt);
		case "supervisor_improvements":
		case "project_core_constitution":
			return requestsFromManual(
				{
					...input,
					manualObjective:
						input.manualObjective ??
						`Revisar fuente ${input.source} con contrato Supervisor ↔ AgentLabs`,
					manualContext:
						input.manualContext ??
						"Solicitud de revisión formal sin ejecución automática.",
				},
				createdAt,
			);
	}
}

function requestsFromPostflight(
	input: CreateAgentLabReviewRequestsInput,
	createdAt: string,
): AgentLabReviewRequest[] {
	const report = input.postflightReport;
	if (!report || !HIGH_RISKS.has(report.risk)) return [];
	const specialties = mapRiskToAgentLabSpecialties({
		text: [report.risk, report.recommendedNext, report.diffSummary ?? ""].join(
			"\n",
		),
		affectedAreas: report.impactedAreas,
		changedFiles: report.changedFiles,
		warnings: report.warnings,
		rules: report.constitutionGate?.affectedRules,
	});
	return specialties.map((specialty, index) =>
		buildAgentLabReviewRequest({
			id: requestId(input.projectId, "postflight", specialty, index + 1),
			projectId: input.projectId,
			projectPath: input.projectPath,
			specialty,
			trigger: "postflight",
			objective: `Revisar postflight ${report.risk} para ${specialty}`,
			contextSummary: [
				`Riesgo: ${report.risk}`,
				`Impacto: ${report.impactedAreas.join(", ") || "ninguno"}`,
				`Recomendación: ${report.recommendedNext}`,
			].join("\n"),
			evidence: [
				...report.changedFiles.map((file) => `changed file: ${file}`),
				...report.warnings.map((warning) => `warning: ${warning}`),
			],
			filesToInspect: report.changedFiles,
			flowsToCheck: report.impactedAreas.filter((area) =>
				/flow|flujo|mapa/u.test(area),
			),
			rulesToCheck: report.constitutionGate?.affectedRules ?? [],
			constraints: ["Revisar sin modificar el repo real."],
			maxCommands: 5,
			maxMinutes: 15,
			tokenBudgetHint: "bounded-postflight",
			expectedOutputs: [
				"hallazgos con evidencia",
				"pruebas sugeridas",
				"recomendaciones para Idu-pi Supervisor",
			],
			createdAt,
		}),
	);
}

function requestsFromSkillDraft(
	input: CreateAgentLabReviewRequestsInput,
	createdAt: string,
): AgentLabReviewRequest[] {
	const review = reviewSkillDraft(
		input.skillDraftPathOrLatest ?? "latest",
		input.reportsPath,
	);
	if (!review.valid || !review.plan) return [];
	return [
		buildAgentLabReviewRequest({
			id: requestId(input.projectId, "skill-draft", "skill_review", 1),
			projectId: input.projectId,
			projectPath: input.projectPath,
			specialty: "skill_review",
			trigger: "skill_draft",
			objective: "Revisar skill drafts aprobados sin aplicar skills reales",
			contextSummary: skillDraftContext(review),
			evidence: skillDraftEvidence(review),
			filesToInspect: [review.path],
			flowsToCheck: [],
			rulesToCheck: [
				"No aplicar skills reales",
				"Revisar borrador JSON solamente",
			],
			sourceSkillDraftPath: review.path,
			constraints: [
				"Puede revisar el JSON de skill draft pero no aplicar skills.",
				"No buscar .agents/skills/<skill>/SKILL.md; la skill real todavía no existe.",
			],
			allowedActions: ["revisar skill drafts", "proponer correcciones"],
			forbiddenActions: ["no modificar .agents", "no modificar .atl"],
			maxCommands: 3,
			maxMinutes: 10,
			tokenBudgetHint: "bounded-skill-review",
			expectedOutputs: [
				"observaciones sobre calidad del skill draft",
				"riesgos de aplicación",
				"pruebas sugeridas antes de aplicar",
			],
			createdAt,
			requiresHumanApproval: true,
		}),
	];
}

function requestsFromSemanticTasks(
	input: CreateAgentLabReviewRequestsInput,
	createdAt: string,
): AgentLabReviewRequest[] {
	const plan =
		input.semanticAgentTaskPlan ??
		buildSemanticAgentTaskPlan(
			input.semanticAgentTaskPathOrLatest ?? "latest",
			input.reportsPath,
		);
	if (!plan.validDraft) return [];
	const grouped = groupSemanticCandidates(plan.candidates);
	return [...grouped.entries()].map(([specialty, candidates], index) =>
		buildAgentLabReviewRequest({
			id: requestId(input.projectId, "semantic", specialty, index + 1),
			projectId: input.projectId,
			projectPath: input.projectPath,
			specialty,
			trigger: "semantic_audit",
			objective: `Revisar hallazgos semánticos agrupados para ${specialty}`,
			contextSummary: `Draft: ${plan.draftName}\nCandidatos: ${candidates.length}`,
			evidence: candidates.map((candidate) => candidate.evidence),
			filesToInspect: [],
			flowsToCheck: [],
			rulesToCheck: candidates.map((candidate) => candidate.dedupeKey),
			constraints: ["Crear solicitud; no ejecutar AgentLabs todavía."],
			maxCommands: 4,
			maxMinutes: 12,
			tokenBudgetHint: "bounded-semantic-audit",
			expectedOutputs: candidates.map((candidate) => candidate.recommendation),
			createdAt,
			requiresHumanApproval: candidates.some(
				(candidate) => candidate.requiresHumanApproval,
			),
		}),
	);
}

function requestsFromManual(
	input: CreateAgentLabReviewRequestsInput,
	createdAt: string,
): AgentLabReviewRequest[] {
	const objective = input.manualObjective ?? "Revisión manual AgentLab";
	const context = input.manualContext ?? objective;
	const specialties = mapRiskToAgentLabSpecialties({
		text: `${objective}\n${context}`,
	});
	return specialties.map((specialty, index) =>
		buildAgentLabReviewRequest({
			id: requestId(input.projectId, "manual", specialty, index + 1),
			projectId: input.projectId,
			projectPath: input.projectPath,
			specialty,
			trigger: "manual",
			objective,
			contextSummary: context,
			evidence: [context],
			filesToInspect: [],
			flowsToCheck: [],
			rulesToCheck: [],
			constraints: ["Solicitud manual sin ejecución automática."],
			maxCommands: 3,
			maxMinutes: 10,
			tokenBudgetHint: "bounded-manual",
			expectedOutputs: ["reporte de revisión con evidencia"],
			createdAt,
		}),
	);
}

function groupSemanticCandidates(
	candidates: SemanticAgentTaskCandidate[],
): Map<AgentLabSpecialty, SemanticAgentTaskCandidate[]> {
	const grouped = new Map<AgentLabSpecialty, SemanticAgentTaskCandidate[]>();
	for (const candidate of candidates) {
		const specialty = semanticTypeToSpecialty(candidate.type);
		grouped.set(specialty, [...(grouped.get(specialty) ?? []), candidate]);
	}
	return grouped;
}

function semanticTypeToSpecialty(type: string): AgentLabSpecialty {
	switch (type) {
		case "security":
		case "database":
		case "architecture":
		case "skill_review":
		case "ui_ux":
		case "code_quality":
			return type;
		case "classifier_review":
			return "code_quality";
		default:
			return "general";
	}
}

function validateRequests(requests: AgentLabReviewRequest[]): string[] {
	return requests.flatMap((request, index) => {
		const result = validateAgentLabReviewRequest(request);
		return result.ok
			? []
			: result.errors.map((error) => `requests[${index}].${error}`);
	});
}

function resolveRequestPath(
	pathOrLatest: string,
	reportsPath: string,
): { valid: boolean; path: string; errors: string[] } {
	const reports = resolve(reportsPath);
	if (pathOrLatest.trim() === "latest") {
		const latest = latestRequestFile(reports);
		return latest
			? { valid: true, path: latest, errors: [] }
			: {
					valid: false,
					path: reports,
					errors: [
						"No encontré archivos agentlab-review-request-*.json en reports.",
					],
				};
	}
	const trimmed = pathOrLatest.trim();
	if (!trimmed) {
		return { valid: false, path: reports, errors: ["Falta ruta de request."] };
	}
	const candidate = resolve(
		isAbsolute(trimmed) ? trimmed : join(reports, trimmed),
	);
	const relativeToReports = relative(reports, candidate);
	if (
		relativeToReports === "" ||
		relativeToReports.startsWith("..") ||
		isAbsolute(relativeToReports)
	) {
		return {
			valid: false,
			path: candidate,
			errors: ["La ruta debe estar dentro de AGENT_WORKSPACE_ROOT/reports."],
		};
	}
	if (!REQUEST_RE.test(basename(candidate))) {
		return {
			valid: false,
			path: candidate,
			errors: ["El archivo debe llamarse agentlab-review-request-*.json."],
		};
	}
	if (!existsSync(candidate)) {
		return {
			valid: false,
			path: candidate,
			errors: [`No existe archivo: ${candidate}`],
		};
	}
	return { valid: true, path: candidate, errors: [] };
}

function latestRequestFile(reportsPath: string): string | undefined {
	if (!existsSync(reportsPath)) return undefined;
	const latest = readdirSync(reportsPath)
		.filter((file) => REQUEST_RE.test(file))
		.sort()
		.at(-1);
	return latest ? join(reportsPath, latest) : undefined;
}

function normalizePlan(value: unknown): AgentLabReviewRequestPlan {
	if (!isRecord(value)) throw new Error("AgentLab request inválido.");
	if (value.warning !== WARNING)
		throw new Error("Warning de request inválido.");
	if (typeof value.generatedAt !== "string")
		throw new Error("generatedAt inválido.");
	if (typeof value.projectId !== "string")
		throw new Error("projectId inválido.");
	if (!isSource(value.source)) throw new Error("source inválido.");
	if (!Array.isArray(value.requests)) throw new Error("requests[] inválido.");
	const requests: AgentLabReviewRequest[] = [];
	for (const request of value.requests) {
		const result = validateAgentLabReviewRequest(request);
		if (!result.ok) throw new Error(result.errors.join("; "));
		requests.push(result.request);
	}
	return {
		generatedAt: value.generatedAt,
		projectId: value.projectId,
		source: value.source,
		warning: WARNING,
		requests,
		errors: Array.isArray(value.errors)
			? value.errors.filter(
					(error): error is string => typeof error === "string",
				)
			: [],
	};
}

function isSource(value: unknown): value is AgentLabReviewRequestSource {
	return (
		value === "postflight" ||
		value === "skill_draft" ||
		value === "semantic_agent_tasks" ||
		value === "supervisor_improvements" ||
		value === "project_core_constitution" ||
		value === "manual"
	);
}

function skillDraftContext(review: {
	path: string;
	plan?: SkillDraftPlan;
}): string {
	const plan = review.plan!;
	return [
		`Source skill draft path: ${review.path}`,
		`Source proposal file: ${plan.sourceProposalFile}`,
		`Skill drafts: ${plan.skillDrafts.length}`,
		...plan.skillDrafts.flatMap((draft, index) => [
			`Draft ${index + 1}:`,
			`- Proposal: ${draft.proposalId}`,
			`- Skill: ${draft.skillName}`,
			`- Action: ${draft.action}`,
			`- Target path (future only, do not inspect as real file): ${draft.targetPath ?? "none"}`,
			`- Purpose: ${draft.purpose}`,
			`- When to use: ${draft.whenToUse}`,
			`- Safety rules: ${draft.safetyRules.join("; ") || "none"}`,
			`- Tests suggested: ${draft.testsSuggested.join("; ") || "none"}`,
			`- Content preview:\n${draft.contentPreview}`,
		]),
		`Omitidas: ${plan.omittedProposals.length}`,
	].join("\n");
}

function skillDraftEvidence(review: {
	path: string;
	plan?: SkillDraftPlan;
}): string[] {
	const plan = review.plan!;
	return [
		`sourceSkillDraftPath: ${review.path}`,
		...plan.skillDrafts.flatMap((draft) => [
			`${draft.proposalId}: ${draft.title}`,
			`skillName: ${draft.skillName}`,
			`action: ${draft.action}`,
			`purpose: ${draft.purpose}`,
			`whenToUse: ${draft.whenToUse}`,
			`safetyRules: ${draft.safetyRules.join("; ") || "none"}`,
			`testsSuggested: ${draft.testsSuggested.join("; ") || "none"}`,
			`contentPreview:\n${draft.contentPreview}`,
		]),
	];
}

function formatRequests(requests: AgentLabReviewRequest[]): string[] {
	return requests.length
		? requests.map(
				(request) =>
					`- ${request.specialty}: ${request.objective} | humanApproval=${request.requiresHumanApproval}`,
			)
		: ["- ninguna"];
}

function formatRequestDetail(request: AgentLabReviewRequest): string[] {
	return [
		`- specialty: ${request.specialty}`,
		`  objective: ${request.objective}`,
		...(request.sourceSkillDraftPath
			? [`  sourceSkillDraftPath: ${request.sourceSkillDraftPath}`]
			: []),
		`  forbiddenActions: ${request.forbiddenActions.join("; ")}`,
		`  maxCommands: ${request.maxCommands}`,
		`  maxMinutes: ${request.maxMinutes}`,
		`  tokenBudgetHint: ${request.tokenBudgetHint}`,
		`  expectedOutputs: ${request.expectedOutputs.join("; ")}`,
		`  requiresHumanApproval: ${request.requiresHumanApproval}`,
	];
}

function formatList(items: string[]): string[] {
	return items.length ? items.map((item) => `- ${item}`) : ["- ninguno"];
}

function requestId(
	projectId: string,
	source: string,
	specialty: string,
	index: number,
): string {
	return `agentlab-${slug(projectId)}-${slug(source)}-${slug(specialty)}-${String(index).padStart(2, "0")}`;
}

function slug(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/gu, "-")
			.replace(/^-|-$/gu, "") || "unknown"
	);
}

function timestamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object";
}
