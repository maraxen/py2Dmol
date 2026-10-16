---
title: py2Dmol as an agent-native tool, through cisternal
description: Scope for a wire()-based CLI+MCP surface, an optional-cisternal plugin bundle, telemetry, shipped skills/agents, and the cisternal 0.1.2 promotion it depends on.
task_id: 261016_py2dmol-cisternal
status: draft
---

# py2Dmol as an agent-native tool, through cisternal

**Status:** scope, not a plan. Nothing here is implemented. Every assumption is tagged
*verified* (read at file:line or probed) or *unverified* (a spike is listed for it).

## 0. The constraint everything else follows from

cisternal requires **Python >= 3.13** and hard-depends on `fastmcp>=4`, `cyclopts>=4.18,<5`,
`opentelemetry-api`, `pyyaml` (*verified*, cisternal `origin/main:pyproject.toml:22-27`).
py2Dmol declares `python_requires='>=3.6'` and `install_requires=['numpy','ipython','gemmi']`
(*verified*, `setup.py:60-61`) and its audience is notebooks, Colab first.

So **cisternal cannot be a dependency of `import py2Dmol`.** The notebook package stays exactly
what it is. Everything agent-facing lives in a new subpackage `py2Dmol.agent` behind an extra:

```
extras_require={'agent': ['cisternal>=0.1.2; python_version>="3.13"']}
entry_points={'console_scripts': ['py2dmol=py2Dmol.agent.cli:main',
                                  'py2dmol-mcp=py2Dmol.agent.mcp:main']}
```

Both entry points import cisternal lazily and, when it is missing, exit 2 with one line:
`py2dmol: the agent surface needs 'pip install "py2Dmol[agent]"' on Python >= 3.13`.
`tests/packaging.py` gains a check that `import py2Dmol` never imports `cisternal`, `fastmcp`
or `cyclopts` (an import-graph assertion, run in a subprocess, with a mutation that adds the
import to `__init__.py` and must fail it).

This is the pattern xtrax and alphex already use (recon: guarded import / marker-gated extra);
it is the reading of "leverage cisternal.wire" that does not cost the notebook audience anything.

## 1. The Python interface: a declarative view spec, wired once

### Why not wire the `view` class directly
`@cisternal.tool` registers plain functions whose signature becomes both the MCP schema and the
CLI (`registration/wired.py:408`, *verified*). `view` is a stateful object with ~60 constructor
kwargs and ~25 mutating methods, and its output is a notebook display side effect
(`viewer.py:17` imports IPython at module load; `show()` outside a notebook prints
`<IPython.core.display.HTML object>`, *verified*). Wiring methods one-for-one would give an
agent a session of hidden state across MCP calls - exactly what agents handle worst.

### What to build instead: `ViewSpec`
One JSON/TOML document that says everything a picture is: structures (path, PDB id, AFDB id,
chains, biounit), style/preset/colour scheme, per-selection colours, side chains, contacts,
heatmaps (`maps`), slots, clip/orient/focus, plugins + payloads, size, background.

- `py2Dmol.agent.spec.build(spec) -> view` is a pure translation onto the **existing** public
  methods (`add_pdb`, `set_color`, `show_sidechains`, `add_contacts`, `add_plugin`, ...). No new
  rendering path. That is the "one translation" rule CLAUDE.md already applies to clip/orient.
- The spec's vocabulary is derived from `DEFAULT_CONFIG` (`viewer.py:31`) and the selector
  grammar, not re-typed, and `tests/config.js`-style a test fails when a `view()` kwarg has no
  spec field or vice versa (the field-by-field-rebuild fault this repo has hit five times).
- The spec is versioned (`"spec": 1`) - the first versioned contract on the Python side; the
  live/static wire itself has no version field today (*verified*, recon) and this scope does not
  change the wire.

### The tools (one `registry="py2dmol"` partition, wired to CLI + MCP)

