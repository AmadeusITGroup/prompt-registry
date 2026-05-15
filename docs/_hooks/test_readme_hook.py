"""Tests for the MkDocs readme_hook link-rewriting logic."""

import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from readme_hook import on_page_read_source, on_page_markdown

# ---------------------------------------------------------------------------
# Fixtures: fake project tree
# ---------------------------------------------------------------------------

@pytest.fixture()
def project(tmp_path):
    """Create a minimal project tree that mirrors the real layout."""
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "index.md").write_text("stub")
    (docs / "README.md").write_text("# Docs README")

    author = docs / "author-guide"
    author.mkdir()
    (author / "guide.md").write_text("guide")

    contrib = docs / "contributor-guide"
    contrib.mkdir()
    (contrib / "testing.md").write_text("testing")

    # Root-level files that live outside docs/
    (tmp_path / "CONTRIBUTING.md").write_text("contrib")
    (tmp_path / "LICENSE.txt").write_text("license")
    (tmp_path / "README.md").write_text(
        "# Prompt Registry\n"
        "\n"
        "![screenshot](./docs/assets/screenshot.png)\n"
        "\n"
        "→ [Full Documentation Index](./docs/README.md)\n"
        "\n"
        "See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.\n"
        "\n"
        "[Apache 2.0](./LICENSE.txt)\n"
    )

    # Fake mkdocs.yml path (config_file_path points to it)
    config_file = tmp_path / "mkdocs.yml"
    config_file.write_text("")

    return SimpleNamespace(
        root=tmp_path,
        docs=docs,
        config={
            "config_file_path": str(config_file),
            "docs_dir": str(docs),
        },
    )


def _make_page(src_path):
    """Create a minimal page object with file.src_path."""
    return SimpleNamespace(file=SimpleNamespace(src_path=src_path))


# ---------------------------------------------------------------------------
# on_page_read_source tests
# ---------------------------------------------------------------------------

class TestOnPageReadSource:
    def test_returns_none_for_non_index(self, project):
        page = _make_page("guide.md")
        assert on_page_read_source(page, project.config) is None

    def test_injects_readme_content(self, project):
        page = _make_page("index.md")
        result = on_page_read_source(page, project.config)
        assert result is not None
        assert "# Prompt Registry" in result

    def test_rewrites_docs_image_paths(self, project):
        page = _make_page("index.md")
        result = on_page_read_source(page, project.config)
        # ./docs/assets/screenshot.png  →  assets/screenshot.png
        assert "](assets/screenshot.png)" in result
        assert "](./docs/" not in result

    def test_converts_root_relative_links(self, project):
        page = _make_page("index.md")
        result = on_page_read_source(page, project.config)
        # ./CONTRIBUTING.md  →  ../CONTRIBUTING.md  (escapes docs/)
        assert "](../CONTRIBUTING.md)" in result
        assert "](./CONTRIBUTING.md)" not in result


# ---------------------------------------------------------------------------
# on_page_markdown tests
# ---------------------------------------------------------------------------

class TestOnPageMarkdown:
    def test_preserves_internal_docs_links(self, project):
        md = "[Getting Started](../user-guide/getting-started.md)"
        page = _make_page("contributor-guide/testing.md")
        # Create the target so it resolves inside docs/
        ug = project.docs / "user-guide"
        ug.mkdir(exist_ok=True)
        (ug / "getting-started.md").write_text("")

        result = on_page_markdown(md, page, project.config, files=None)
        assert result == md  # unchanged

    def test_rewrites_link_outside_docs(self, project):
        md = "[CONTRIBUTING](../../CONTRIBUTING.md)"
        page = _make_page("contributor-guide/testing.md")
        result = on_page_markdown(md, page, project.config, files=None)
        expected = (
            "[CONTRIBUTING](https://github.com/AmadeusITGroup/"
            "prompt-registry/blob/main/CONTRIBUTING.md)"
        )
        assert result == expected

    def test_rewrites_link_outside_docs_with_anchor(self, project):
        md = "[Contributing](../../CONTRIBUTING.md#how-to)"
        page = _make_page("contributor-guide/testing.md")
        result = on_page_markdown(md, page, project.config, files=None)
        assert result.endswith("CONTRIBUTING.md#how-to)")

    def test_remaps_excluded_readme_to_index(self, project):
        md = "[Docs](../README.md)"
        page = _make_page("author-guide/guide.md")
        result = on_page_markdown(md, page, project.config, files=None)
        assert "index.md" in result
        assert "README.md" not in result

    def test_preserves_absolute_urls(self, project):
        md = "[GitHub](https://github.com)"
        page = _make_page("index.md")
        result = on_page_markdown(md, page, project.config, files=None)
        assert result == md

    def test_preserves_anchor_only_links(self, project):
        md = "[section](#overview)"
        page = _make_page("index.md")
        result = on_page_markdown(md, page, project.config, files=None)
        assert result == md

    def test_preserves_mailto_links(self, project):
        md = "[email](mailto:test@example.com)"
        page = _make_page("index.md")
        result = on_page_markdown(md, page, project.config, files=None)
        assert result == md

    def test_multiple_links_in_one_line(self, project):
        md = (
            "[CONTRIBUTING](../../CONTRIBUTING.md) and "
            "[LICENSE](../../LICENSE.txt)"
        )
        page = _make_page("contributor-guide/testing.md")
        result = on_page_markdown(md, page, project.config, files=None)
        assert "prompt-registry/blob/main/CONTRIBUTING.md" in result
        assert "prompt-registry/blob/main/LICENSE.txt" in result
