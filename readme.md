# Hub for WPSuite.io

This repository contains the source code and shared frontend/runtime modules for the **Hub for WPSuite.io**.
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
- `wpsuite-amplify-vendor/`: Shared vendor bundle for Amplify UI dependencies used by plugins (`@aws-amplify/ui`, `@aws-amplify/ui-react`, `aws-amplify`)
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
git clone https://github.com/smartcloudsol/hub-for-wpsuiteio.git
cd hub-for-wpsuiteio
```

### 2. Install JavaScript Dependencies
Each frontend project requires its own dependency installation:

```bash
cd wpsuite-core
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

### 3. Build `wpsuite-core` Only If You Are Modifying It Locally
```bash
cd wpsuite-core
yarn run build
```

If you are only working on the consumer packages, the published `@smart-cloud/wpsuite-core` package from the project's registry is sufficient and this local build step can be skipped.

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
After the builds complete, copy the shared Hub output into each plugin's `hub-for-wpsuiteio/` directory (for example `wp-content/plugins/<plugin>/hub-for-wpsuiteio/`):

- Copy the contents of `wpsuite-admin/dist/` into `hub-for-wpsuiteio/`
- Copy the contents of `wpsuite-admin/php/` into `hub-for-wpsuiteio/`
- Copy the contents of `wpsuite-main/dist/` into `hub-for-wpsuiteio/`
- Copy the built files from `wpsuite-amplify-vendor/dist/` and `wpsuite-webcrypto-vendor/dist/` into `hub-for-wpsuiteio/assets/js/`, and copy the built files from `wpsuite-mantine-vendor/dist/` into `hub-for-wpsuiteio/assets/js/` and `hub-for-wpsuiteio/assets/css/`, so those shared vendor assets are loaded once per plugin instead of being bundled separately in every plugin module

## Packaging for Deployment
Before packaging a plugin, make sure its `hub-for-wpsuiteio/` directory contains the latest files copied from the shared module builds above.

```bash
git archive --format zip -o hub-for-wpsuiteio.zip HEAD
```

## Dependencies

- **@smart-cloud/wpsuite-core** from the project's npm registry, unless you intentionally replace it with a local link during `wpsuite-core` development
- **wpsuite-main** and the shared vendor bundles from `wpsuite-amplify-vendor`, `wpsuite-mantine-vendor`, and `wpsuite-webcrypto-vendor`
- **Node.js / Yarn or NPM**
- **PHP >= 8.1**
- **WordPress**

## License

MIT License