| tool | in | out | notes |
|---|---|---|---|
| `inspect_structure` | path / PDB id / AFDB id | chains, lengths, residue ranges, ligands, nucleic/protein, models, has pLDDT/PAE | gemmi only, no browser. The facts an agent needs to WRITE selections. |
| `validate_spec` | spec | errors with JSON paths, resolved selectors | refuses before rendering; names unknown keys (the dropped-key class of bug) |
| `render_html` | spec, out path | standalone `.html` (`save_html`, `viewer.py:5536`, *verified*) | the reviewable, interactive artifact; works from `file://` |
| `save_state` / `load_state` | spec or state path | state JSON | existing methods, so a view an agent built round-trips into the notebook and the website |
| `vocabulary` | - | styles, presets, colour modes, palettes, selector keys, slot views | read off the code, so docs cannot drift |
| `plugin_check` | plugin JS + sample payload | registry/seam result | runs the existing `tests/plugin_seam.js` harness under node; for the plugin-dev skill |
| `render_image` | spec, out, format, dpi | PNG/SVG | **DECISION NEEDED - see §1.1** |

CLI shape (cyclopts via `wire`): `py2dmol inspect`, `py2dmol validate`, `py2dmol render`,
`py2dmol state save|load`, `py2dmol vocab`, `py2dmol plugin check|scaffold`, plus
`py2dmol plugin install|update|export|info` from `cisternal.plugin.plugin_app(PluginSpec(...))`
(recon). Each tool gets a `CliContract` with `json_option` so an agent shell call gets JSON and a
human gets a table, and exit codes per exception class (spec invalid = 3, structure not found = 4).

### 1.1 The image question - a prior decision this scope would reopen
CLAUDE.md records that a `view.save_image(path)` (headless Chrome over CDP) was built, tested and
**removed at the reader's word** - "feels hacky... keep it simple, provide user a html for bulk
only" - with "do not add it back without a reason the page cannot meet".

The agent case may be that reason: an agent cannot drop files on `render.html`, and a model that
cannot SEE the picture cannot critique it. But it is your call, and there are three honest options:

1. **No image tool.** Agents get `render_html` and use whatever browser tool their harness has.
   Zero new machinery; agents without a browser are blind.
2. **Image tool in the `agent` extra only**, never in the notebook wheel's import path: drives
   `render.html`'s own `window.py2dmolBatch` door (or `toImage`) in headless Chrome, reusing
   `tests/cdp.py`'s zero-dependency client. Keeps the notebook API untouched, which is what the
   removal protected; costs a Chrome dependency at runtime, discovered not bundled.
3. **Defer**: ship 1 now, measure via telemetry how often agents call `render_html` and then
   ask for a picture, decide on 2 with data.

My recommendation is 3 then 2, but this scope does not assume either.

### 1.2 Live viewers over MCP - out of scope for v1
A stateful "open a viewer, keep pushing frames" session (the notebook's BroadcastChannel live
path, `viewer.py:1684-1909`) has no host outside a notebook. Not attempted; noted so nobody
mistakes v1's file-out design for a limitation they discovered.

## 2. The plugin install, on a machine without cisternal

Recon (*verified* in code, `assets/bundle.py:83-95`, `assets/manifest.py:267-270`): a cisternal
Claude-Code bundle is static files - `.claude-plugin/plugin.json`, `skills/`, `agents/`,
`hooks/hooks.json`, `.mcp.json` - and **nothing in it imports cisternal**. So:

- **Skills + agents work with neither cisternal nor py2Dmol installed.** That is most of the value.
- **The MCP server** uses `launch = "uvx"` with
  `uvx_from = "py2Dmol[agent]=={version}"` and `command = ["py2dmol-mcp"]`, so the plugin runs
  `uvx --from 'py2Dmol[agent]==X' py2dmol-mcp` and uv fetches py2Dmol and cisternal into an
  ephemeral env. Requirement on the machine: `uv`, nothing else. Same pattern bathos ships.
- **Distribution:** a committed `plugin/` + `.claude-plugin/marketplace.json` (the bathos
  "repo-bundle" path), so `/plugin marketplace add sokrypton/py2Dmol` installs it with no Python.
- **Manifest:** `.praxia/manifest.toml` with `[plugin]`, `[[plugin.skills]]`, `[[plugin.agents]]`,
  `[plugin.mcp]`. No hooks in v1. Exported in dev/CI with `cisternal assets export` - cisternal is
  a dev-time dependency for the bundle, never a runtime one.

