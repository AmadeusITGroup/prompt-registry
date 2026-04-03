/**
 * Dead Method Analyzer — Core analysis logic (pure function, no I/O).
 *
 * Extracted from find-dead-methods.ts for testability and reuse.
 * Exports `analyzeMethods(config, projectPath)` which returns typed findings.
 */

const { Project, SyntaxKind, ts } = require('ts-morph');
const path = require('path');
const { minimatch } = require('minimatch');

// ── Types (JSDoc) ──────────────────────────────────────────────────────────

/**
 * @typedef {{ name: string, className?: string, interfaceName?: string, filePath: string, kind: string, isStatic?: boolean, callerCount: number, selfCallOnly: boolean, suppressed?: boolean, suppressReason?: string, suppressCategory?: string }} Finding
 * @typedef {{ name: string, filePath: string, kind: string, reason: string }} DeadType
 * @typedef {{ pattern: string, reason: string, category: string }} SuppressionRule
 * @typedef {{ frameworkMethods: string[], suppressions: SuppressionRule[], ignorePatterns: string[] }} AnalysisConfig
 * @typedef {{ findings: Finding[], suppressedFindings: Finding[], deadTypes: DeadType[], stats: { totalMethods: number, totalInterfaces: number, commandHandlerMethods: number, suppressedCount: number, deadCount: number, selfOnlyCount: number, deadTypeCount: number } }} AnalysisResult
 */

// ── Helpers ────────────────────────────────────────────────────────────────

function relPath(filePath, projectRoot) {
  return path.relative(projectRoot, filePath);
}

function isSrcFile(filePath, projectRoot) {
  const rel = relPath(filePath, projectRoot);
  return rel.startsWith('src/') || rel.startsWith('src\\');
}

/**
 * Check if a "ClassName.methodName" string matches a glob pattern.
 * Supports patterns like "*.methodName", "ClassName.*", "ClassName.methodName".
 */
function matchesGlob(qualifiedName, pattern) {
  return minimatch(qualifiedName, pattern, { dot: true });
}

/**
 * Check if a finding should be suppressed by any rule.
 * @param {{ name: string, className?: string, interfaceName?: string }} finding
 * @param {SuppressionRule[]} suppressions
 * @returns {{ suppressed: boolean, reason?: string, category?: string }}
 */
function checkSuppression(finding, suppressions) {
  const owner = finding.className || finding.interfaceName || '';
  const qualifiedName = owner ? `${owner}.${finding.name}` : finding.name;

  for (const rule of suppressions) {
    if (matchesGlob(qualifiedName, rule.pattern)) {
      return { suppressed: true, reason: rule.reason, category: rule.category };
    }
  }
  return { suppressed: false };
}

// ── Command Handler Detection ──────────────────────────────────────────────

/**
 * Scan source files for `vscode.commands.registerCommand(...)` calls and
 * extract method names from the callback body.
 *
 * Detects patterns like:
 *   - `() => this.methodName()`
 *   - `() => this.commands!.methodName(arg)`
 *   - `async () => { ... this.methodName(...) ... }`
 *   - `(arg?) => this.obj!.methodName(this.helper(arg))`
 *
 * Returns a Set of method names that are wired as command handlers.
 */
function detectCommandHandlerMethods(sourceFiles, projectRoot) {
  const commandMethods = new Set();

  for (const sf of sourceFiles) {
    if (!isSrcFile(sf.getFilePath(), projectRoot)) continue;

    const text = sf.getFullText();
    if (!text.includes('registerCommand')) continue;

    // Regex to find registerCommand calls and extract method names from body
    // Matches: registerCommand('...', (...) => ... .methodName( ... ))
    // Also matches multi-line with { }
    const registerRe = /registerCommand\s*\(\s*['"][^'"]+['"]\s*,\s*(?:async\s+)?\([^)]*\)\s*=>\s*(?:\{[^}]*\}|[^),]+)/g;

    let match;
    while ((match = registerRe.exec(text)) !== null) {
      const body = match[0];
      // Extract all .methodName( calls from the body
      const methodCallRe = /\.(\w+)\s*\(/g;
      let methodMatch;
      while ((methodMatch = methodCallRe.exec(body)) !== null) {
        const name = methodMatch[1];
        // Skip common non-method patterns
        if (name === 'registerCommand' || name === 'commands' || name === 'push') continue;
        commandMethods.add(name);
      }
    }
  }

  return commandMethods;
}

