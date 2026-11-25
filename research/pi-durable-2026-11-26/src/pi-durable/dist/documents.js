import { copyJson } from "@earendil-works/chord/json";
import { idFromNumber } from "./ids.js";
export function defineDoc(definition) {
    validateDefinition(definition);
    return { definition };
}
export function defineDocFamily(definition) {
    validateDefinition(definition);
    return { definition };
}
function validateDefinition(definition) {
    if (!Number.isSafeInteger(definition.version) || definition.version < 1) {
        throw new TypeError(`Document ${definition.kind} version must be a positive integer`);
    }
}
/** Resolve an overloaded argument list and return the index after the owner and family key. */
export function resolveAddress(definition, args) {
    let index = 0;
    let scope;
    switch (definition.scope) {
        case "session":
            scope = { kind: "session" };
            break;
        case "conversation":
            scope = { kind: "conversation", conversationId: ownerId(args[index++], definition) };
            break;
        case "task":
            scope = { kind: "task", taskId: ownerId(args[index++], definition) };
            break;
    }
    const key = definition.family === true ? args[index++] : undefined;
    const address = key === undefined ? { kind: definition.kind, scope } : { kind: definition.kind, scope, key };
    return { address, id: addressId(address), nextArgument: index };
}
function ownerId(value, definition) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new TypeError(`Document ${definition.kind} requires a ${definition.scope} ID`);
    }
    return idFromNumber(value);
}
/** Stable string identity of one logical address. */
export function addressId(address) {
    const owner = address.scope.kind === "session"
        ? null
        : address.scope.kind === "conversation"
            ? address.scope.conversationId
            : address.scope.taskId;
    return JSON.stringify([address.kind, address.scope.kind, owner, address.key ?? null]);
}
/** Build the storage create record for a new incarnation at an address. */
export function documentCreate(definition, address, id) {
    const key = address.key === undefined ? {} : { key: address.key };
    switch (address.scope.kind) {
        case "session":
            return { id, kind: address.kind, ...key, scope: address.scope };
        case "task":
            return { id, kind: address.kind, ...key, scope: address.scope };
        case "conversation":
            return {
                id,
                kind: address.kind,
                ...key,
                scope: address.scope,
                history: definition.history,
                fork: definition.fork,
            };
    }
}
/** Reject typed access whose token disagrees with the persisted scope, history, or fork semantics. */
export function checkRecordScope(definition, record) {
    if (record.scope.kind !== definition.scope ||
        (record.scope.kind === "conversation" &&
            (record.history !== definition.history || record.fork !== definition.fork))) {
        throw new TypeError(`Document ${record.id} (${record.kind}) does not match the supplied definition semantics`);
    }
}
/** Reject typed access to a stored version the supplied definition cannot use. */
export function checkRecordVersion(definition, record, version) {
    if (version > definition.version) {
        throw new Error(`Document ${record.id} (${record.kind}) has newer version ${version} than ${definition.version}`);
    }
    if (version < definition.version && definition.migrate === undefined) {
        throw new Error(`Document ${record.id} (${record.kind}) requires migration from version ${version}`);
    }
}
/** Validate and materialize a detached stored value for typed access. */
export function materializeDocument(definition, stored) {
    return materializeDocumentValue(definition, stored.record, stored.version, stored.value);
}
/** Validate and materialize one detached value before its first persisted incarnation. */
export function materializeDocumentValue(definition, record, version, value) {
    checkRecordScope(definition, record);
    checkRecordVersion(definition, record, version);
    if (version === definition.version)
        return value;
    return copyJson(definition.migrate(value, version));
}
//# sourceMappingURL=documents.js.map