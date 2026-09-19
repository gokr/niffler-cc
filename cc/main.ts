// cc — cyclomatic complexity per function for TypeScript files.
//
// A Niffler component built through builder.build (lang: "ts"), importing
// `ts-morph` — a maintained wrapper over the TypeScript compiler API, so
// the parse handles modern TS (class fields, `?.`, `??`, decorators). The
// tool walks the AST once per function counting its own decision points;
// nested functions are reported separately, never folded into the parent.

import sdk from "niffler-sdk";
import * as fs from "fs";
import * as path from "path";
import { Node, Project, SyntaxKind, type FunctionDeclaration, type MethodDeclaration, type GetAccessorDeclaration, type SetAccessorDeclaration, type ConstructorDeclaration, type FunctionExpression, type ArrowFunction } from "ts-morph";

const MAX_BYTES = 2_000_000;

// A function's cyclomatic complexity is 1 + its decision points. The set
// below is the classic one (ESLint's `complexity` rule): branches,
// loops, case/default clauses, catch, the ternary, and the short-circuit
// operators `&&`, `||`, `??` (plus their assignment forms).
const decisionKinds = new Set<SyntaxKind>([
  SyntaxKind.IfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CaseClause,
  SyntaxKind.DefaultClause,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
]);

const shortCircuitTokens = new Set<SyntaxKind>([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
  // their assignment forms (`a &&= b`) are BinaryExpressions too
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);

type FnNode = FunctionDeclaration | MethodDeclaration | GetAccessorDeclaration |
  SetAccessorDeclaration | ConstructorDeclaration | FunctionExpression | ArrowFunction;

function isFnNode(node: Node): node is FnNode {
  return Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node) ||
    Node.isConstructorDeclaration(node) || Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node);
}

function kindOf(node: FnNode): string {
  if (Node.isFunctionDeclaration(node)) return "function";
  if (Node.isMethodDeclaration(node)) return "method";
  if (Node.isConstructorDeclaration(node)) return "constructor";
  if (Node.isGetAccessorDeclaration(node)) return "getter";
  if (Node.isSetAccessorDeclaration(node)) return "setter";
  if (Node.isArrowFunction(node)) return "arrow";
  return "function-expression";
}

/** Collapse a source snippet to a one-line label of bounded length. */
function shortText(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "…";
}

/** Best-available name: the declaration's own name, or the construct that
 *  owns an anonymous function (variable, property, the call it is passed
 *  to) — the same naming the TypeScript language server shows. */
function nameOf(node: FnNode): string {
  if (Node.isConstructorDeclaration(node)) {
    const cls = node.getParent();
    const clsName = Node.isClassDeclaration(cls) ? cls.getName() : undefined;
    return clsName ? `${clsName}.constructor` : "constructor";
  }
  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) ||
      Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node)) {
    return node.getName() || "(anonymous)";
  }
  const parent = node.getParent();
  if (Node.isVariableDeclaration(parent) || Node.isPropertyDeclaration(parent) ||
      Node.isPropertyAssignment(parent) || Node.isBindingElement(parent)) {
    return parent.getName();
  }
  if (Node.isCallExpression(parent)) {
    return `${shortText(parent.getExpression().getText())} callback`;
  }
  if (Node.isNewExpression(parent)) {
    return `${shortText(parent.getExpression().getText())} callback`;
  }
  if (Node.isExportAssignment(parent)) {
    return "default export";
  }
  if (Node.isBinaryExpression(parent) &&
      parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
    return shortText(parent.getLeft().getText());
  }
  return "(anonymous)";
}

/** 1 + the decision points inside `fn` that belong to `fn` itself. Points
 *  inside a nested function are that function's, so we prune descent. */
function complexityOf(fn: FnNode): number {
  let cc = 1;
  for (const node of fn.getDescendants()) {
    if (Node.isBinaryExpression(node)) {
      if (!shortCircuitTokens.has(node.getOperatorToken().getKind())) continue;
    } else if (!decisionKinds.has(node.getKind())) {
      continue;
    }
    // Skip anything owned by a nested function.
    let insideNested = false;
    for (const ancestor of node.getAncestors()) {
      if (ancestor === fn) break;
      if (isFnNode(ancestor)) { insideNested = true; break; }
    }
    if (!insideNested) cc++;
  }
  return cc;
}

const comp = sdk.newComponent("cc", "0.1.0");

comp.tool(
  "cc_analyze",
  {
    type: "object",
    description:
      "Cyclomatic complexity (CC) per function/method in a TypeScript or " +
      "JavaScript file, computed from the TypeScript AST (ts-morph). Use it " +
      "to find the riskiest functions before refactoring or reviewing: " +
      "results come back sorted by CC descending, each with its kind, name " +
      "and line range, plus a summary (count, total, average, worst). " +
      "CC is 1 + branches/loops/cases/catch/ternary/&&/||/??; nested " +
      "functions are reported separately. CC >= 15 usually deserves a look. " +
      "Read-only; one file per call.",
    properties: {
      path: {
        type: "string",
        description: "Path to the .ts/.tsx/.js/.jsx file (workspace-relative or absolute)",
      },
    },
    required: ["path"],
  },
  async (_c: unknown, args: any) => {
    const p = String(args?.path ?? "");
    if (!p) throw new Error("path is required");
    const abs = path.isAbsolute(p) ? p : path.resolve(p);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      throw new Error("file not found: " + abs);
    }
    if (!st.isFile()) throw new Error("not a file: " + abs);
    if (st.size > MAX_BYTES) {
      throw new Error(`file too large (${st.size} bytes; limit ${MAX_BYTES})`);
    }
    const source = fs.readFileSync(abs, "utf8");
    // In-memory project: no tsconfig, no type checking — only the AST.
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { allowJs: true, noLib: true, skipLibCheck: true },
    });
    let sourceFile;
    try {
      sourceFile = project.createSourceFile(abs, source, { overwrite: true });
    } catch (err: any) {
      throw new Error("parse failed: " + String(err?.message ?? err));
    }
    const functions = sourceFile
      .getDescendants()
      .filter(isFnNode)
      .map((fn) => ({
        name: nameOf(fn),
        kind: kindOf(fn),
        cyclomatic: complexityOf(fn),
        lineStart: fn.getStartLineNumber(),
        lineEnd: fn.getEndLineNumber(),
      }));
    functions.sort(
      (a, b) => b.cyclomatic - a.cyclomatic || a.lineStart - b.lineStart
    );
    const total = functions.reduce((s, f) => s + f.cyclomatic, 0);
    const worst = functions[0] ?? null;
    return {
      path: abs,
      functions,
      summary: {
        methods: functions.length,
        totalCyclomatic: total,
        averageCyclomatic: functions.length
          ? Math.round((total / functions.length) * 100) / 100
          : 0,
        worst: worst
          ? { name: worst.name, cyclomatic: worst.cyclomatic, lineStart: worst.lineStart }
          : null,
      },
    };
  }
);

comp.run();
