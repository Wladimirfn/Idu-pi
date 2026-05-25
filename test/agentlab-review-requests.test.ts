import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import test from "node:test";
import {
	createAgentLabReviewRequests,
	formatAgentLabReviewRequestPlan,
	formatAgentLabReviewRequestReview,
	reviewAgentLabReviewRequest,
} from "../src/agentlab-review-requests.js";
import type { ProjectPostflightReport } from "../src/project-postflight.js";

function root(): string {
	return mkdtempSync(join(tmpdir(), "agentlab-review-requests-"));
}

function now(): Date {
	return new Date("2026-05-25T12:34:56.000Z");
}

function postflight(changedFiles: string[]): ProjectPostflightReport {
	return {
		risk: "high",
		changedFiles,
		impactedAreas: changedFiles.some((file) => /db|schema/u.test(file))
			? ["DB/storage"]
			: ["seguridad"],
		warnings: changedFiles.map((file) => `revisar ${file}`),
		recommendedNext: "Crear solicitud AgentLab antes de ejecutar revisión.",
		shouldRunAgentLab: true,
		suggestedAgentLabs: [],
		requiresHumanConfirmation: true,
		diffSummary: changedFiles.join("\n"),
	};
}

function writeSkillDraft(reportsPath: string): void {
	mkdirSync(reportsPath, { recursive: true });
	writeFileSync(
		join(reportsPath, "skill-draft-20260525-120000.json"),
		`${JSON.stringify(
			{
				generatedAt: "2026-05-25T12:00:00.000Z",
				sourceProposalFile: "skill-improvement-proposals-20260525-110000.json",
				warning: "Borrador de skill. No es fuente de verdad.",
				skillDrafts: [
					{
						proposalId: "skill-improvement-001",
						action: "create_skill",
						skillName: "security-auth-review",
						targetPath: ".agents/skills/security-auth-review/SKILL.md",
						title: "Crear skill security-auth-review",
						purpose: "Revisar auth",
						whenToUse: "Cambios de login",
						safetyRules: ["No aplicar automáticamente"],
						inputsExpected: ["draft"],
						outputsExpected: ["review"],
						testsSuggested: ["skill-check"],
						contentPreview: "---\nname: security-auth-review\n---",
						requiresHumanApproval: true,
					},
				],
				omittedProposals: [],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
}

test("postflight high crea request security/database según impacto", () => {
	const reportsPath = join(root(), "reports");
	const security = createAgentLabReviewRequests({
		source: "postflight",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		postflightReport: postflight(["src/auth/login.ts"]),
		now,
	});
	const database = createAgentLabReviewRequests({
		source: "postflight",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		postflightReport: postflight(["src/db/schema.ts"]),
		now: () => new Date("2026-05-25T12:35:56.000Z"),
	});

	assert.equal(security.requests[0]?.specialty, "security");
	assert.equal(database.requests[0]?.specialty, "database");
	assert.match(
		security.path ?? "",
		/agentlab-review-request-\d{8}-\d{6}\.json$/u,
	);
	assert.ok(existsSync(security.path!));
});

test("skill-draft crea request skill_review", () => {
	const reportsPath = join(root(), "reports");
	writeSkillDraft(reportsPath);
	const result = createAgentLabReviewRequests({
		source: "skill_draft",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		skillDraftPathOrLatest: "latest",
		now,
	});
	assert.equal(result.requests.length, 1);
	assert.equal(result.requests[0]?.specialty, "skill_review");
	assert.match(
		result.requests[0]!.forbiddenActions.join("\n"),
		/no modificar skills reales/u,
	);
});

test("request siempre incluye forbiddenActions obligatorias", () => {
	const result = createAgentLabReviewRequests({
		source: "manual",
		reportsPath: join(root(), "reports"),
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		manualObjective: "revisar seguridad",
		manualContext: "auth login",
		now,
	});
	const forbidden = result.requests[0]!.forbiddenActions.join("\n");
	assert.match(forbidden, /no modificar repo real/u);
	assert.match(forbidden, /no commit/u);
	assert.match(forbidden, /no push/u);
});

test("security/database fuerza requiresHumanApproval", () => {
	const security = createAgentLabReviewRequests({
		source: "postflight",
		reportsPath: join(root(), "reports"),
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		postflightReport: postflight(["src/auth/login.ts"]),
		now,
	});
	const database = createAgentLabReviewRequests({
		source: "postflight",
		reportsPath: join(root(), "reports"),
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		postflightReport: postflight(["src/db/schema.ts"]),
		now,
	});
	assert.ok(
		[...security.requests, ...database.requests]
			.filter(
				(request) =>
					request.specialty === "security" || request.specialty === "database",
			)
			.every((request) => request.requiresHumanApproval),
	);
});

test("review latest valida request", () => {
	const reportsPath = join(root(), "reports");
	createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		manualObjective: "revisar UI html components",
		manualContext: "UI html components",
		now,
	});
	const review = reviewAgentLabReviewRequest("latest", reportsPath);
	assert.equal(review.valid, true);
	assert.equal(review.plan?.requests[0]?.specialty, "ui_ux");
	assert.match(formatAgentLabReviewRequestReview(review), /Specialties/u);
});

test("ruta fuera de reports falla", () => {
	const temp = root();
	const outside = join(temp, "agentlab-review-request-20260525-123456.json");
	writeFileSync(outside, "{}\n", "utf8");
	const review = reviewAgentLabReviewRequest(outside, join(temp, "reports"));
	assert.equal(review.valid, false);
	assert.match(
		review.errors.join("\n"),
		/dentro de AGENT_WORKSPACE_ROOT\/reports/u,
	);
});

test("nombre inválido falla", () => {
	const reportsPath = join(root(), "reports");
	mkdirSync(reportsPath, { recursive: true });
	writeFileSync(join(reportsPath, "bad.json"), "{}\n", "utf8");
	const review = reviewAgentLabReviewRequest("bad.json", reportsPath);
	assert.equal(review.valid, false);
	assert.match(review.errors.join("\n"), /agentlab-review-request/u);
});

test("no modifica .agents ni .atl", () => {
	const temp = root();
	mkdirSync(join(temp, ".agents"));
	mkdirSync(join(temp, ".atl"));
	const result = createAgentLabReviewRequests({
		source: "manual",
		reportsPath: join(temp, "reports"),
		projectId: "pi-telegram-bridge",
		projectPath: temp,
		manualObjective: "revisar docs",
		manualContext: "docs",
		now,
	});
	assert.deepEqual(
		readFileSync(result.path!, "utf8").includes("Solicitud AgentLab"),
		true,
	);
	assert.ok(existsSync(join(temp, ".agents")));
	assert.ok(existsSync(join(temp, ".atl")));
});

test("format plan confirma que no ejecuta AgentLabs", () => {
	const plan = createAgentLabReviewRequests({
		source: "manual",
		reportsPath: join(root(), "reports"),
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		manualObjective: "revisar token cost context bloat",
		manualContext: "context bloat",
		now,
	});
	assert.match(formatAgentLabReviewRequestPlan(plan), /No ejecuté AgentLabs/u);
});
