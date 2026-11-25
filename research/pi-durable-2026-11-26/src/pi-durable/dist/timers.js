/** Longest delay `setTimeout` supports; a longer one is waited for in several steps. */
const MAX_TIMER_DELAY = 2_147_483_647;
/**
 * Cloudflare Workers: a pending timer keeps a Durable Object from hibernating or being evicted, even an unreferenced
 * one (`nodejs_compat` gives timers an `unref()` that changes nothing).
 */
const inWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
/**
 * The default `HarnessOptions.setTimer`: `setTimeout`, waiting out delays beyond its limit in steps. A background timer
 * is unreferenced, so it never keeps the process alive. It is declined in Cloudflare Workers and wherever timers cannot
 * be unreferenced.
 */
export const nativeTimer = (callback, delayMs, options) => {
    if (options.background && inWorkers)
        return undefined;
    const arm = (remaining) => {
        const next = setTimeout(() => {
            if (remaining > MAX_TIMER_DELAY)
                handle = arm(remaining - MAX_TIMER_DELAY);
            else
                callback();
        }, Math.min(remaining, MAX_TIMER_DELAY));
        if (options.background)
            next.unref?.();
        return next;
    };
    let handle = arm(Math.max(0, delayMs));
    if (options.background && typeof handle.unref !== "function") {
        clearTimeout(handle);
        return undefined;
    }
    return () => clearTimeout(handle);
};
/**
 * Wrap a host `setTimer`. A foreground timer must fire, or work stalls: one the host throws on or declines is armed
 * with `setTimeout`, and the first such failure is reported. A background one the host throws on is reported and
 * declined.
 */
export function hostTimers(setTimer, report) {
    const arm = setTimer ?? nativeTimer;
    let reported = false;
    const fallBack = (error) => {
        if (reported)
            return;
        reported = true;
        report(error);
    };
    return {
        foreground: (callback, delayMs) => {
            try {
                const disarm = arm(callback, delayMs, { background: false });
                if (disarm !== undefined)
                    return disarm;
                fallBack(new Error("HarnessOptions.setTimer declined a timer that paces work; using setTimeout"));
            }
            catch (error) {
                fallBack(error);
            }
            return nativeTimer(callback, delayMs, { background: false });
        },
        background: (callback, delayMs) => {
            try {
                return arm(callback, delayMs, { background: true });
            }
            catch (error) {
                report(error);
                return undefined;
            }
        },
    };
}
//# sourceMappingURL=timers.js.map