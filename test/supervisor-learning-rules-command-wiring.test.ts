import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("supervisor learning rules commands are wired safely", () => {
	const source = readFileSync("src/index.ts", "utf8");
	const cli = readFileSync("src/cli.ts", "utf8");
	const registry = readFileSync("src/telegram-command-registry.ts", "utf8");
	const catalog = readFileSync("src/command-catalog.ts", "utf8");
	const extension = readFileSync(".pi/extensions/idu-pi-commands.ts", "utf8");

	for (const command of [
		"supervisor_improvements_apply",
		"supervisor_learning_rules_status",
	]) {
		assert.ok(source.includes(`bot.command("${command}"`));
		assert.ok(registry.includes(command));
		assert.ok(catalog.includes(command));
	}
	for (const command of [
		"idu-supervisor-improvements-apply",
		"idu-supervisor-learning-rules-status",
	]) {
		assert.ok(cli.includes(command));
		assert.ok(extension.includes(command));
	}
	assert.ok(source.includes("applySupervisorLearningRules"));
	assert.ok(source.includes("getSupervisorLearningRulesStatus"));
});
