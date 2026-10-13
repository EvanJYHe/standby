// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LandingPage } from "./LandingPage.js";

function mockMedia(reducedMotion: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LandingPage", () => {
  it("has one headline and downloads the Mac app from every download button", () => {
    mockMedia(false);
    render(<LandingPage />);

    const headlines = screen.getAllByRole("heading", { level: 1 });
    expect(headlines).toHaveLength(1);
    expect(headlines[0]).toHaveTextContent("Empty time, filled automatically.");

    const downloads = screen.getAllByRole("link", { name: /^Download/ });
    expect(downloads.map((link) => link.textContent)).toEqual(["Download", "Download for Mac", "Download for Mac"]);
    for (const link of downloads) {
      expect(link).toHaveAttribute("href", "/downloads/Standby.dmg");
      expect(link).toHaveAttribute("download");
    }
  });

  it("no longer links to the web demo", () => {
    mockMedia(false);
    render(<LandingPage />);

    expect(screen.queryByText(/demo/i)).toBeNull();
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).not.toMatch(/^\/app/);
  });

  it("shows the real app under its menu-bar icon once the hero has painted", async () => {
    mockMedia(false);
    render(<LandingPage />);

    expect(screen.getByRole("heading", { level: 2, name: /Lives in your menu\sbar/ })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: /Sarah said yes/ })).toHaveAttribute(
      "src",
      "/landing/v2/app/popover-openings.webp",
    );
  });

  it("plays the film muted, looped and inline", () => {
    mockMedia(false);
    const { container } = render(<LandingPage />);

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.autoplay).toBe(true);
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the poster and every section at once when motion is reduced", () => {
    mockMedia(true);
    const { container } = render(<LandingPage />);

    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector('img[src="/landing/v2/standby-film-poster.jpg"]')).not.toBeNull();
    for (const item of container.querySelectorAll(".sb-reveal")) expect(item).toHaveClass("is-visible");
  });
});
