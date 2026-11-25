import { errorMessage } from "../errors.js";
import { AgentDoc } from "../harness/agent.js";
import { defineExtension, hook } from "../harness/define.js";
import { ToolTask } from "../harness/tool.js";
import { detectSupportedImageMimeType } from "../tools/image.js";
import { fromBase64, imageLimits, preparedNotes, } from "../tools/image-processor.js";
/**
 * The image in `bytes`, declared as `mimeType`, prepared by `processor` to fit `limits`. Every image is decoded, as the
 * coding agent's are: one the provider would reject (damaged, or too large) never reaches the transcript, where it would
 * fail every later request. Its type is read from its bytes, since providers reject a declared type that differs. An
 * image the processor cannot prepare, or fails on, is left out with a note.
 */
export async function fitImage(bytes, mimeType, limits, processor) {
    let prepared;
    try {
        prepared = await processor.prepare(bytes, detectSupportedImageMimeType(bytes) ?? mimeType, limits);
    }
    catch (error) {
        // The image is known to need preparing: keeping it would commit what the provider rejects. The note carries the
        // failure into the transcript.
        return omitted(mimeType, `: ${errorMessage(error)}`);
    }
    if (prepared === undefined)
        return omitted(mimeType, "");
    const image = { type: "image", data: prepared.data, mimeType: prepared.mimeType };
    return { kind: "fitted", image, notes: preparedNotes(prepared) };
}
function omitted(mimeType, reason) {
    return {
        kind: "omitted",
        note: `An image (${mimeType}) cannot be prepared for the model and was left out${reason}.`,
    };
}
/**
 * `content` with each image fitted by `fitImage` (malformed base64 is left out as an image that cannot be prepared);
 * text stays where it is. `unchanged` when every image came back as it was.
 */
export async function fitImages(content, limits, processor) {
    const fitted = [];
    const notes = [];
    let changed = false;
    for (const item of content) {
        if (item.type !== "image") {
            fitted.push(item);
            continue;
        }
        const result = await fitBase64(item, limits, processor);
        if (result.kind === "omitted") {
            changed = true;
            notes.push(result.note);
        }
        else if (result.image.data === item.data && result.image.mimeType === item.mimeType) {
            fitted.push(item);
        }
        else {
            changed = true;
            fitted.push(result.image);
            notes.push(...result.notes);
        }
    }
    return changed ? { kind: "fitted", content: fitted, notes } : { kind: "unchanged" };
}
async function fitBase64(image, limits, processor) {
    let bytes;
    try {
        bytes = fromBase64(image.data);
    }
    catch (error) {
        // Wire input: a tool's base64 may be malformed.
        return omitted(image.mimeType, `: ${errorMessage(error)}`);
    }
    return fitImage(bytes, image.mimeType, limits, processor);
}
/**
 * The `fit-images` extension: an `afterTool` hook that fits the images of every result the model gets to the
 * conversation model's current limits (`fitImages`) before it is committed, whichever tool made them (an MCP tool, code
 * mode's `image()`), and says what changed in an `info` diagnostic (code `image`). Hooks of extensions installed before
 * it see the images unfitted. Nested calls' results are left as they are: the program that made the call gets them, not
 * the model.
 */
export function createFitImagesExtension(processor) {
    return defineExtension({
        name: "fit-images",
        hooks: [
            hook(ToolTask, {
                afterTool: (call, result, api, context) => fitResult(call, result, processor, api, context),
            }),
        ],
    });
}
async function fitResult(call, result, processor, api, context) {
    if (call.parent !== undefined || !result.output?.some((item) => item.type === "image"))
        return undefined;
    const ref = (await api.snapshot(AgentDoc, api.conversationId, context))?.model;
    const model = ref === undefined ? undefined : api.models.getModel(ref.provider, ref.modelId);
    const fitted = await fitImages(result.output, imageLimits(model), processor);
    if (fitted.kind === "unchanged")
        return undefined;
    if (fitted.notes.length === 0)
        return { ...result, output: fitted.content };
    const note = { severity: "info", code: "image", message: fitted.notes.join(" ") };
    return { ...result, output: fitted.content, diagnostics: [...(result.diagnostics ?? []), note] };
}
//# sourceMappingURL=fit.js.map