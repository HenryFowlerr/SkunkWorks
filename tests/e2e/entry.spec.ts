import { expect, test } from "@playwright/test";

test("entry page explains the bend handoff and links to the designer desk", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("SkunkWorks · Prototype handoff");
  await expect(page.getByRole("heading", { name: "Keep every bend in view." })).toBeVisible();
  await expect(page.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: /open designer desk/i })).toHaveAttribute("href", "/studio");
  await expect(page.getByText("B4 · clarification linked")).toBeVisible();
});

test("entry page fits its desktop and phone viewport", async ({ page }) => {
  await page.goto("/");

  const viewportWidth = page.viewportSize()?.width;
  expect(viewportWidth).toBeTruthy();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth! + 1);
  await expect(page.getByRole("heading", { name: "Keep every bend in view." })).toBeInViewport();
});
