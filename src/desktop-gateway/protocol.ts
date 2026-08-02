import type { GatewayEndpointKind } from "./contracts.js";

export const desktopGatewayProtocolVersion = "1";
export { desktopGatewayControlPrompts } from "./contracts.js";

const endpointPaths: Readonly<Record<GatewayEndpointKind, string>> = {
  status: "/v1/status",
  desktop_heartbeat: "/v1/desktop-heartbeat",
  takeover_desktop: "/v1/takeover-desktop",
  release_bridge: "/v1/release-bridge",
  user_prompt_submit: "/v1/user-prompt-submit",
  stop_wake: "/v1/stop-wake",
};

const pathEndpoints = new Map(
  Object.entries(endpointPaths).map(([endpoint, route]) => [route, endpoint as GatewayEndpointKind]),
);

export function gatewayPathForEndpoint(endpoint: GatewayEndpointKind): string {
  return endpointPaths[endpoint];
}

export function endpointForGatewayPath(route: string): GatewayEndpointKind {
  if (!route.startsWith("/") || route.includes("?") || route.includes("#") ||
      route.includes("%") || route.includes("\\") || route.includes("//") ||
      route.endsWith("/")) {
    throw new Error("Gateway path is not an exact normalized route");
  }
  const endpoint = pathEndpoints.get(route);
  if (!endpoint) throw new Error("Unknown Gateway route");
  return endpoint;
}

export function parseJsonWithoutDuplicateKeys(body: Uint8Array): unknown {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(body);
  let cursor = 0;

  const skipWhitespace = () => {
    while (cursor < source.length && /[\t\n\r ]/u.test(source[cursor]!)) cursor++;
  };

  const parseString = (): string => {
    if (source[cursor] !== '"') throw new SyntaxError("Expected JSON string");
    const start = cursor++;
    while (cursor < source.length) {
      const character = source[cursor++];
      if (character === '"') return JSON.parse(source.slice(start, cursor)) as string;
      if (character === "\\") {
        if (cursor >= source.length) break;
        if (source[cursor] === "u") {
          cursor += 5;
        } else {
          cursor++;
        }
      } else if (character && character.charCodeAt(0) < 0x20) {
        throw new SyntaxError("Invalid control character in JSON string");
      }
    }
    throw new SyntaxError("Unterminated JSON string");
  };

  const parseValue = (): unknown => {
    skipWhitespace();
    const character = source[cursor];
    if (character === '"') return parseString();
    if (character === "{") {
      cursor++;
      const object: Record<string, unknown> = {};
      const keys = new Set<string>();
      skipWhitespace();
      if (source[cursor] === "}") { cursor++; return object; }
      while (cursor < source.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) throw new SyntaxError(`duplicate JSON field: ${key}`);
        keys.add(key);
        skipWhitespace();
        if (source[cursor++] !== ":") throw new SyntaxError("Expected JSON colon");
        object[key] = parseValue();
        skipWhitespace();
        const separator = source[cursor++];
        if (separator === "}") return object;
        if (separator !== ",") throw new SyntaxError("Expected JSON object separator");
      }
      throw new SyntaxError("Unterminated JSON object");
    }
    if (character === "[") {
      cursor++;
      const array: unknown[] = [];
      skipWhitespace();
      if (source[cursor] === "]") { cursor++; return array; }
      while (cursor < source.length) {
        array.push(parseValue());
        skipWhitespace();
        const separator = source[cursor++];
        if (separator === "]") return array;
        if (separator !== ",") throw new SyntaxError("Expected JSON array separator");
      }
      throw new SyntaxError("Unterminated JSON array");
    }
    for (const [literal, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (source.startsWith(literal, cursor)) { cursor += literal.length; return value; }
    }
    const number = source.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    if (number) {
      cursor += number.length;
      const value = Number(number);
      if (!Number.isFinite(value)) throw new SyntaxError("JSON number is not finite");
      return value;
    }
    throw new SyntaxError("Invalid JSON value");
  };

  const value = parseValue();
  skipWhitespace();
  if (cursor !== source.length) throw new SyntaxError("Trailing JSON input");
  return value;
}
