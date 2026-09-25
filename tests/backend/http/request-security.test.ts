import { describe, expect, it } from "vitest";
import {
  assertJsonRequest,
  assertSameOrigin,
  RequestSecurityError,
} from "../../../src/server/http/request-security";

function post(headers: HeadersInit = {}) {
  return new Request("https://skunkworks.example/api/jobs", {
    method: "POST",
    headers,
  });
}

describe("API request security", () => {
  it("accepts the exact same origin", () => {
    expect(() =>
      assertSameOrigin(
        post({
          origin: "https://skunkworks.example",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    ["missing origin", {}],
    ["opaque origin", { origin: "null" }],
    ["other host", { origin: "https://attacker.example" }],
    ["same host with another port", { origin: "https://skunkworks.example:8443" }],
    ["cross-site fetch metadata", { origin: "https://skunkworks.example", "sec-fetch-site": "cross-site" }],
  ])("rejects %s", (_case, headers) => {
    expect(() => assertSameOrigin(post(headers))).toThrow(RequestSecurityError);
  });

  it("requires JSON request bodies", () => {
    expect(() => assertJsonRequest(post({ "content-type": "application/json; charset=utf-8" }))).not.toThrow();
    expect(() => assertJsonRequest(post({ "content-type": "text/plain" }))).toThrow(RequestSecurityError);
  });
});
