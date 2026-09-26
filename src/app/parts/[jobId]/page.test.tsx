import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PartPage from "./page";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("@/components/prepared-part-phone", () => ({
  PreparedPartPhone: ({ part }: { part: { drawingId: string; revision: string } }) => <div data-testid="prepared-part">{part.drawingId} / {part.revision}</div>,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("public part QR view", () => {
  it("resolves a supplied source packet without auth or external services", async () => {
    render(await PartPage({ params: Promise.resolve({ jobId: "manufacturing-test-sheet" }) }));
    expect(screen.getByTestId("prepared-part")).toHaveTextContent("Steel Bracket / Needs review");
  });

  it("does not resolve an unknown part into private data", async () => {
    await expect(PartPage({ params: Promise.resolve({ jobId: "unknown-part" }) })).rejects.toThrow("not found");
  });
});
