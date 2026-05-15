import { describe, it, expect } from "vitest";
import { resolveLink, stripMarkdownExtension, toRepoUrl } from "../resolveLink";

const BASE_URL = "/prompt-registry/";
const CURRENT_PATH = "/prompt-registry/user-guide/getting-started";

describe("resolveLink", () => {
  describe("passthrough links", () => {
    it("returns passthrough for undefined href", () => {
      expect(resolveLink(undefined, CURRENT_PATH, BASE_URL)).toEqual({
        type: "passthrough",
      });
    });

    it("returns passthrough for http links", () => {
      expect(resolveLink("https://example.com", CURRENT_PATH, BASE_URL)).toEqual({
        type: "passthrough",
      });
    });

    it("returns passthrough for mailto links", () => {
      expect(resolveLink("mailto:test@example.com", CURRENT_PATH, BASE_URL)).toEqual({
        type: "passthrough",
      });
    });

    it("returns passthrough for hash-only links", () => {
      expect(resolveLink("#section", CURRENT_PATH, BASE_URL)).toEqual({
        type: "passthrough",
      });
    });

    it("returns passthrough for unknown relative paths", () => {
      expect(resolveLink("./some-image.png", "/prompt-registry/", BASE_URL)).toEqual({
        type: "passthrough",
      });
    });
  });

  describe("home-page routing", () => {
    it("routes README.md to home", () => {
      const result = resolveLink("../README.md", "/prompt-registry/user-guide/getting-started", BASE_URL);
      expect(result).toEqual({ type: "internal", to: "/prompt-registry/" });
    });

    it("routes docs/README.md to home", () => {
      const result = resolveLink("docs/README.md", "/prompt-registry/", BASE_URL);
      expect(result).toEqual({ type: "internal", to: "/prompt-registry/" });
    });

    it("preserves hash when routing to home", () => {
      const result = resolveLink("../README.md#quick-start", "/prompt-registry/user-guide/getting-started", BASE_URL);
      expect(result).toEqual({ type: "internal", to: "/prompt-registry/#quick-start" });
    });
  });

  describe("docs/ prefix routing", () => {
    it("strips docs/ prefix and routes internally", () => {
      const result = resolveLink("docs/user-guide/marketplace.md", "/prompt-registry/", BASE_URL);
      expect(result).toEqual({ type: "internal", to: "/prompt-registry/user-guide/marketplace" });
    });

    it("strips .md extension from docs/ links", () => {
      const result = resolveLink("docs/reference/commands.md", "/prompt-registry/", BASE_URL);
      expect(result).toEqual({ type: "internal", to: "/prompt-registry/reference/commands" });
    });

    it("preserves hash on docs/ links", () => {
      const result = resolveLink("docs/user-guide/sources.md#github", "/prompt-registry/", BASE_URL);
      expect(result).toEqual({ type: "internal", to: "/prompt-registry/user-guide/sources#github" });
    });
  });

  describe("docs section routing", () => {
    it("routes user-guide/ links internally", () => {
      const result = resolveLink("../user-guide/getting-started.md", "/prompt-registry/reference/commands", BASE_URL);
      expect(result).toEqual({ type: "internal", to: "/prompt-registry/user-guide/getting-started" });
    });

    it("routes author-guide/ links internally", () => {
      const result = resolveLink("../author-guide/creating-source-bundle.md", "/prompt-registry/user-guide/sources", BASE_URL);
      expect(result).toEqual({ type: "internal", to: "/prompt-registry/author-guide/creating-source-bundle" });
    });

    it("routes contributor-guide/ links internally", () => {
      const result = resolveLink("contributor-guide/development-setup.md", "/prompt-registry/", BASE_URL);
      expect(result).toEqual({ type: "internal", to: "/prompt-registry/contributor-guide/development-setup" });
    });

    it("routes reference/ links internally", () => {
      const result = resolveLink("../reference/hub-schema.md", "/prompt-registry/author-guide/collection-schema", BASE_URL);
      expect(result).toEqual({ type: "internal", to: "/prompt-registry/reference/hub-schema" });
    });

    it("routes migration-guide.md internally", () => {
      const result = resolveLink("migration-guide.md", "/prompt-registry/", BASE_URL);
      expect(result).toEqual({ type: "internal", to: "/prompt-registry/migration-guide" });
    });

    it("handles deep nested docs links", () => {
      const result = resolveLink("../contributor-guide/architecture/adapters.md", "/prompt-registry/author-guide/creating-source-bundle", BASE_URL);
      expect(result).toEqual({ type: "internal", to: "/prompt-registry/contributor-guide/architecture/adapters" });
    });
  });

  describe("GitHub blob fallback", () => {
    it("routes non-doc .md files to GitHub", () => {
      const result = resolveLink("CONTRIBUTING.md", "/prompt-registry/", BASE_URL);
      expect(result).toEqual({
        type: "external",
        href: "https://github.com/AmadeusITGroup/prompt-registry/blob/main/CONTRIBUTING.md",
      });
    });

    it("routes .json files to GitHub", () => {
      const result = resolveLink("package.json", "/prompt-registry/", BASE_URL);
      expect(result).toEqual({
        type: "external",
        href: "https://github.com/AmadeusITGroup/prompt-registry/blob/main/package.json",
      });
    });

    it("routes .yml files to GitHub", () => {
      const result = resolveLink("schemas/collection.schema.json", "/prompt-registry/", BASE_URL);
      expect(result).toEqual({
        type: "external",
        href: "https://github.com/AmadeusITGroup/prompt-registry/blob/main/schemas/collection.schema.json",
      });
    });

    it("routes .yaml files to GitHub", () => {
      const result = resolveLink("config.yaml", "/prompt-registry/", BASE_URL);
      expect(result).toEqual({
        type: "external",
        href: "https://github.com/AmadeusITGroup/prompt-registry/blob/main/config.yaml",
      });
    });

    it("preserves hash on GitHub links", () => {
      const result = resolveLink("CONTRIBUTING.md#setup", "/prompt-registry/", BASE_URL);
      expect(result).toEqual({
        type: "external",
        href: "https://github.com/AmadeusITGroup/prompt-registry/blob/main/CONTRIBUTING.md#setup",
      });
    });
  });
});

describe("stripMarkdownExtension", () => {
  it("strips .md extension", () => {
    expect(stripMarkdownExtension("user-guide/getting-started.md")).toBe("user-guide/getting-started");
  });

  it("strips .mdx extension", () => {
    expect(stripMarkdownExtension("page.mdx")).toBe("page");
  });

  it("is case-insensitive", () => {
    expect(stripMarkdownExtension("FILE.MD")).toBe("FILE");
  });

  it("leaves non-markdown paths unchanged", () => {
    expect(stripMarkdownExtension("image.png")).toBe("image.png");
  });
});

describe("toRepoUrl", () => {
  it("creates a GitHub blob URL", () => {
    expect(toRepoUrl("CONTRIBUTING.md")).toBe(
      "https://github.com/AmadeusITGroup/prompt-registry/blob/main/CONTRIBUTING.md",
    );
  });
});
