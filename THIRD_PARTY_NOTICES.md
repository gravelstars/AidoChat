# Third-party notices

AidoChat's [Apache-2.0 license](LICENSE) applies to its own material. Third-party software, fonts, PDF resources, and native components retain their original licenses and copyright notices. [NOTICE](NOTICE) records `Copyright 2026 gravelstars` for the project's own material. This repository currently publishes source and the browser demo only; no binary installers are released.

## Owner decision — 2026-10-17

The project owner reviewed the findings in this file and in the [license audit notes](docs/qa/task-023/licenses.md) and **accepts them for the current distribution scope**: source and the browser demo only, with no binary installers or Release. This records the owner's decision; it is not a legal opinion and does not claim that every dependency is Apache-2.0 compatible. The original findings remain disclosed below. Re-review is required before any binary distribution.

The dependency lists below are **machine-generated**, rather than manually selected direct dependencies:

- [Frontend inventory](docs/licenses/frontend-inventory.md): every package entry in `frontend/package-lock.json`, including development dependencies and optional packages for other platforms. Installed packages are scanned with `license-checker-rseidelsohn`; missing optional packages are fetched from the lockfile's registry URL and integrity-checked before their original license files are copied.
- [Go inventory](docs/licenses/go-inventory.md): every module selected by `go list -m all`. Separate `go list -deps` results identify modules imported by the application on Darwin, Windows, and Linux. `module-graph-only` includes build, tool, test, or transitive modules; it does **not** assert those modules are linked into the shipped binary.
- [Bundled assets](docs/licenses/bundled-assets.json): original OFL font licenses and nested pdf.js CMaps/font/wasm/ICC notices. The package-level pdf.js Apache-2.0 label is insufficient to describe all bundled assets.
- [Original text provenance](docs/licenses/text-sources.json) and [inline source notice index](docs/licenses/go-inline-notices.json): upstream package/module source paths, original-byte SHA-256 hashes, and sizes. [Tool versions, input hashes and commands](docs/licenses/provenance.json), plus [raw scanner outputs](docs/licenses/raw/), make the export auditable.
- [Review-required findings](docs/licenses/review-required.json) and [audit notes](docs/qa/task-023/licenses.md): limitations, missing files, and license findings requiring review.

Run `bash scripts/export-licenses.sh` from an environment with Node/npm, Go, tar, and network access after `npm ci` in `frontend`. It installs pinned audit tools into a temporary directory; it adds no application dependencies. Set `LICENSE_TOOLS_DIR` to reuse an existing temporary tools directory. The script copies original texts without rewriting them, then regenerates the inventories. License findings are reported, **not silently approved**. Refresh the export whenever either lockfile or the shipped assets change.

## Fonts

The actual bundled package names are **Noto Sans SC**, **Noto Serif SC**, and **JetBrains Mono**, provided by `@fontsource-variable`. Their original complete SIL Open Font License 1.1 files, including the copyright/owner statements shipped by those packages, are preserved in `docs/licenses/texts/frontend/` and linked from the generated inventory. Noto SC is part of the Noto family; this inventory does not rename those files to Adobe Source Han Sans/Serif. Preserve these notices when redistributing the font assets, and review the OFL's naming conditions before modifying fonts.

## pdf.js Liberation fonts (owner-reviewed for current scope)

`pdfjs-dist@6.4.299/standard_fonts/LICENSE_LIBERATION` contains **GNU GPL version 2 plus font exceptions**. Its full original text is [preserved here](docs/licenses/texts/frontend/pdfjs-dist@6.4.299/standard_fonts/LICENSE_LIBERATION). `frontend/src/lib/pdf.ts` includes `standard_fonts/*.{pfb,ttf,otf}` in its resource glob, including the four `LiberationSans-*.ttf` files. The upstream exception discusses document embedding and separately physical-product distribution; it is not treated here as blanket permission for Apache-2.0 application redistribution.

This finding has been reported to the project owner. The export does **not** establish that all distributed dependencies are compatible with Apache-2.0, and the distribution review remains open. Other files within complete module graphs may relate to test fixtures, build tools, or templates rather than shipped code; consult their scope before drawing conclusions. Machine license identification and notice collection are evidence for review, not a legal opinion.

## Native and generated source notices (owner-reviewed for current scope)

The `modernc.org/libc` module root is BSD-3-Clause, but its platform-specific generated Go sources also contain retained LGPL-2.1-or-later (GNU C Library), APSL-1.1, APSL-2.0, and BSD-4-Clause-UC headers. These are machine-extracted from the application import graphs, with source-file hashes and exact byte ranges in the inline notice index. The audit does not decide whether declarations, translated types, or eliminated code carry particular distribution obligations; these findings require review before claiming compatibility. Complete supplementary LGPL/APSL reference texts from the pinned Google licenseclassifier reference corpus are kept separately from upstream originals.

A GPL-2.0 text also occurs in `modernc.org/libc/testdata/.../crlibm/COPYING`. It is an upstream module test fixture; it must not be presented as proof that the libc runtime itself is GPL. Some graph-only Go modules and npm platform binary packages do not include standalone license files. Their absence and any related parent-package notices remain explicit in the generated inventories.
