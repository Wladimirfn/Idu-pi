export class TaskQueue {
	private items: string[] = [];

	get size(): number {
		return this.items.length;
	}

	enqueue(text: string): boolean {
		const trimmed = text.trim();
		if (!trimmed) return false;
		this.items.push(trimmed);
		return true;
	}

	dequeue(): string | undefined {
		return this.items.shift();
	}

	drain(): string[] {
		const drained = [...this.items];
		this.items = [];
		return drained;
	}

	clear(): number {
		const count = this.items.length;
		this.items = [];
		return count;
	}

	formatStatus(): string {
		if (!this.items.length) return "Cola de tareas vacía.";
		return `Cola de tareas (${this.items.length}):\n\n${this.items
			.map((item, index) => `Q${index + 1}. ${item}`)
			.join("\n")}`;
	}
}