**Spikes before building on this:**
- S1 (*unverified*): does `uvx --from 'py2Dmol[agent]==X'` pick a 3.13 interpreter when the
  default one is 3.12? With the extra marker-gated, uv may resolve the extra to nothing on 3.12
  and the entry point then exits 2. Probe on a 3.12-default box; if it fails, either the manifest
  needs `--python 3.13` in the launch argv (check `assets/launch.py` supports extra args) or the
  extra drops the marker and the package's `python_requires` stays low.
- S2 (*unverified*): Colab's current Python version. Irrelevant to the core (no dependency), but
  it decides whether `%pip install py2Dmol[agent]` in Colab is a no-op extra.
- S3 (*unverified*): `cisternal assets validate` on a manifest whose `uvx_from` carries an extra
  in brackets.

## 3. Telemetry

cisternal telemetry is local JSONL (`<log_dir>/events.<host>.<pid>.jsonl`, `CISTERNAL_LOG_DIR` >
... > `~/.cisternal/logs`), and without `init()` every `emit_event`/`span` is a no-op
(*verified*, `telemetry/pipeline.py:225-230, 398`). OTLP only if the extra and SDK exist.

Rules for py2Dmol, because it is a public package with users who never asked for any of this:

- **Never in the notebook path.** `import py2Dmol` and `view.show()` emit nothing, ever.
- **Agent surface: opt-in.** `init()` is called by `py2dmol` / `py2dmol-mcp` only when
  `CISTERNAL_TELEMETRY` is `all|1|true|yes|py2dmol` - the consumer convention bathos uses
  (`probe/telemetry_env.py`). Note `init()` itself has no gate, so the gate is ours to keep.
- **Free events:** CLI calls via `timed_command` (`cli_contract.py:826`, `wired.py:100-107`) and
  MCP calls via `CisternalMiddleware` - install the middleware in `py2dmol-mcp`.
- **Our events** (`emit_event`): `py2dmol.render` {style, preset, n_objects, n_positions,
  n_frames, bundle_bytes, ms, painter}, `py2dmol.spec_invalid` {error_codes}, and
  `py2dmol.render_followup` (an image asked for after an HTML - the §1.1 measurement).
  **No file paths, sequences or structure ids in events**; counts and enums only.
- `init()` starts three threads and a ~70 ms git subprocess (recon, code comment): fine for a
  long-lived MCP server, worth measuring for a one-shot CLI (S4).

## 4. Skills and agents to ship

