#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const semver = require('semver');

const { readCollection } = require('../dist');

function parseArgs(argv) {
  const out = { collectionFile: undefined, json: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--collection-file' && argv[i + 1]) {
      out.collectionFile = argv[i + 1];
      i++;
    }
  }
  return out;
}

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    const msg = (res.stderr || res.stdout || `git ${args.join(' ')}`).trim();
    throw new Error(msg);
  }
  return (res.stdout || '').trim();
}

function listTagsForCollection(repoRoot, collectionId) {
  const raw = git(['tag', '--list', `${collectionId}-v*`], repoRoot);
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getLatestVersion(repoRoot, collectionId) {
  const tags = listTagsForCollection(repoRoot, collectionId);
  const versions = tags
    .map((t) => t.replace(new RegExp(`^${collectionId}-v`), ''))
    .filter((v) => semver.valid(v));

  if (versions.length === 0) return null;
  versions.sort(semver.rcompare);
  return versions[0];
}

function getAllTags(repoRoot) {
  try {
    const raw = git(['tag', '--list'], repoRoot);
    if (!raw) return new Set();
    return new Set(
      raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

function computeNextVersion({ repoRoot, collectionFile }) {
  // Cache all tags once to avoid repeated git calls in the bump loop.
  const allTags = getAllTags(repoRoot);
  const tagExistsInCache = (t) => allTags.has(t);
  const collection = readCollection(repoRoot, collectionFile);
  const collectionId = collection.id;

  if (!collectionId || typeof collectionId !== 'string') {
    throw new Error('collection.id is required');
  }

  // Default to "1.0.0" if version field is missing
  const DEFAULT_VERSION = '1.0.0';
  let manualVersion = DEFAULT_VERSION;

  if (collection.version && typeof collection.version === 'string') {
    if (!semver.valid(collection.version)) {
      throw new Error(`collection.version must be a valid semver string (got: ${collection.version})`);
    }
    manualVersion = collection.version;
  }
  const lastVersion = getLatestVersion(repoRoot, collectionId);

  let nextVersion;
  if (!lastVersion) {
    nextVersion = manualVersion;
  } else if (semver.gt(manualVersion, lastVersion)) {
    nextVersion = manualVersion;
  } else {
    nextVersion = semver.inc(lastVersion, 'patch');
  }

  let tag = `${collectionId}-v${nextVersion}`;

  if (lastVersion && semver.gt(manualVersion, lastVersion)) {
    // manual override: require the tag to be new
    if (tagExistsInCache(tag)) {
      throw new Error(`Tag already exists for manual version: ${tag}`);
    }
  } else {
    // auto-patch mode: bump until free (handles re-runs or unusual tag sets)
    while (tagExistsInCache(tag)) {
      nextVersion = semver.inc(nextVersion, 'patch');
      tag = `${collectionId}-v${nextVersion}`;
    }
  }

  return {
    collectionId,
    collectionFile: collectionFile.replace(/\\/g, '/'),
    lastVersion,
    manualVersion,
    nextVersion,
    tag,
  };
}

try {
  const repoRoot = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  if (!args.collectionFile) {
    console.error('❌ Missing --collection-file');
    process.exit(1);
  }

  const result = computeNextVersion({ repoRoot, collectionFile: args.collectionFile });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
