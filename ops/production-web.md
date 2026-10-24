# Production web assets

Build with Node 24, npm and Python 3 from a fixed reviewed commit:

```sh
bash ops/build-release.sh REVIEWED_COMMIT /absolute/private/release.tar.gz
```

The script exports that commit into a new temporary directory, installs its locked build dependencies, runs `npm run build:web`, and validates `dist/web/manifest.json`. It ships the complete build and source inputs, never the caller's `dist`, untracked files, credentials, fixtures or `node_modules`. A failed install, build or manifest check fails the release. Archive order, timestamps and permissions are normalized for reproducible bytes and service-user readability.

After extracting a release and making the existing private M1 configuration available, start the same single application with:

```sh
WEB_ASSET_MODE=production node apps/platform/server.ts
```

The service template includes this environment setting. Production startup rejects missing, modified or stale pages, assets, build inputs, or an app version that differs from `package.json`; it does not build or fall back to source HTML. Development defaults to `WEB_ASSET_MODE=source`.

Only current manifest-listed `/assets/build/<name>-<sha16>.<ext>` files receive a one-year immutable public cache policy. Other public static files use ETag revalidation. HTML, `/owner`, Agent instructions, authenticated responses and APIs remain `no-store`. Anonymous JSON/SVG and other supported text responses may use gzip; private authenticated responses are not compressed here. Security headers, containment checks and missing-file responses remain enforced.

This source/template change performs no deployment. UAT source, configuration and service changes require the user's separate explicit review approval.
