// Upstream excerpt from pi-mcp-adapter 7.0.1 (MIT, Copyright (c) 2026 Nico
// Bailon): proxy-modes.ts, the two functions scripts/pi-mcp-adapter-patch
// edits. Verbatim except for this header and the elision marker below. The
// three patch anchors are exact. See README.md in this directory.

// … (unrelated proxy-mode helpers)

function ensureBackgroundAuthWatcher(
  state: McpExtensionState,
  serverName: string,
  serverUrl: string,
  definition: ServerEntry,
): void {
  let watchers = backgroundAuthWatchers.get(state);
  if (!watchers) {
    watchers = new Map();
    backgroundAuthWatchers.set(state, watchers);
  }
  if (watchers.has(serverName)) return;

  const authOptions = {
    authStorageOptions: state.authStorageOptions,
    runtime: state.oauthRuntime,
    openAuthorizationUrl: state.openBrowser,
  };
  const watcher = authenticate(serverName, serverUrl, definition, authOptions).then(async (status) => {
    throwIfAborted(state.owner.signal);
    if (status !== "authenticated") throw new Error(`OAuth authentication ended with status: ${status}`);
    await state.manager.close(serverName);
    throwIfAborted(state.owner.signal);
    clearFailure(state, serverName, "auth-background-complete");
    updateStatusBar(state);
    emitAuthStatus(
      state,
      serverName,
      "authenticated",
      `OAuth authentication completed for MCP server "${serverName}". Connect it now to load and verify its tools.`,
    );
  });
  watchers.set(serverName, watcher);

  void watcher.catch(async (error) => {
    if (isAbortError(error, state.owner.signal)) return;
    try {
      if (await getAuthStatus(serverName, authOptions) === "authenticated") return;
    } catch (statusError) {
      if (isAbortError(statusError, state.owner.signal)) return;
    }
    if (state.owner.signal.aborted) return;
    emitAuthStatus(
      state,
      serverName,
      "failed",
      `OAuth authentication failed for MCP server "${serverName}". Start authorization again or inspect trusted logs.`,
    );
  }).finally(() => {
    if (watchers?.get(serverName) === watcher) watchers.delete(serverName);
  });
}

// … (background watcher error handling and other proxy-mode code)

async function attemptAutoAuth(
  state: McpExtensionState,
  serverName: string,
  signal?: AbortSignal,
): Promise<AutoAuthResult> {
  if (state.config.settings?.autoAuth !== true) {
    return { status: "skipped" };
  }

  const definition = state.config.mcpServers[serverName];
  if (!definition || isServerDisabled(definition) || !supportsOAuth(definition)) {
    return { status: "skipped" };
  }

  let serverUrl: string | undefined;
  try {
    serverUrl = resolveServerUrl(definition);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", message: getAuthFailedMessage(state, serverName, message) };
  }
  if (!serverUrl) {
    return { status: "skipped" };
  }

  const grantType = definition.oauth ? definition.oauth.grantType ?? "authorization_code" : "authorization_code";
  if (!state.ui && grantType !== "client_credentials") {
    return {
      status: "failed",
      message: getAuthRequiredMessage(
        state,
        serverName,
        `Server "${serverName}" requires OAuth authentication. Run mcp({ action: "auth-start", server: "${serverName}" }) to get a browser URL, or /mcp-auth ${serverName} in an interactive local session.`,
      ),
    };
  }

  try {
    if (state.authStorageOptions) {
      await authenticate(
        serverName,
        serverUrl,
        definition,
        signal
          ? { authStorageOptions: state.authStorageOptions, signal, runtime: state.oauthRuntime }
          : { authStorageOptions: state.authStorageOptions, runtime: state.oauthRuntime },
      );
    } else {
      if (signal) {
        await authenticate(serverName, serverUrl, definition, { signal, runtime: state.oauthRuntime });
      } else {
        await authenticate(serverName, serverUrl, definition, { runtime: state.oauthRuntime });
      }
    }
    return { status: "success" };
  } catch (error) {
    if (isAbortError(error, signal)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      message: getAuthFailedMessage(state, serverName, message),
    };
  }
}
