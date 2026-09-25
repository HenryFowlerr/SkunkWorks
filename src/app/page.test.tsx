import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("SkunkWorks entry page", () => {
  it("explains bend continuity and offers the designer sign-in path", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "Keep every bend in view." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: /open designer desk/i })).toHaveAttribute("href", "/studio");
    expect(screen.getByRole("heading", { name: "Explore the authored sample packets" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rev A · Drawing PDF" }).closest("article")).toHaveTextContent("SKW-SM-104 · Rev A");
    expect(screen.getByRole("link", { name: "Rev A · Bend manifest" })).toHaveAttribute("href", "/demo/sensor-mount-alpha.bend.json");
    expect(screen.getByRole("link", { name: "Rev A · Final GLB model" })).toHaveAttribute("href", "/demo/sensor-mount-alpha.final.glb");
    expect(screen.getByText(/downloading them does not create a job or claim a live AI run/i)).toBeInTheDocument();
  });
});
