import { expect, test } from "@playwright/test";

test("entry page explains the reviewed handoff and links to account entry", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Chappe · Engineering to workshop");
  await expect(page.getByRole("heading", { name: "Make complex work clear before it reaches the floor." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "Create account", exact: true })).toHaveAttribute("href", "/signup");
  await expect(page.getByRole("heading", { name: "Guide the difficult work" })).toBeVisible();
});

test("legacy demo links stay inside the server-hosted application", async ({ page }) => {
  await page.goto("/demo");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Make complex work clear before it reaches the floor." })).toBeVisible();
});

test("entry page fits its desktop and phone viewport", async ({ page }) => {
  await page.goto("/");

  const viewportWidth = page.viewportSize()?.width;
  expect(viewportWidth).toBeTruthy();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth! + 1);
  await expect(page.getByRole("heading", { name: "Make complex work clear before it reaches the floor." })).toBeInViewport();
});

test("sign-in and account creation remain usable on desktop and phone", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();

  const viewportWidth = page.viewportSize()?.width;
  expect(viewportWidth).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth! + 1);

  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByLabel("Name")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth! + 1);
});
