export default function quizHandoutExtension() {}

export function handoutModelOptions(signal: AbortSignal | undefined) {
	return { signal, reasoningEffort: "low" as const };
}
