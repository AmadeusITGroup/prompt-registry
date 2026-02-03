# Engagement System: Ratings, Voting, and Feedback

The Prompt Registry includes an engagement system that allows users to rate bundles, provide feedback, and (for hub maintainers) collect community votes via GitHub Discussions.

## Quick Start: Providing Feedback

The easiest way to engage with bundles is through the **feedback system**.

### Submitting Feedback

1. **Click the "⭐ Rate & Feedback" button** in the bundle details view, or
2. **Right-click** on any installed bundle in the Registry Explorer and select **Rate & Feedback**

The unified feedback dialog guides you through:
1. **Star Rating (1-5)** — Rate the bundle quality
2. **Optional Comment** — Add a short message about your experience (e.g., "Works great!" or "Needs better documentation")
3. **Action** — Choose what to do next:
   - 📝 Report issue/suggestion — Opens GitHub Issues for detailed feedback
   - ⏭️ Skip — Submit rating and comment only

### Where Does Feedback Go?

- **Hubs with GitHub Discussions**: Feedback is posted as a comment on the bundle's discussion thread, making it visible to the community
- **Other hubs**: Feedback is stored locally and can be aggregated by hub maintainers

---

## Viewing Ratings

If a hub provides ratings data, you'll see ratings displayed:
- **Tree View**: Ratings appear next to bundle versions (e.g., `v1.0.0  ★ 4.2`)
- **Marketplace**: Ratings appear on bundle cards

Ratings are computed from community votes and refreshed automatically.

---

## For Hub Maintainers: Setting Up Community Voting

Hub maintainers can enable community voting using GitHub Discussions. This allows users to vote on bundles using GitHub's reaction system (👍/👎).

### Step 1: Enable GitHub Discussions

1. Go to your hub's GitHub repository
2. Navigate to **Settings** → **Features**
3. Enable **Discussions**

### Step 2: Create Discussions for Collections

For each bundle/collection you want to enable voting on:

1. Create a new Discussion in your repository
2. Note the **discussion number** (visible in the URL, e.g., `/discussions/42`)
3. Optionally, add comments for individual resources within the bundle

### Step 3: Create `collections.yaml`

Create a `collections.yaml` file in your repository that maps bundles to discussions:

```yaml
repository: "your-org/your-hub-repo"
collections:
  - id: "travel-prompts"
    discussion_number: 42
    resources:
      - id: "booking-agent"
        comment_id: 101
      - id: "search-helper"
        comment_id: 102
  - id: "dev-tools"
    discussion_number: 43
```

### Step 4: Set Up the GitHub Action

Download the [compute-ratings.yml](../assets/compute-ratings.yml) workflow file and add it to your hub repository at `.github/workflows/compute-ratings.yml`.

The workflow:
- Runs daily at 2:00 AM UTC (configurable via cron)
- Can be triggered manually with custom config/output paths
- Fetches reactions from GitHub Discussions
- Computes ratings using Wilson score algorithm
- Commits updated `ratings.json` to your repository

> **Note**: This workflow should be added to your **hub repository**, not to the prompt-registry extension repository.

### Step 5: Configure Hub Engagement

Add engagement configuration to your `hub.yaml`:

```yaml
version: "1.0.0"
metadata:
  name: "My Hub"
  description: "A collection of useful prompts"
  maintainer: "maintainer@example.com"
  updatedAt: "2025-01-28"

engagement:
  enabled: true
  backend:
    type: "github-discussions"
    repository: "your-org/your-hub-repo"
  ratings:
    enabled: true
    ratingsUrl: "https://raw.githubusercontent.com/your-org/your-hub-repo/main/ratings.json"

sources:
  # ... your sources
  
profiles:
  # ... your profiles
```

### Step 6: Verify Setup

1. Run the GitHub Action manually (Actions → Compute Ratings → Run workflow)
2. Check that `ratings.json` is generated and committed
3. Import your hub in Prompt Registry
4. Verify ratings appear in the UI

---

## How Ratings Are Computed

Ratings use the **Wilson Score** algorithm, which provides statistically robust rankings even with small sample sizes:

- **Wilson Score**: Lower bound of confidence interval for true positive rate
- **Bayesian Smoothing**: Adjusts for small sample sizes
- **Star Rating**: Converted from Wilson score (1-5 scale)
- **Confidence Level**: Based on total vote count
  - `low`: < 5 votes
  - `medium`: 5-19 votes
  - `high`: 20-99 votes
  - `very_high`: 100+ votes

---

## Privacy

- **Local feedback**: Stored only on your machine in the extension's storage
- **GitHub voting**: Requires GitHub authentication; votes are public reactions
- **Telemetry**: Disabled by default; can be enabled per-hub

---

## Troubleshooting

### Ratings not showing

1. Verify the hub has `engagement.ratings.ratingsUrl` configured
2. Check that the `ratings.json` URL is accessible
3. Try reloading VS Code to refresh the rating cache

### Voting commands failing

The voting commands require:
1. GitHub authentication (you'll be prompted to sign in)
2. A valid discussion number
3. The hub must have GitHub Discussions enabled

If you see "Discussion not found" errors, the discussion may not exist or you may not have access.

### Feedback not persisting

Ensure the extension has write access to its storage directory. Check the Output panel (Prompt Registry) for error messages.

---

## See Also

- [Hub Schema Reference](../reference/hub-schema.md) - Full hub configuration options
- [Commands Reference](../reference/commands.md) - All engagement commands
