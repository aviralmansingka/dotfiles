import type { RegistryValue } from "@earendil-works/chord";
import type { Context } from "@earendil-works/chord/context";
import type { RegistryReader, RegistrySnapshot, ToolRegistration } from "./types.ts";
/**
 * A `RegistryReader` over a Chord registry value whose composition is a registry snapshot: `snapshot()` reads the
 * current composition (the last good one while `compose` fails), `subscribe` observes its compositions, its listener
 * called synchronously inside the Chord batch that composed (so it only wakes the scheduler; a Chord call there
 * throws `invalid/reentrant`). `context` is the observation's: aborting it detaches every listener.
 */
export declare function registryReader<Tool extends ToolRegistration = ToolRegistration>(value: RegistryValue<RegistrySnapshot<Tool>>, context: Context): RegistryReader<Tool>;
//# sourceMappingURL=registry-reader.d.ts.map