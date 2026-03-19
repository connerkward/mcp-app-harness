import { useState, useCallback, useRef } from "react";
import type { ServerConnection, ToolInfo, LogEntry } from "./mcp-client.ts";
import { connectToServer, callTool, readResource } from "./mcp-client.ts";

type ResultTab = "result" | "app" | "log";

export function App() {
  const [servers, setServers] = useState<ServerConnection[]>([]);
  const [serverUrl, setServerUrl] = useState("http://localhost:3001/mcp");
  const [connecting, setConnecting] = useState(false);
  const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null);
  const [toolInput, setToolInput] = useState("{}");
  const [toolResult, setToolResult] = useState<unknown>(null);
  const [appHtml, setAppHtml] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [activeTab, setActiveTab] = useState<ResultTab>("result");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const addLog = useCallback(
    (direction: LogEntry["direction"], message: string) => {
      setLogs((prev) => [
        ...prev,
        { time: new Date(), direction, message },
      ]);
    },
    [],
  );

  const handleConnect = useCallback(async () => {
    if (!serverUrl.trim()) return;
    setConnecting(true);
    addLog("send", `Connecting to ${serverUrl}`);
    try {
      const conn = await connectToServer(serverUrl.trim());
      if (conn.status === "error") {
        addLog("error", `Failed: ${conn.error}`);
      } else {
        addLog("recv", `Connected. ${conn.tools.length} tools, ${conn.resources.length} resources`);
        setServers((prev) => [...prev, conn]);
      }
    } catch (e) {
      addLog("error", String(e));
    }
    setConnecting(false);
  }, [serverUrl, addLog]);

  const handleDisconnect = useCallback((url: string) => {
    setServers((prev) => prev.filter((s) => s.url !== url));
    setSelectedTool((prev) => (prev?.serverUrl === url ? null : prev));
  }, []);

  const handleCallTool = useCallback(async () => {
    if (!selectedTool) return;
    const server = servers.find((s) => s.url === selectedTool.serverUrl);
    if (!server) return;

    setCalling(true);
    setToolResult(null);
    setAppHtml(null);

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolInput);
    } catch {
      addLog("error", "Invalid JSON input");
      setCalling(false);
      return;
    }

    addLog("send", `tools/call ${selectedTool.tool.name} ${JSON.stringify(args)}`);

    try {
      const result = await callTool(server, selectedTool.tool.name, args);
      setToolResult(result);
      addLog("recv", `Result: ${JSON.stringify(result).slice(0, 200)}`);
      setActiveTab("result");

      // If tool has UI, fetch the resource
      if (selectedTool.hasUi && selectedTool.resourceUri) {
        addLog("send", `resources/read ${selectedTool.resourceUri}`);
        try {
          const resource = await readResource(server, selectedTool.resourceUri);
          const content = resource.contents?.[0];
          if (content && "text" in content) {
            setAppHtml(content.text as string);
            setActiveTab("app");
            addLog("recv", `UI resource loaded (${(content.text as string).length} bytes)`);

            // Post tool result to iframe after it loads
            setTimeout(() => {
              if (iframeRef.current?.contentWindow) {
                iframeRef.current.contentWindow.postMessage(
                  {
                    jsonrpc: "2.0",
                    method: "ui/notifications/tool-result",
                    params: { result },
                  },
                  "*",
                );
                addLog("send", "Posted tool-result to app iframe");
              }
            }, 500);
          }
        } catch (e) {
          addLog("error", `Failed to load UI resource: ${e}`);
        }
      }
    } catch (e) {
      addLog("error", `Tool call failed: ${e}`);
      setToolResult({ error: String(e) });
    }

    setCalling(false);
  }, [selectedTool, servers, toolInput, addLog]);

  const handleSelectTool = useCallback((tool: ToolInfo) => {
    setSelectedTool(tool);
    const schema = tool.tool.inputSchema;
    if (schema && typeof schema === "object" && "properties" in schema) {
      const defaults: Record<string, unknown> = {};
      const props = schema.properties as Record<
        string,
        { default?: unknown; type?: string }
      >;
      for (const [key, val] of Object.entries(props)) {
        if (val.default !== undefined) defaults[key] = val.default;
        else if (val.type === "string") defaults[key] = "";
        else if (val.type === "number") defaults[key] = 0;
        else if (val.type === "boolean") defaults[key] = false;
      }
      setToolInput(JSON.stringify(defaults, null, 2));
    } else {
      setToolInput("{}");
    }
    setToolResult(null);
    setAppHtml(null);
  }, []);

  const allTools = servers.flatMap((s) => s.tools);

  return (
    <div className="harness">
      <div className="header">
        <h1>MCP App Harness</h1>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {servers.length} server{servers.length !== 1 ? "s" : ""} |{" "}
          {allTools.length} tool{allTools.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="sidebar">
        <div className="sidebar-section">
          <h3>Connect Server</h3>
          <div className="connect-form">
            <input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:3001/mcp"
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            />
            <button onClick={handleConnect} disabled={connecting}>
              {connecting ? "..." : "Connect"}
            </button>
          </div>
          {servers.length > 0 && (
            <div className="servers-list">
              {servers.map((s) => (
                <div key={s.url} className="server-tag">
                  <span className={`status-dot ${s.status}`} />
                  {new URL(s.url).host}
                  <button onClick={() => handleDisconnect(s.url)}>x</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-section" style={{ flex: 0 }}>
          <h3>Tools</h3>
        </div>
        <div className="tool-list">
          {allTools.length === 0 && (
            <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 13 }}>
              No tools. Connect a server.
            </div>
          )}
          {allTools.map((t) => (
            <div
              key={`${t.serverUrl}:${t.tool.name}`}
              className={`tool-item ${selectedTool?.tool.name === t.tool.name && selectedTool?.serverUrl === t.serverUrl ? "active" : ""}`}
              onClick={() => handleSelectTool(t)}
            >
              <div className="tool-name">
                {t.tool.name}
                {t.hasUi && <span className="tool-badge">UI</span>}
              </div>
              {t.tool.description && (
                <div className="tool-desc">{t.tool.description}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="main">
        {selectedTool ? (
          <>
            <div className="tool-panel">
              <h2>{selectedTool.tool.name}</h2>
              {selectedTool.tool.description && (
                <div className="tool-panel-desc">
                  {selectedTool.tool.description}
                </div>
              )}
              <div className="input-group">
                <label>Arguments (JSON)</label>
                <textarea
                  value={toolInput}
                  onChange={(e) => setToolInput(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="tool-actions">
                <button onClick={handleCallTool} disabled={calling}>
                  {calling ? "Calling..." : "Call Tool"}
                </button>
                {selectedTool.hasUi && (
                  <span
                    style={{ fontSize: 12, color: "var(--text-muted)" }}
                  >
                    Has UI at {selectedTool.resourceUri}
                  </span>
                )}
              </div>
            </div>

            <div className="result-area">
              <div className="result-tabs">
                <div
                  className={`result-tab ${activeTab === "result" ? "active" : ""}`}
                  onClick={() => setActiveTab("result")}
                >
                  Result
                </div>
                {appHtml && (
                  <div
                    className={`result-tab ${activeTab === "app" ? "active" : ""}`}
                    onClick={() => setActiveTab("app")}
                  >
                    App View
                  </div>
                )}
                <div
                  className={`result-tab ${activeTab === "log" ? "active" : ""}`}
                  onClick={() => setActiveTab("log")}
                >
                  Log ({logs.length})
                </div>
              </div>

              <div className="result-content">
                {activeTab === "result" && (
                  toolResult ? (
                    <pre className="result-json">
                      {JSON.stringify(toolResult, null, 2)}
                    </pre>
                  ) : (
                    <div className="empty-state">Call a tool to see results</div>
                  )
                )}
                {activeTab === "app" && appHtml && (
                  <iframe
                    ref={iframeRef}
                    className="app-frame"
                    srcDoc={appHtml}
                    sandbox="allow-scripts allow-forms"
                    title="MCP App View"
                  />
                )}
                {activeTab === "log" && (
                  <div className="log-panel">
                    {logs.length === 0 && (
                      <div className="empty-state">No log entries</div>
                    )}
                    {logs.map((entry, i) => (
                      <div key={i} className="log-entry">
                        <span className="log-time">
                          {entry.time.toLocaleTimeString()}
                        </span>
                        <span className={`log-dir ${entry.direction}`}>
                          {entry.direction === "send"
                            ? ">>>"
                            : entry.direction === "recv"
                              ? "<<<"
                              : "ERR"}
                        </span>
                        {entry.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">Select a tool from the sidebar</div>
        )}
      </div>

      <div className="status-bar">
        <span>
          <span
            className={`status-dot ${servers.length > 0 ? "connected" : "disconnected"}`}
          />
          {servers.length > 0
            ? `${servers.length} connected`
            : "Not connected"}
        </span>
        {selectedTool && <span>Selected: {selectedTool.tool.name}</span>}
      </div>
    </div>
  );
}
