/**
 * Dead Method Detector — CLI wrapper
 *
 * Uses ts-morph to find public class methods and interface methods in src/
 * that have zero call sites across the production codebase.
 *
 * What this catches that knip cannot:
 * - Public methods on classes that are imported/used, but specific methods are never called
 * - Interface methods that are declared but never invoked on any object
 * - Types/interfaces only consumed by those dead methods
 *
 * Limitations:
 * - Cannot detect "effectively dead" code guarded by always-false parameters
 *   (that requires data-flow analysis, not just call-graph analysis)
 * - Dynamic property access (obj[methodName]()) is not traced
 * - Methods called only from test files are flagged (by design)
 *
 * Usage:
 *   node scripts/find-dead-methods.ts
 *   node scripts/find-dead-methods.ts --json
 *   node scripts/find-dead-methods.ts --ci
 *   node scripts/find-dead-methods.ts --show-suppressed
 *   node scripts/find-dead-methods.ts --save-baseline
 *   node scripts/find-dead-methods.ts --baseline
 */

const { analyzeMethods } = require('./dead-methods-analyzer.ts');
const path = require('path');
const fs = require('fs');

// ── CLI flags ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const JSON_OUTPUT = args.includes('--json');
const CI_MODE = args.includes('--ci');
const SHOW_SUPPRESSED = args.includes('--show-suppressed');
const SAVE_BASELINE = args.includes('--save-baseline');
const USE_BASELINE = args.includes('--baseline');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'dead-methods.config.json');
const BASELINE_PATH = path.join(__dirname, 'dead-methods.baseline.json');

// ── Helpers ────────────────────────────────────────────────────────────────

function relPath(filePath) {
  return path.relative(PROJECT_ROOT, filePath);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Config file not found: ${CONFIG_PATH}`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function saveBaseline(findings, deadTypes) {
  const baseline = {
    generatedAt: new Date().toISOString(),
    findings: findings.map((f) => {
      const owner = f.className || f.interfaceName || '';
      return `${owner}.${f.name}`;
    }),
    deadTypes: deadTypes.map((t) => t.name),
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Baseline saved to ${path.relative(PROJECT_ROOT, BASELINE_PATH)} (${baseline.findings.length} findings, ${baseline.deadTypes.length} dead types)`);
}

