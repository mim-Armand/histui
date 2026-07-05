# Publishing Histui

Use this checklist when publishing the `@mim/histui` package to npm.

## Before Publishing

1. Make sure the package name in `package.json` is `@mim/histui`.
   For scoped public packages, keep:

   ```json
   {
     "publishConfig": {
       "access": "public"
     }
   }
   ```

2. Update the version with semantic versioning:

   ```bash
   npm version patch
   ```

   Use `minor` for new compatible features and `major` for breaking API changes.

3. Run checks:

   ```bash
   npm run check
   ```

4. Inspect the files that will be published:

   ```bash
   npm pack --dry-run
   ```

   Confirm that `src/index.js`, `src/index.d.ts`, `src/styles.css`, README, and package metadata are included.

## Publish

1. Sign in to npm:

   ```bash
   npm login
   ```

2. Publish:

   ```bash
   npm publish --access public
   ```

3. Verify the published package:

   ```bash
   npm view @mim/histui
   ```

## After Publishing

1. Install the published package in a clean test project:

   ```bash
   npm install @mim/histui
   ```

2. Import the JavaScript and CSS:

   ```js
   import { createHistuiTimeline } from "@mim/histui";
   import "@mim/histui/styles.css";
   ```

3. Smoke-test a small PastStruct dataset and confirm:
   - timeline renders
   - pan, zoom, navigator, and fit work
   - LOD and explode mode work
   - package styles are present
   - selection callbacks fire

4. Create and push a Git tag if `npm version` did not already do it:

   ```bash
   git push --follow-tags
   ```

## Notes

- The package currently ships source ESM files directly from `src/`; there is no build step.
- `src/styles.css` is required by host apps.
- Keep `files` and `exports` in `package.json` in sync if package structure changes.
