import {
	initLabDb,
	listOpenFindings,
	recordBugFinding,
	type BugFinding,
	type BugFindingInput,
	type InitLabDbResult,
} from "./lab-db.js";

export class LabDbRepository {
	constructor(private readonly dbPath: string) {}

	init(): InitLabDbResult {
		return initLabDb(this.dbPath);
	}

	recordBugFinding(input: BugFindingInput): void {
		recordBugFinding(this.dbPath, input);
	}

	listOpenFindings(projectId: string): BugFinding[] {
		return listOpenFindings(this.dbPath, projectId);
	}
}