function filterNewFindings(findings, deadTypes, baseline) {
  if (!baseline) return { newFindings: findings, newDeadTypes: deadTypes };

  const baselineSet = new Set(baseline.findings);
  const baselineTypes = new Set(baseline.deadTypes);

  const newFindings = findings.filter((f) => {
    const owner = f.className || f.interfaceName || '';
    return !baselineSet.has(`${owner}.${f.name}`);
  });

  const newDeadTypes = deadTypes.filter((t) => !baselineTypes.has(t.name));

  return { newFindings, newDeadTypes };
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const config = loadConfig();
  const result = analyzeMethods(config, PROJECT_ROOT);

  const { findings, suppressedFindings, deadTypes, stats } = result;

  // ── Save baseline mode ─────────────────────────────────────────────

  if (SAVE_BASELINE) {
    saveBaseline(findings, deadTypes);
    return;
  }

  // ── Baseline comparison ────────────────────────────────────────────

  let displayFindings = findings;
  let displayDeadTypes = deadTypes;
  let baselineMode = false;

  if (USE_BASELINE) {
    const baseline = loadBaseline();
    if (!baseline) {
      console.error('No baseline file found. Run with --save-baseline first.');
      process.exit(2);
    }
    const { newFindings, newDeadTypes } = filterNewFindings(findings, deadTypes, baseline);
    displayFindings = newFindings;
    displayDeadTypes = newDeadTypes;
    baselineMode = true;
  }

  // ── JSON output ────────────────────────────────────────────────────

  if (JSON_OUTPUT) {
    const output = {
      findings: displayFindings,
      deadTypes: displayDeadTypes,
      suppressedCount: stats.suppressedCount,
      stats,
    };
    if (SHOW_SUPPRESSED) {
      output.suppressedFindings = suppressedFindings;
    }
    if (baselineMode) {
      output.baselineMode = true;
      output.totalFindings = findings.length;
      output.newFindings = displayFindings.length;
    }
    console.log(JSON.stringify(output, null, 2));

    if (CI_MODE && displayFindings.length > 0) {
      process.exit(1);
    }
    return;
  }

  // ── Text report ────────────────────────────────────────────────────

  const zeroCaller = displayFindings.filter((f) => !f.selfCallOnly && f.callerCount === 0);
  const selfOnly = displayFindings.filter((f) => f.selfCallOnly);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Dead Method Analysis — Production Code (src/ only)');
  console.log('═══════════════════════════════════════════════════════════');

  if (baselineMode) {
    console.log(`  (baseline mode — showing only NEW findings)`);
  }

  if (zeroCaller.length > 0) {
    console.log('');
    console.log(`── Zero Production Callers (${zeroCaller.length}) ──`);
    console.log('   These methods are never called from any src/ file.');
    console.log('');

    for (const f of zeroCaller) {
      const loc = relPath(f.filePath);
      const owner = f.className || f.interfaceName;
      const stat = f.isStatic ? ' (static)' : '';
      console.log(`   ${owner}.${f.name}${stat}`);
      console.log(`     └─ ${loc}`);
    }
  }

  if (selfOnly.length > 0) {
    console.log('');
    console.log(`── Self-File Only Callers (${selfOnly.length}) ──`);
    console.log('   Called within same file but never from outside. Review manually.');
    console.log('');

    for (const f of selfOnly) {
      const loc = relPath(f.filePath);
      const owner = f.className || f.interfaceName;
      const stat = f.isStatic ? ' (static)' : '';
      console.log(`   ${owner}.${f.name}${stat}  [${f.callerCount} same-file call(s)]`);
      console.log(`     └─ ${loc}`);
    }
  }

  if (displayDeadTypes.length > 0) {
    console.log('');
    console.log(`── Types Only Used by Dead Methods (${displayDeadTypes.length}) ──`);
    console.log('');

    for (const t of displayDeadTypes) {
      const loc = relPath(t.filePath);
      console.log(`   ${t.name}`);
      console.log(`     └─ ${loc} — ${t.reason}`);
    }
  }

  // ── Suppressed findings (opt-in) ───────────────────────────────────

  if (SHOW_SUPPRESSED && suppressedFindings.length > 0) {
    console.log('');
    console.log(`── Suppressed Findings (${suppressedFindings.length}) ──`);
    console.log('   These are excluded by config rules or auto-detection.');
    console.log('');

    for (const f of suppressedFindings) {
      const loc = relPath(f.filePath);
      const owner = f.className || f.interfaceName;
      const stat = f.isStatic ? ' (static)' : '';
      console.log(`   ${owner}.${f.name}${stat}`);
      console.log(`     └─ ${loc}`);
      console.log(`     └─ [${f.suppressCategory}] ${f.suppressReason}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────

  const total = zeroCaller.length + selfOnly.length + displayDeadTypes.length;
  console.log('');
  console.log(`── Summary: ${zeroCaller.length} dead, ${selfOnly.length} self-only, ${displayDeadTypes.length} dead types (${total} total findings) ──`);
  if (stats.suppressedCount > 0) {
    console.log(`   ${stats.suppressedCount} suppressed (${stats.commandHandlerMethods} command handlers detected)`);
  }
  console.log('');

  // ── CI output ──────────────────────────────────────────────────────

  if (CI_MODE) {
    if (total > 0) {
      const label = baselineMode ? 'new' : 'total';
      console.log(`::error::Dead methods found: ${total} ${label}`);
      process.exit(1);
    } else {
      console.log('::notice::No dead methods found');
    }
  } else if (total > 0) {
    process.exit(1);
  }
}

main();
