import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "./auth-form";

const { authApi, navigation } = vi.hoisted(() => ({
  authApi: {
    signIn: vi.fn(),
    signUp: vi.fn(),
  },
  navigation: {
    replace: vi.fn(),
  },
}));

vi.mock("@/lib/api/client", () => ({
  api: { auth: authApi },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

function setInput(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("AuthForm", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    authApi.signIn.mockReset();
    authApi.signUp.mockReset();
    navigation.replace.mockReset();
  });

  it("submits credentials through the typed sign-in API and uses a same-origin return path", async () => {
    authApi.signIn.mockResolvedValue({ actor: { id: "actor" }, memberships: [] });
    window.history.replaceState({}, "", "/login?returnTo=%2Fstudio%2Fjobs%3Ftab%3Dopen");
    render(<AuthForm mode="signIn" />);

    setInput("Email address", "  designer@example.com  ");
    setInput("Password", "correct horse battery staple");
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }).closest("form")!);

    await waitFor(() => expect(authApi.signIn).toHaveBeenCalledWith({
      email: "designer@example.com",
      password: "correct horse battery staple",
    }));
    expect(navigation.replace).toHaveBeenCalledWith("/studio/jobs?tab=open");
  });

  it("rejects an external return path and displays actual service errors", async () => {
    authApi.signIn.mockRejectedValue(new Error("The account service is unavailable."));
    window.history.replaceState({}, "", "/login?returnTo=https%3A%2F%2Fevil.example%2F");
    render(<AuthForm mode="signIn" />);

    setInput("Email address", "designer@example.com");
    setInput("Password", "password");
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }).closest("form")!);

    expect((await screen.findByRole("alert")).textContent).toContain("The account service is unavailable.");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("preserves a same-origin invite token route after sign-in", async () => {
    authApi.signIn.mockResolvedValue({ actor: { id: "actor" }, memberships: [] });
    window.history.replaceState({}, "", "/login?returnTo=%2Finvite%2Ftoken_7-a");
    render(<AuthForm mode="signIn" />);

    setInput("Email address", "designer@example.com");
    setInput("Password", "password");
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }).closest("form")!);

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/invite/token_7-a"));
  });

  it("shows the API's verification state after sign-up without claiming a verified session", async () => {
    authApi.signUp.mockResolvedValue({ verificationRequired: true });
    render(<AuthForm mode="signUp" />);

    setInput("Name", "Rae Designer");
    setInput("Email address", "rae@example.com");
    setInput("Password", "long-enough-password");
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }).closest("form")!);

    expect((await screen.findByRole("status")).textContent).toContain("Check your email for the verification link");
    expect(authApi.signUp).toHaveBeenCalledWith({
      email: "rae@example.com",
      password: "long-enough-password",
      displayName: "Rae Designer",
    });
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
