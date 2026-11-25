import { INSTRUCTIONS_KEY } from "./agent.js";
import { CompactionTask } from "./compaction.js";
import { GenerationTask } from "./generation.js";
import { ToolTask } from "./tool.js";
const SECTION_KEY = /^[a-z][a-z0-9_-]*$/;
/** Built-in task definitions every registry holds; they are not an extension and cannot be removed or replaced. */
export const BUILTIN_TASKS = [GenerationTask, ToolTask, CompactionTask];
/** Immutable published registry state. */
class RegistryState {
    #extensions;
    #byName;
    #tasks;
    constructor(extensions) {
        this.#extensions = extensions;
        this.#byName = new Map(extensions.map((extension) => [extension.name, extension]));
        const tasks = new Map();
        for (const task of BUILTIN_TASKS)
            tasks.set(task.definition.name, task);
        for (const extension of extensions) {
            for (const task of extension.tasks ?? []) {
                const name = task.definition.name;
                if (tasks.has(name))
                    throw new Error(`Task ${name} of extension ${extension.name} is already installed`);
                tasks.set(name, task);
            }
        }
        this.#tasks = tasks;
    }
    installed() {
        return this.#extensions;
    }
    extension(name) {
        return this.#byName.get(name);
    }
    tools() {
        return this.#extensions.flatMap((extension) => (extension.tools ?? []).map((tool) => ({ extension, tool })));
    }
    sections() {
        return this.#extensions.flatMap((extension) => (extension.sections ?? []).map((section) => ({ extension, section })));
    }
    tasks() {
        return [...this.#tasks.values()];
    }
    task(name) {
        return this.#tasks.get(name);
    }
}
class RegistryImpl {
    #current = new RegistryState([]);
    #listeners = new Set();
    snapshot() {
        return this.#current;
    }
    subscribe(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    install(extension) {
        validateExtension(extension);
        const current = this.#current.installed();
        const index = current.findIndex((installed) => installed.name === extension.name);
        const next = index < 0 ? [...current, extension] : current.map((installed, at) => (at === index ? extension : installed));
        this.#publish(next);
    }
    uninstall(extension) {
        const current = this.#current.installed();
        if (!current.some((installed) => installed.name === extension.name))
            return;
        this.#publish(current.filter((installed) => installed.name !== extension.name));
    }
    /** Build and validate the next state, which throws on a task name collision, then publish it synchronously. */
    #publish(extensions) {
        this.#current = new RegistryState(extensions);
        for (const listener of [...this.#listeners])
            listener();
    }
}
/** Unique tool names and section keys within one extension; valid, unreserved section keys. */
function validateExtension(extension) {
    const tools = new Set();
    for (const tool of extension.tools ?? []) {
        if (tools.has(tool.name))
            throw new Error(`Extension ${extension.name} has two tools named ${tool.name}`);
        tools.add(tool.name);
    }
    const sections = new Set();
    for (const { key } of extension.sections ?? []) {
        if (!SECTION_KEY.test(key))
            throw new TypeError(`Section key ${JSON.stringify(key)} must match ${SECTION_KEY}`);
        if (key === INSTRUCTIONS_KEY)
            throw new Error(`Section key ${key} is reserved for the agent's instructions`);
        if (sections.has(key))
            throw new Error(`Extension ${extension.name} has two sections with key ${key}`);
        sections.add(key);
    }
}
/** Create an application-owned registry holding only the built-in tasks. */
export function createRegistry() {
    return new RegistryImpl();
}
//# sourceMappingURL=registry.js.map