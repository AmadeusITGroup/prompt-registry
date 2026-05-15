"""MkDocs hook: injects root README into the home page and converts
relative links that escape docs/ into absolute GitHub URLs.

This avoids duplicating the project README and keeps source links
IDE-friendly (relative) while producing correct URLs on the built site.
"""

import os
import re
from pathlib import Path, PurePosixPath

REPO_URL = "https://github.com/AmadeusITGroup/prompt-registry/blob/main"


def on_page_read_source(page, config):
    """Inject root README.md as the docs home page."""
    if page.file.src_path != "index.md":
        return None

    readme = Path(config["config_file_path"]).parent / "README.md"
    content = readme.read_text(encoding="utf-8")

    # Fix image/link paths: ./docs/X  →  X  (now relative to docs/)
    content = content.replace("](./docs/", "](")

    # Root-relative links: both ./X and bare X (without ./ prefix) must
    # escape docs/ so on_page_markdown can detect and convert them.
    content = content.replace("](./", "](../")

    return content


def on_page_markdown(markdown, page, config, files):
    """Convert relative links that point outside docs/ to absolute GitHub URLs."""
    docs_dir = Path(config["docs_dir"]).resolve()
    repo_root = Path(config["config_file_path"]).parent.resolve()
    page_dir = (Path(config["docs_dir"]) / page.file.src_path).parent.resolve()

    # Files excluded from the MkDocs build that need link rewriting.
    # docs/README.md is excluded because MkDocs treats README.md as index.md,
    # which would conflict with our actual index.md (populated by the hook).
    excluded_files = {"README.md"}

    def _replace(match):
        text, url = match.group(1), match.group(2)

        if url.startswith(("http://", "https://", "#", "mailto:")):
            return match.group(0)

        path_part, _, anchor = url.partition("#")
        if not path_part:
            return match.group(0)

        resolved = (page_dir / path_part).resolve()

        # Links inside docs/ — check if target is an excluded file
        try:
            rel_to_docs = resolved.relative_to(docs_dir)
            if str(PurePosixPath(rel_to_docs)) in excluded_files:
                # Compute relative path from the current page to docs/index.md
                rel_index = PurePosixPath(os.path.relpath(
                    docs_dir / "index.md", page_dir
                ))
                suffix = f"#{anchor}" if anchor else ""
                return f"[{text}]({rel_index}{suffix})"
            return match.group(0)
        except ValueError:
            pass

        # Outside docs/ — rewrite to absolute GitHub URL
        try:
            rel = PurePosixPath(resolved.relative_to(repo_root))
            suffix = f"#{anchor}" if anchor else ""
            return f"[{text}]({REPO_URL}/{rel}{suffix})"
        except ValueError:
            return match.group(0)

    return re.sub(r"\[([^\]]*)\]\(([^)]+)\)", _replace, markdown)
