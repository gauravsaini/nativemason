# Visual evidence reports

CI builds a static HTML report and a JSON manifest from measured layout evidence. The SVGs draw **registered measured layout boxes** on the window frame, applying the measured root origin to each app-root-relative rectangle. The measurement tables keep the original app-root-relative logical coordinates. The report does not contain or imitate native screenshots.

The report includes the web run supplied at `artifacts/integration/visual-evidence.json`, plus Android emulator and iOS simulator runs assembled from each platform directory's `calibration.json` and `acceptance.json`. Native before geometry comes from calibration; after geometry, constraint results, and the verified receipt come from `acceptance.json`'s `verified` fields. A native pass is shown only when the frozen evidence schema accepts the stable graph, passing constraints, and receipt revisions.

Missing or invalid input produces an explicit unavailable note and no invented run. Failed native acceptance retains its actual measured before/after graphs and is labeled failed. Physical-target evidence is excluded. Unsafe relative paths, oversized input, excessive node counts, and unreasonable layout dimensions are omitted with a generic unavailable note. The HTML escapes evidence strings and displays only relative source paths; it has no script, app-provided HTML, or embedded images. The manifest preserves the complete validated evidence used for the report.

## Download a report from a pull request

Open the **Visual evidence artifacts** section in the `visual-evidence-report` job summary. The raw web, Android, and iOS run artifacts and the combined HTML/JSON report are linked there. Download the report artifact, unzip it, and open `index.html` in a browser. `manifest.json` contains the validated inputs, and `summary.md` is a compact run-status table.

GitHub Actions stores these artifacts with the workflow run, so each report stays linked to its commit and pull request. No external hosting or deployment is used.

## Build a report locally

Use Node 24 and the repository's installed Yarn toolchain:

```sh
yarn workspace @nativemason/contracts build
yarn tsx scripts/build-evidence-report.ts \
  --web artifacts/integration/visual-evidence.json \
  --android artifacts/ci-android-evidence \
  --ios artifacts/ci-ios-evidence \
  --out artifacts/visual-evidence \
  --repository owner/repository \
  --revision 0123456789abcdef0123456789abcdef01234567
```

The web input is one `VisualEvidenceRun`. Each native directory contains `calibration.json` and `acceptance.json` with `target` and `verified.{snapshot,results,receipt,passed}`. Repository and revision metadata can be supplied as options or through `GITHUB_REPOSITORY` and `GITHUB_SHA`; pull request metadata is read from the GitHub event when available or supplied with `--pull-request`. If a GitHub step summary path is present, the CLI also appends the run-status table to it.

The command writes `index.html`, `manifest.json`, and `summary.md` under the output directory. Missing evidence files are allowed so local and partial CI runs can still produce a report with explicit unavailable notes.
