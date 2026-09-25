import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge, TextInput } from "./index";

describe("shared UI foundations", () => {
  it("associates field labels, help and errors with the control", () => {
    render(<TextInput id="part-number" label="Part number" hint="Use the drawing identifier." error="Required" />);

    const input = screen.getByRole("textbox", { name: "Part number" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Use the drawing identifier. Required");
  });

  it("shows review state in text rather than colour alone", () => {
    render(<StatusBadge label="Needs review" tone="review" />);

    expect(screen.getByText("Needs review")).toBeVisible();
  });
});
