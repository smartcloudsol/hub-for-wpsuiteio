# SmartCloud WP Suite

This repository contains the source code and shared frontend/runtime modules for the **SmartCloud WP Suite**.
The Hub centralises **licence management**, **site connection**, shared plugin rendering, and shared vendor assets across Smart Cloud Solutions' WP Suite plugins.  

![Node.js](https://img.shields.io/badge/node-%3E%3D16.x-blue.svg)
![PHP](https://img.shields.io/badge/PHP-%3E%3D8.1-blue)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Documentation

You can find the continuously expanding, detailed documentation at:  
[WP Suite – Docs](https://wpsuite.io/docs/)

## Project Structure

- `wpsuite-core/`: Shared JavaScript modules (licence handling, site connection)
- `wpsuite-admin/`: Logic and WordPress-facing assets for the shared admin interface
- `wpsuite-main/`: Shared frontend runtime rendered by plugins; currently responsible for Google reCAPTCHA rendering when it is enabled in any plugin
- `wpsuite-blocks/`: Shared Gutenberg blocks and React fallback lifecycle helpers used by plugin block packages
- `wpsuite-amplify-vendor/`: Shared vendor bundle for Amplify UI dependencies used by plugins (`@smart-cloud/aws-amplify-ui`, `@smart-cloud/aws-amplify-ui-react`, `aws-amplify`)
- `wpsuite-mantine-vendor/`: Shared Mantine JavaScript and CSS vendor assets used by plugins (`@mantine/...`)
- `wpsuite-webcrypto-vendor/`: Shared WebCrypto vendor bundle used for signing subscription-related licence and configuration files (`jose` and related dependencies)
- `dist/` and `php/` folders: Contain compiled frontend assets and PHP files that are copied into plugin packages after build

## Installation and Build Guide

### Prerequisites
- Node.js (>= 16.x)
- Yarn or NPM
- PHP >= 8.1
- Git

### 1. Clone the Repository
```bash
git clone https://github.com/smartcloudsol/smartcloud-wpsuite.git
cd smartcloud-wpsuite
```

### 2. Install JavaScript Dependencies
Each frontend project requires its own dependency installation:

```bash
cd wpsuite-core
yarn install

cd ../wpsuite-blocks
yarn install

cd ../wpsuite-admin
yarn install

cd ../wpsuite-main
yarn install

cd ../wpsuite-amplify-vendor
yarn install

cd ../wpsuite-mantine-vendor
yarn install

cd ../wpsuite-webcrypto-vendor
yarn install
```

### 3. Build Published Foundation Packages Only If You Are Modifying Them Locally

Both `@smart-cloud/wpsuite-core` and `@smart-cloud/wpsuite-blocks` are public npm packages. Consumer workspaces should normally install their declared published versions from npm, so neither package needs a local build for routine plugin development.

Build a foundation package locally only when you are changing that package itself:

```bash
cd wpsuite-core
yarn run build

cd ../wpsuite-blocks
yarn run lint
yarn run test
yarn run build
```

`wpsuite-blocks` is a build-time dependency of the AI Kit, Gatey, and Flow block workspaces. Its fallback root block and React fallback lifecycle helpers are bundled into those plugins' compiled block assets; its `dist/` directory is not copied into the shared `smartcloud-wpsuite/` runtime directory.

When releasing a `wpsuite-blocks` change, lint, test, build, version, and publish the package first. Then update the dependency range and lockfile in every consuming block workspace, increment the affected plugin versions, and rebuild the final plugin packages.

#### Optional: Link `wpsuite-core` For Local Development
`@smart-cloud/wpsuite-core` is available from the npm registry used by the project, so local linking is only needed when you are actively modifying `wpsuite-core` itself.

This is generally not recommended for normal development, because a local `wpsuite-core` build omits the subscription-only functionality and only the free feature set will work. If your goal is explicitly to test or build that free-only behavior, local linking is fine:

```bash
# Inside wpsuite-core
npm link

# Inside wpsuite-admin
npm link @smart-cloud/wpsuite-core

# Inside wpsuite-main
npm link @smart-cloud/wpsuite-core
```

#### Optional: Link `wpsuite-blocks` For Local Development

`@smart-cloud/wpsuite-blocks` is published on npm, so local linking is only needed while developing unreleased block helpers. Create the link in this repository, then consume it from each affected plugin's `blocks/` workspace:

```bash
# Inside common/wpsuite-blocks
npm link

# Inside ai-kit/blocks, gatey/blocks, or flow/blocks
npm link @smart-cloud/wpsuite-blocks
```

Before a release build, replace local links with the intended published package version and refresh the consumer lockfiles so the build is reproducible.

### 4. Build Plugin-Facing Frontend Modules
```bash
cd ../wpsuite-admin
yarn run build-wp dist

cd ../wpsuite-main
yarn run build-wp dist
```

### 5. Build Shared Vendor Bundles
```bash
cd ../wpsuite-amplify-vendor
yarn run build

cd ../wpsuite-mantine-vendor
yarn run build

cd ../wpsuite-webcrypto-vendor
yarn run build
```

### 6. Copy Build Outputs Into Each Plugin
After the builds complete, copy the shared Hub output into each plugin's `smartcloud-wpsuite/` directory (for example `wp-content/plugins/<plugin>/smartcloud-wpsuite/`):

- Copy the contents of `wpsuite-admin/dist/` into `smartcloud-wpsuite/`
- Copy the contents of `wpsuite-admin/php/` into `smartcloud-wpsuite/`
- Copy the contents of `wpsuite-main/dist/` into `smartcloud-wpsuite/`
- Copy the built files from `wpsuite-amplify-vendor/dist/` and `wpsuite-webcrypto-vendor/dist/` into `smartcloud-wpsuite/assets/js/`, and copy the built files from `wpsuite-mantine-vendor/dist/` into `smartcloud-wpsuite/assets/js/` and `smartcloud-wpsuite/assets/css/`, so those shared vendor assets are loaded once per plugin instead of being bundled separately in every plugin module

## Packaging for Deployment
Before packaging a plugin, make sure its `smartcloud-wpsuite/` directory contains the latest files copied from the shared module builds above.

```bash
git archive --format zip -o smartcloud-wpsuite.zip HEAD
```

## Legacy Namespace Migration

`smartcloud-wpsuite` is the canonical packaged runtime directory, WordPress admin slug, option namespace, and REST namespace. The shared runtime migrates existing `hub-for-wpsuiteio/site-settings` data to the canonical option, keeps the legacy option synchronized during rolling plugin upgrades, accepts the legacy REST route, and redirects the legacy admin URL. The legacy upload directory is read only as an import source for older licence/configuration files; current virtual assets remain under `/smartcloud-wpsuiteio/`.

## Dependencies

- **@smart-cloud/wpsuite-core** from the project's npm registry, unless you intentionally replace it with a local link during `wpsuite-core` development
- **@smart-cloud/wpsuite-blocks** from the public npm registry for AI Kit, Gatey, and Flow block builds, unless you intentionally replace it with a local link during `wpsuite-blocks` development
- **wpsuite-main** and the shared vendor bundles from `wpsuite-amplify-vendor`, `wpsuite-mantine-vendor`, and `wpsuite-webcrypto-vendor`
- **Node.js / Yarn or NPM**
- **PHP >= 8.1**
- **WordPress**

## License

MIT License
