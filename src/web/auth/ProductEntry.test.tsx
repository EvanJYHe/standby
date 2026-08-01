// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductSession } from "./session.js";
import { ProductEntry } from "./ProductEntry.js";

class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length() { return this.entries.size; }
  clear() { this.entries.clear(); }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
  removeItem(key: string) { this.entries.delete(key); }
  setItem(key: string, value: string) { this.entries.set(key, value); }
}

vi.mock("../App.js", () => ({
  DashboardApp: ({
    session,
    onSignOut,
  }: {
    session: ProductSession;
    onSignOut: () => void;
  }) => (
    <main>
      <h1>Standby workspace</h1>
      <p>{session.kind === "demo" ? "Demo session" : `${session.name} · ${session.email}`}</p>
      <button onClick={onSignOut} type="button">Leave workspace</button>
    </main>
  ),
}));

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
});

afterEach(() => {
  cleanup();
});

describe("ProductEntry", () => {
  it("keeps the dashboard unmounted until a visitor chooses an access path", () => {
    render(<ProductEntry />);

    expect(screen.getByRole("heading", { name: "Welcome to Standby." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Standby workspace" })).not.toBeInTheDocument();
  });

  it("explains the sample data before opening a tab-scoped demo", async () => {
    const user = userEvent.setup();
    render(<ProductEntry />);

    await user.click(screen.getByRole("button", { name: /Just looking/i }));
    expect(screen.getByText(/seeded Toronto barbershop/i)).toBeInTheDocument();
    expect(screen.getByText(/does not place real calls/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enter demo workspace" }));
    expect(await screen.findByRole("heading", { name: "Standby workspace" })).toBeInTheDocument();
    expect(screen.getByText("Demo session")).toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(1);
    expect(window.localStorage.length).toBe(0);
  });

  it("creates and restores a browser-local profile, then clears it on sign out", async () => {
    const user = userEvent.setup();
    const first = render(<ProductEntry />);

    await user.type(screen.getByLabelText("Your name"), "Evan He");
    await user.type(screen.getByLabelText("Email address"), "evan@example.com");
    await user.click(screen.getByRole("button", { name: "Create local profile" }));

    expect(await screen.findByText("Evan He · evan@example.com")).toBeInTheDocument();
    expect(window.localStorage.length).toBe(1);
    expect(window.sessionStorage.length).toBe(0);

    first.unmount();
    render(<ProductEntry />);
    expect(await screen.findByText("Evan He · evan@example.com")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Leave workspace" }));
    expect(screen.getByRole("heading", { name: "Welcome to Standby." })).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
  });
});
