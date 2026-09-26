import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("Chappe entry page", () => {
  it("explains the reviewed handoff and offers account entry points", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "Make complex work clear before it reaches the floor." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("heading", { name: "Guide the difficult work" })).toBeInTheDocument();
    expect(screen.getByText(/engineers check the interpretation, correct the steps and approve the guide/i)).toBeInTheDocument();
    expect(screen.getByText(/they do not certify physical manufacturability/i)).toBeInTheDocument();
  });
});