Skills (the plugin's main payload; each points at code, not a copy of it):

- **`using-py2Dmol`** - the entry skill: notebook API vs agent spec, the `py2dmol`/`py2Dmol` is not
  `py3Dmol` rule, stale vendored copies shadowing the package, `save_html` for files, `biounit`
  renaming chains to `A1`, selectors (`positions` vs `residues`), which colour mode for which data.
- **`augmenting-views`** - taking a structure an agent or a pipeline produced and adding meaning:
  pLDDT/PAE, `maps` heatmaps with `vmin`/`vmax`/`colors`, contacts (incl. cross-object), side
  chains + `setSidechainColor`, `hydrophobicity`, focus/clip/orient, slots, multi-object frame
  policies. Built from the CLAUDE.md rules a user hits (e.g. `hold` default, `heatmap` vs `pae`).
- **`developing-py2Dmol-plugins`** - from `docs/PLUGINS.md`: registry contract, prims (line/ball/
  tri), the per-painter budget, `bounds()`, GPU depth-range coupling, state round trip, the
  `register_plugin` refusals, and `plugin_check` as the inner loop.
- *(repo-only, not shipped)* **`contributing-to-py2Dmol`** - bundle.py, the three test lanes,
  `paint_trace`/`__meshDigest` as no-op proofs, "measure the shell that was reported". Lives in
  `.claude/skills/` of the repo; it is maintainer knowledge, useless to a plugin user.

Agents (small, each with one job and a fixed tool list):

- **`py2dmol-view-builder`** (haiku/sonnet) - turns "show me the binding site of X coloured by
  pLDDT" into a validated spec via `inspect_structure` -> `validate_spec` -> `render_html`.
- **`py2dmol-plugin-developer`** (sonnet) - writes a draw plugin and iterates on `plugin_check`.

No `figure-critic` agent until §1.1 is decided - a critic that cannot see is not one.

## 5. CLI and MCP surfaces - what "makes sense" means here

- **One registry, two surfaces.** Every tool is a `@cisternal.tool`; the CLI and MCP cannot
  disagree because `wire()` builds both (*verified*). No hand-written MCP handlers.
- **Stateless calls, file artifacts.** Every tool takes a spec or a path and returns paths +
  JSON. Nothing depends on a previous call.
- **JSON first on the CLI** (`json_option`), tables for humans, documented exit codes.
- **Names a model can guess**: `inspect`, `validate`, `render`, `vocab` - not `add_pdb`.
- **Errors carry the JSON path** of the offending spec field and the valid alternatives (from
  `vocabulary`), so an agent can repair without re-reading docs.

## 6. Dependency: cisternal 0.1.2 (promote 0.1.1a15 -> stable)

State (*verified* 2026-10-16):
- PyPI latest `0.1.1a15` = `origin/main` (`e4783a9`). Tag `v0.1.1a15` on `e1cb94e`.
- **The local `~/projects/cisternal` `main` is 60 commits behind `origin/main`** with one local
  commit (`ade66f1 chore(bth): project id`, duplicated on branch
  `fix/cli-telemetry-all-run-paths` as `64e28f5`). Do NOT release from it.
- Branch `fix/cli-telemetry-all-run-paths` (`7a492f9`, CLI telemetry owner) is already on
  `origin/main` in a different form (`wired.py:100-107`, `cli_contract.py:826`); it conflicts only
  because its content landed. Stale - can be deleted after confirmation.
- Publish = GitHub release published -> `.github/workflows/publish.yml` -> `uv build && uv publish`
  (OIDC). All prior releases were marked pre-release.

Release steps (release PR off `origin/main`, then `gh release create v0.1.2 --target main`
without `--prerelease`):
1. `pyproject.toml` version `0.1.2`; `uv lock`; `.praxia/manifest.toml` version (enforced by
   `tests/test_self_manifest_version.py`).
2. CHANGELOG `## 0.1.2 (2026-10-xx)` - a promotion entry; `## Unreleased` is empty now.
3. Classifier `Development Status :: 3 - Alpha` -> `4 - Beta` (or `5 - Production/Stable`), and
   the CHANGELOG preamble's "the project is alpha" sentence. **Your call.**
4. CI green on the PR (`export-dogfood.yml`: ruff, ty, pytest, golden, native-validate).
5. After publish: consumers can drop prerelease opt-ins (bathos `[tool.uv]` prerelease setting);
   py2Dmol's extra pins `cisternal>=0.1.2`.

## 7. Sequencing

0. cisternal 0.1.2 (above) - independent, can go now.
1. Spikes S1-S4 (an afternoon).
2. `py2Dmol.agent`: `ViewSpec` + `build` + `inspect_structure` + `validate_spec` + `render_html`
   + `vocabulary`, wired; import-isolation test; extra + entry points.
3. Telemetry init gate + middleware + our three events.
4. Manifest, skills, agents; `plugin/` bundle committed; `cisternal assets validate` in CI.
5. §1.1 decision, then `render_image` or not.

## 8. Open decisions for the maintainer

1. §1.1 image tool: none / agent-extra only / defer-and-measure.
2. cisternal 0.1.2 classifier: Beta or Production/Stable.
3. Where this lands: `sokrypton/py2Dmol` is a shared public repo. Shipping an `agent` extra,
   telemetry (opt-in, local) and a committed `plugin/` there is a co-maintainer decision; the
   alternative is a separate `py2Dmol-agent` package that depends on py2Dmol, which keeps the
   upstream wheel untouched at the cost of a second release train.
4. Whether `setup.py`'s stale `python_requires='>=3.6'` should be raised while we are in there.
