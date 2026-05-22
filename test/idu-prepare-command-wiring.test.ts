import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("/idu_prepare is wired without unsafe operations", () => {
	const source = readFileSync("src/index.ts", "utf8");

	assert.match(source, /bot\.command\("idu_prepare"/u);
	assert.match(source, /runIduPrepare\(/u);
	assert.match(source, /formatIduPrepareResult\(/u);

	const handler = source.slice(source.indexOf('bot.command("idu_prepare"'));
	const handlerBlock = handler.slice(
		0,
		handler.indexOf('bot.command("preflight"'),
	);
	assert.doesNotMatch(handlerBlock, /applyProjectFlowsDraft\(/u);
	assert.doesNotMatch(handlerBlock, /runTestLab\(/u);
	assert.doesNotMatch(handlerBlock, /runLabForProfiles\(/u);
	assert.doesNotMatch(handlerBlock, /runLabForProfilesService\(/u);
});

test("/idu response advertises prepare only when safe", () => {
	const source = readFileSync("src/index.ts", "utf8");
	const handler = source.slice(source.indexOf('bot.command("idu"'));
	const handlerBlock = handler.slice(
		0,
		handler.indexOf('bot.command("idu_prepare"'),
	);

	assert.match(handlerBlock, /iduConnectionActionText\(report\)/u);
	const actionHelper = source.slice(
		source.indexOf("function iduConnectionActionText"),
	);
	const actionHelperBlock = actionHelper.slice(
		0,
		actionHelper.indexOf("function buildPostflightReport"),
	);
	const readyBlock = actionHelperBlock.slice(
		actionHelperBlock.indexOf('report.status === "ready"'),
		actionHelperBlock.indexOf('report.status === "needs_understanding"'),
	);

	assert.match(source, /Preparar proyecto: \/idu_prepare/u);
	assert.match(source, /Listo para operar/u);
	assert.match(source, /corregí la conexión antes de preparar/u);
	assert.doesNotMatch(readyBlock, /Preparar proyecto/u);
});
