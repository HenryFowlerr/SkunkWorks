import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("Chappe entry page", () => {
  it("explains the engineering-to-prototype handoff and offers public demo entry points", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "Keep engineering intent close to the prototype." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Explore engineering/ })).toHaveAttribute("href", "/studio");
    expect(screen.queryByRole("link", { name: /prototype shop/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /manufacturing/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Explore Steel Bracket/ })).toHaveAttribute("href", "/parts/manufacturing-test-sheet");
    expect(screen.getByText(/Steel Bracket source drawing, STL visual reference, and QR-enabled guide/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review useful guidance" })).toBeInTheDocument();
    expect(screen.getByText(/they do not certify physical manufacturability/i)).toBeInTheDocument();
  });
});
