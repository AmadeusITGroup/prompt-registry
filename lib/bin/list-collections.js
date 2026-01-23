#!/usr/bin/env node
const { listCollectionFiles, readCollection } = require('../dist');

const repoRoot = process.cwd();
const files = listCollectionFiles(repoRoot);

const collections = files.map((file) => {
  const collection = readCollection(repoRoot, file);
  return {
    id: collection.id,
    name: collection.name,
    file,
  };
});

process.stdout.write(JSON.stringify(collections, null, 2) + '\n');
