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
  });
});
