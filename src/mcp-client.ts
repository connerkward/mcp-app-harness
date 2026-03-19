import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Tool, Resource } from "@modelcontextprotocol/sdk/types.js";

export interface ServerConnection {
  url: string;
  client: Client;
  tools: ToolInfo[];
  resources: Resource[];
  status: "connecting" | "connected" | "error";
  error?: string;
}

export interface ToolInfo {
  tool: Tool;
  serverUrl: string;
  hasUi: boolean;
  resourceUri?: string;
}

export type LogEntry = {
  time: Date;
  direction: "send" | "recv" | "error";
  message: string;
};

export async function connectToServer(url: string): Promise<ServerConnection> {
  const client = new Client({ name: "mcp-app-harness", version: "0.1.0" });

  // Try StreamableHTTP first, fall back to SSE
  try {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await client.connect(transport);
  } catch {
    try {
      const transport = new SSEClientTransport(new URL(url));
      await client.connect(transport);
    } catch (e) {
      return {
        url,
        client,
        tools: [],
        resources: [],
        status: "error",
        error: String(e),
      };
    }
  }

  // Discover tools and resources
  const [toolsResult, resourcesResult] = await Promise.all([
    client.listTools().catch(() => ({ tools: [] as Tool[] })),
    client.listResources().catch(() => ({ resources: [] as Resource[] })),
  ]);

  const tools: ToolInfo[] = toolsResult.tools.map((tool) => {
    const meta = tool as Record<string, unknown>;
    const uiMeta = (meta._meta as Record<string, unknown>)?.ui as
      | Record<string, unknown>
      | undefined;
    const resourceUri = uiMeta?.resourceUri as string | undefined;
    return {
      tool,
      serverUrl: url,
      hasUi: !!resourceUri,
      resourceUri,
    };
  });

  return {
    url,
    client,
    tools,
    resources: resourcesResult.resources,
    status: "connected",
  };
}

export async function callTool(
  conn: ServerConnection,
  toolName: string,
  args: Record<string, unknown>,
) {
  return conn.client.callTool({ name: toolName, arguments: args });
}

export async function readResource(conn: ServerConnection, uri: string) {
  return conn.client.readResource({ uri });
}
