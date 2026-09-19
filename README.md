# niffler-cc

Cyclomatic complexity for a TypeScript/JavaScript file, as a
[Niffler](https://github.com/gokr/niffler) component.

One tool, `cc_analyze {path}`: it parses the file with
[ts-morph](https://ts-morph.com) (the TypeScript compiler API, so modern syntax —
class fields, `?.`, `??`, decorators — parses for real) and reports **every
function's cyclomatic complexity**, sorted worst-first, with its kind, name and
line range, plus a summary (count, total, average, worst function).

```
$ niffler  →  invoke cc_analyze {"path": "src/service.ts"}

service.ts: 47 functions, worst 6
  handleCall                  method        CC 6   lines 446-472
  request                     method        CC 5   lines 187-216
  connect                     method        CC 5   lines 241-309
  …
```

## Install

Requires a Niffler harness whose `builder` resolves a TypeScript component's
dependencies from its imports and whose `plugins` manifest accepts
`"lang": "ts"` (both landed together; see the harness CHANGELOG entry *"TS
components resolve their own dependencies from their own imports"*). On an older
harness `plugin_install` answers `niffler.json: unsupported lang 'ts' for cc`.

```bash
plugin_install {"repo": "gokr/niffler-cc"}
```

or from a shell in a harness checkout:

```bash
./var/bin/cli install gokr/niffler-cc
```

Installs always build from source: the harness's `builder` component compiles
`cc/main.ts` with the user's own toolchain. The component's only dependency is
declared by the source itself — `import { Project } from "ts-morph"` — which the
builder resolves and npm-installs; there is no dependency field in
`niffler.json` and nothing to pass to the build.

## What the number is

Cyclomatic complexity = **1 + decision points**, the classic set (ESLint's
`complexity` rule):

| counts | does not count |
|---|---|
| `if`, `for`, `for…of/in`, `while`, `do…while` | `else`, `finally` |
| each `case` / `default` clause | loop bodies |
| `catch` | nested functions |
| `cond ? a : b` | `await`, `yield` |
| `&&`, `||`, `??` (and `&&=`, `||=`, `??=`) | plain calls |

Nested functions are reported **separately**, never folded into the parent: a
`setInterval(() => {…})` inside `start()` is its own entry named
`setInterval callback`, and its branches do not inflate `start()`'s score.

Rules of thumb: 1–10 simple, 11–20 worth a look, > 20 hard to test exhaustively.
It is a *smell detector*, not a gate — a chain of independent guard clauses
scores high while being perfectly readable (`nameOf` in this very component is
18), so read the function, don't just sort by the number.

## Development

The dev project (`package.json`, `tsconfig.json`) exists so an editor, the
TypeScript language server, or a plain `npx tsc --noEmit` sees the same module
graph the builder will. It links the SDK from a sibling harness checkout
(`file:../sdk/ts`), so develop this package **inside a Niffler checkout**
(any directory — it does not need to be committed there):

```bash
git clone https://github.com/gokr/niffler ~/git/niffler
cd ~/git/niffler/sdk/ts && npm install && npm run build   # build the SDK once
cp -r niffler-cc ~/git/niffler/cc-plugin
cd ~/git/niffler/cc-plugin && npm install && npm run typecheck
```

Then load it into a running harness:

```bash
# via the bus (compiles from source, no manifest involved)
./var/bin/cli call build '{"lang":"ts","name":"cc","source":"<cc/main.ts>"}'
./var/bin/cli call spawn '{"name":"cc","binary":"var/bin/cc"}'
```

or install the package from its git URL (what `plugin_install` does), which is
what CI verifies on every tag.

## License

MIT — see [LICENSE](LICENSE).