// ── Main Analysis ──────────────────────────────────────────────────────────

/**
 * Run dead method analysis on the given project.
 * @param {AnalysisConfig} config
 * @param {string} projectPath — absolute path to the project root
 * @returns {AnalysisResult}
 */
function analyzeMethods(config, projectPath) {
  const srcDir = path.join(projectPath, 'src');
  const tsConfigPath = path.join(projectPath, 'tsconfig.json');

  const frameworkMethods = new Set(config.frameworkMethods);

  const project = new Project({
    tsConfigFilePath: tsConfigPath,
    skipAddingFilesFromTsConfig: true,
  });

  project.addSourceFilesAtPaths(path.join(srcDir, '**/*.ts'));
  const sourceFiles = project.getSourceFiles();

  // Filter out ignored files
  const activeFiles = sourceFiles.filter((sf) => {
    const rel = relPath(sf.getFilePath(), projectPath);
    return !config.ignorePatterns.some((pattern) => minimatch(rel, pattern, { dot: true }));
  });

  // Detect command handler methods
  const commandHandlerMethods = detectCommandHandlerMethods(activeFiles, projectPath);

  const findings = [];
  const suppressedFindings = [];

  // ── 1. Find all public class methods ─────────────────────────────────

  const classMethods = [];

  for (const sf of activeFiles) {
    for (const cls of sf.getClasses()) {
      const className = cls.getName() || '<anonymous>';

      for (const method of cls.getMethods()) {
        const name = method.getName();

        if (method.hasModifier(SyntaxKind.PrivateKeyword)) continue;
        if (method.hasModifier(SyntaxKind.ProtectedKeyword)) continue;
        if (frameworkMethods.has(name)) continue;
        if (name.startsWith('_')) continue;

        classMethods.push({
          name,
          className,
          filePath: sf.getFilePath(),
          kind: 'method',
          isStatic: method.hasModifier(SyntaxKind.StaticKeyword),
        });
      }
    }
  }

  // ── 1b. Build interface→implementor map ───────────────────────────

  // Maps "InterfaceName" → Set of class names that implement it
  const interfaceImplementors = new Map();

  for (const sf of activeFiles) {
    for (const cls of sf.getClasses()) {
      const className = cls.getName() || '<anonymous>';
      // Check implements clauses
      for (const impl of cls.getImplements()) {
        const ifaceName = impl.getExpression().getText();
        if (!interfaceImplementors.has(ifaceName)) {
          interfaceImplementors.set(ifaceName, new Set());
        }
        interfaceImplementors.get(ifaceName).add(className);
      }
    }
  }

  // ── 2. Find all interface methods ────────────────────────────────────

  const interfaceMethods = [];

  for (const sf of activeFiles) {
    for (const iface of sf.getInterfaces()) {
      const ifaceName = iface.getName();

      for (const method of iface.getMethods()) {
        const name = method.getName();
        if (frameworkMethods.has(name)) continue;

        interfaceMethods.push({
          name,
          interfaceName: ifaceName,
          filePath: sf.getFilePath(),
          kind: 'interface-method',
        });
      }
    }
  }

  // ── 3. Type-aware call-graph ─────────────────────────────────────────

  const typedCallSites = new Map();
  const untypedCallSites = new Map();
  const typeChecker = project.getTypeChecker();

  for (const sf of activeFiles) {
    const filePath = sf.getFilePath();
    if (!isSrcFile(filePath, projectPath)) continue;

    sf.forEachDescendant((node) => {
      if (node.getKind() !== SyntaxKind.CallExpression) return;

      const expr = node.getExpression();
      if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return;

      const methodName = expr.getName();
      const objectExpr = expr.getExpression();

      let ownerNames = [];
      try {
        const type = typeChecker.compilerObject.getTypeAtLocation(objectExpr.compilerNode);
        if (type) {
          const symbol = type.getSymbol() || type.aliasSymbol;
          if (symbol) {
            ownerNames.push(symbol.getName());
          }

          // Handle union types (e.g., Manager | undefined from optional chaining)
          if (!symbol && type.isUnion && type.isUnion()) {
            for (const memberType of type.types) {
              // Skip undefined, null, void members
              if (memberType.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) continue;
              const memberSymbol = memberType.getSymbol() || memberType.aliasSymbol;
              if (memberSymbol) {
                ownerNames.push(memberSymbol.getName());
              }
            }
          }

          const apparentType = typeChecker.compilerObject.getBaseTypeOfLiteralType(type);
          if (apparentType && apparentType !== type) {
            const appSymbol = apparentType.getSymbol();
            if (appSymbol) {
              ownerNames.push(appSymbol.getName());
            }
          }
        }
      } catch {
        // Type resolution can fail for complex expressions
      }

      if (ownerNames.length > 0) {
        for (const ownerName of ownerNames) {
          const key = `${ownerName}.${methodName}`;
          if (!typedCallSites.has(key)) {
            typedCallSites.set(key, new Set());
          }
          typedCallSites.get(key).add(filePath);
        }
      } else {
        // Only record as untyped when type resolution failed entirely
        // (e.g., 'as any' casts, typeof guards). Calls that resolved to a
        // concrete type should NOT populate the untyped map, otherwise
        // unrelated classes sharing a method name cause false negatives.
        if (!untypedCallSites.has(methodName)) {
          untypedCallSites.set(methodName, new Set());
        }
        untypedCallSites.get(methodName).add(filePath);
      }
    });
  }

  // ── 4. Find methods with zero external callers ───────────────────────

  for (const method of classMethods) {
    const typedKey = `${method.className}.${method.name}`;
    const typedCalls = typedCallSites.get(typedKey);

    let interfaceTypedCalls = null;
    for (const im of interfaceMethods) {
      if (im.name === method.name) {
        const ifaceKey = `${im.interfaceName}.${im.name}`;
        const ifaceCalls = typedCallSites.get(ifaceKey);
        if (ifaceCalls) {
          interfaceTypedCalls = ifaceCalls;
          break;
        }
      }
    }

    const allTypedCalls = new Set();
    if (typedCalls) typedCalls.forEach((f) => allTypedCalls.add(f));
    if (interfaceTypedCalls) interfaceTypedCalls.forEach((f) => allTypedCalls.add(f));

    const externalTypedCallers = [...allTypedCalls].filter((f) => f !== method.filePath);
    const selfTypedCallers = [...allTypedCalls].filter((f) => f === method.filePath);

    let finding = null;

    if (allTypedCalls.size === 0) {
      finding = { ...method, callerCount: 0, selfCallOnly: false };
    } else if (externalTypedCallers.length === 0) {
      finding = { ...method, callerCount: selfTypedCallers.length, selfCallOnly: true };
    }

    if (finding) {
      // Fallback: check untyped call sites (handles 'as any' casts, typeof guards).
      // Only truly untyped calls (where type resolution failed) are in this map,
      // so typed calls on unrelated classes sharing the same method name won't
      // cause false negatives.
      const untypedCalls = untypedCallSites.get(finding.name);
      if (untypedCalls) {
        const externalUntypedCallers = [...untypedCalls].filter((f) => f !== method.filePath);
        if (externalUntypedCallers.length > 0) {
          finding = null;
        }
      }
    }

    if (finding) {
      // Check command handler suppression
      if (commandHandlerMethods.has(finding.name)) {
        finding.suppressed = true;
        finding.suppressReason = 'VS Code command handler — registered via vscode.commands.registerCommand';
        finding.suppressCategory = 'command-handler';
        suppressedFindings.push(finding);
        continue;
      }

      // Check config-based suppressions
      const suppression = checkSuppression(finding, config.suppressions);
      if (suppression.suppressed) {
        finding.suppressed = true;
        finding.suppressReason = suppression.reason;
        finding.suppressCategory = suppression.category;
        suppressedFindings.push(finding);
        continue;
      }

      findings.push(finding);
    }
  }

  // ── 5. Find interface methods never called ───────────────────────────

  for (const method of interfaceMethods) {
    const typedKey = `${method.interfaceName}.${method.name}`;
    const typedCalls = typedCallSites.get(typedKey);

    // Only check classes that actually implement this interface
    const implementors = interfaceImplementors.get(method.interfaceName) || new Set();

    let hasImplementationCallers = false;
    for (const cm of classMethods) {
      if (cm.name === method.name && implementors.has(cm.className)) {
        const classKey = `${cm.className}.${cm.name}`;
        const classCalls = typedCallSites.get(classKey);
        if (classCalls && [...classCalls].some((f) => f !== cm.filePath)) {
          hasImplementationCallers = true;
          break;
        }
      }
    }

    if (!typedCalls && !hasImplementationCallers) {
      const finding = {
        ...method,
        callerCount: 0,
        selfCallOnly: false,
      };

      // Check command handler suppression
      if (commandHandlerMethods.has(finding.name)) {
        finding.suppressed = true;
        finding.suppressReason = 'VS Code command handler — registered via vscode.commands.registerCommand';
        finding.suppressCategory = 'command-handler';
        suppressedFindings.push(finding);
        continue;
      }

      // Check config-based suppressions
      const suppression = checkSuppression(finding, config.suppressions);
      if (suppression.suppressed) {
        finding.suppressed = true;
        finding.suppressReason = suppression.reason;
        finding.suppressCategory = suppression.category;
        suppressedFindings.push(finding);
        continue;
      }

      findings.push(finding);
    }
  }

  // ── 6. Find types only used by dead methods ──────────────────────────

  const deadMethodNames = new Set(
    findings.filter((f) => f.callerCount === 0).map((f) => f.name)
  );

  const deadTypes = [];

  for (const sf of activeFiles) {
    for (const iface of sf.getInterfaces()) {
      if (!iface.isExported()) continue;
      const ifaceName = iface.getName();

      let usedInLiveCode = false;
      let usedAnywhere = false;

      for (const otherSf of activeFiles) {
        const text = otherSf.getFullText();
        if (!text.includes(ifaceName)) continue;

        otherSf.forEachDescendant((node) => {
          if (node.getKind() === SyntaxKind.Identifier && node.getText() === ifaceName) {
            usedAnywhere = true;

            let parent = node.getParent();
            let insideDeadMethod = false;

            while (parent) {
              if (parent.getKind() === SyntaxKind.MethodDeclaration ||
                  parent.getKind() === SyntaxKind.MethodSignature) {
                const methodName = parent.getName?.();
                if (methodName && deadMethodNames.has(methodName)) {
                  insideDeadMethod = true;
                }
                break;
              }
              parent = parent.getParent();
            }

            if (!insideDeadMethod) {
              // Check if it's at the declaration site of the type itself
              const containingIface = node.getFirstAncestorByKind(SyntaxKind.InterfaceDeclaration);
              if (containingIface && containingIface.getName() === ifaceName) {
                // Self-declaration — neutral
              } else if (node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) {
                // Import statement — neutral (imports don't indicate live usage)
              } else {
                usedInLiveCode = true;
              }
            }
          }
        });

        if (usedInLiveCode) break;
      }

      if (usedAnywhere && !usedInLiveCode) {
        deadTypes.push({
          name: ifaceName,
          filePath: sf.getFilePath(),
          kind: 'type',
          reason: 'Only consumed by dead methods',
        });
      }
    }
  }

  // ── Sort and return ──────────────────────────────────────────────────

  findings.sort((a, b) => {
    if (a.callerCount !== b.callerCount) return a.callerCount - b.callerCount;
    return a.name.localeCompare(b.name);
  });

  suppressedFindings.sort((a, b) => a.name.localeCompare(b.name));

  return {
    findings,
    suppressedFindings,
    deadTypes,
    stats: {
      totalMethods: classMethods.length,
      totalInterfaces: interfaceMethods.length,
      commandHandlerMethods: commandHandlerMethods.size,
      suppressedCount: suppressedFindings.length,
      deadCount: findings.filter((f) => !f.selfCallOnly).length,
      selfOnlyCount: findings.filter((f) => f.selfCallOnly).length,
      deadTypeCount: deadTypes.length,
    },
  };
}

module.exports = { analyzeMethods, detectCommandHandlerMethods, checkSuppression, matchesGlob };
