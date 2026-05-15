import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "Prompt Registry",
  tagline: "Marketplace and registry for Copilot prompt bundles in VS Code",
  favicon: "img/favicon.ico",

  url: "https://amadeustitgroup.github.io",
  baseUrl: "/prompt-registry/",

  organizationName: "AmadeusITGroup",
  projectName: "prompt-registry",

  onBrokenLinks: "throw",

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  themes: [
    [
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: true,
        docsRouteBasePath: "/",
        indexBlog: false,
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          path: "../docs",
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          exclude: ["AGENTS.md", "CLAUDE.md", "README.md", "_hooks/**"],
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: "Prompt Registry",
      items: [
        {
          type: "docSidebar",
          sidebarId: "userGuide",
          position: "left",
          label: "User Guide",
        },
        {
          type: "docSidebar",
          sidebarId: "authorGuide",
          position: "left",
          label: "Author Guide",
        },
        {
          type: "docSidebar",
          sidebarId: "contributorGuide",
          position: "left",
          label: "Contributor Guide",
        },
        {
          type: "docSidebar",
          sidebarId: "reference",
          position: "left",
          label: "Reference",
        },
        {
          type: "doc",
          docId: "migration-guide",
          position: "left",
          label: "Migration Guide",
        },
        {
          href: "https://github.com/AmadeusITGroup/prompt-registry",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "User Guide", to: "/user-guide/getting-started" },
            { label: "Author Guide", to: "/author-guide/creating-source-bundle" },
            { label: "Contributor Guide", to: "/contributor-guide/development-setup" },
            { label: "Migration Guide", to: "/migration-guide" },
          ],
        },
        {
          title: "Community",
          items: [
            {
              label: "GitHub Discussions",
              href: "https://github.com/AmadeusITGroup/prompt-registry/discussions",
            },
            {
              label: "Issues",
              href: "https://github.com/AmadeusITGroup/prompt-registry/issues",
            },
          ],
        },
        {
          title: "More",
          items: [
            {
              label: "VS Code Marketplace",
              href: "https://marketplace.visualstudio.com/items?itemName=AmadeusITGroup.prompt-registry",
            },
            {
              label: "GitHub",
              href: "https://github.com/AmadeusITGroup/prompt-registry",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Amadeus IT Group. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "yaml"],
    },
    colorMode: {
      defaultMode: "light",
      respectPrefersColorScheme: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
