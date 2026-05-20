import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLabFindingsFromOutput } from "../src/lab-finding-parser.js";

const context = {
	projectId: "pi-telegram-bridge",
	agentId: "spark",
	labRunId: "run-1",
};

test("parseLabFindingsFromOutput returns no findings for unclear output", () => {
	const findings = parseLabFindingsFromOutput(
		"Resumen corto\nTests ejecutados: corepack pnpm test\nSin hallazgos.",
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput extracts finding from valid JSON", () => {
	const findings = parseLabFindingsFromOutput(
		`Analysis result:\n{\n  "findings": [\n    {\n      "title": "Build command fails",\n      "description": "The build command exits with TypeScript errors.",\n      "severity": "high",\n      "confidence": "medium",\n      "evidence": "corepack pnpm build exited with code 2",\n      "suspectedCause": "Missing exported type"\n    }\n  ]\n}`,
		context,
	);

	assert.equal(findings.length, 1);
	assert.equal(findings[0].projectId, "pi-telegram-bridge");
	assert.equal(findings[0].title, "Build command fails");
	assert.equal(
		findings[0].description,
		"The build command exits with TypeScript errors.",
	);
	assert.equal(findings[0].severity, "high");
	assert.equal(findings[0].confidence, "medium");
	assert.equal(findings[0].evidence, "corepack pnpm build exited with code 2");
	assert.equal(findings[0].suspectedCause, "Missing exported type");
});

test("parseLabFindingsFromOutput discards JSON finding without evidence", () => {
	const findings = parseLabFindingsFromOutput(
		JSON.stringify({
			findings: [
				{
					title: "Missing evidence",
					description: "This should not be recorded.",
					severity: "critical",
					confidence: "high",
				},
			],
		}),
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput extracts affectedFiles from JSON", () => {
	const findings = parseLabFindingsFromOutput(
		JSON.stringify({
			findings: [
				{
					title: "Unsafe SQL interpolation",
					description: "A numeric field is interpolated directly into SQL.",
					evidence: "durationMs accepted injected SQL text",
					affectedFiles: ["src/lab-db.ts", "test/lab-db-repository.test.ts"],
				},
			],
		}),
		context,
	);

	assert.deepEqual(findings[0].affectedFiles, [
		"src/lab-db.ts",
		"test/lab-db-repository.test.ts",
	]);
});

test("parseLabFindingsFromOutput generates stable dedupeKey", () => {
	const output = JSON.stringify({
		findings: [
			{
				title: "Unsafe SQL interpolation",
				description: "A numeric field is interpolated directly into SQL.",
				evidence: "durationMs accepted injected SQL text",
				affectedFiles: ["src/lab-db.ts"],
			},
		],
	});

	const first = parseLabFindingsFromOutput(output, context)[0];
	const second = parseLabFindingsFromOutput(output, context)[0];

	assert.equal(first.dedupeKey, second.dedupeKey);
	assert.equal(
		first.dedupeKey,
		"pi-telegram-bridge:spark:unsafe-sql-interpolation:src/lab-db.ts",
	);
});

test("parseLabFindingsFromOutput does not throw on invalid JSON", () => {
	assert.doesNotThrow(() =>
		parseLabFindingsFromOutput(`{"findings":[{"title":"Broken",`, context),
	);
});

test("parseLabFindingsFromOutput returns empty for incomplete JSON fragments", () => {
	const findings = parseLabFindingsFromOutput(
		`{"findings":[{"title":"Build failed",\n"description":"No evidence field."`,
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput does not invent high severity without evidence", () => {
	const findings = parseLabFindingsFromOutput(
		"Possible issue: something might be slow, but no command output or file evidence was captured.",
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput does not fallback from JSON finding without evidence", () => {
	const findings = parseLabFindingsFromOutput(
		JSON.stringify({
			findings: [
				{
					title: "Build failed",
					description: "No evidence field.",
				},
			],
		}),
		context,
	);

	assert.deepEqual(findings, []);
});

test("parseLabFindingsFromOutput ignores negated failure text", () => {
	const findings = parseLabFindingsFromOutput(
		"No failure found after running tests. Build passed and no errors were detected.",
		context,
	);

	assert.deepEqual(findings, []);
});
