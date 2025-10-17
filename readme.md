# Hub for WPSuite.io

This repository contains the source code and frontend modules for the **Hub for WPSuite.io**.
The Hub centralises **licence management** and **site connection** across all WPSuite plugins (including Gatey).  

![Node.js](https://img.shields.io/badge/node-%3E%3D16.x-blue.svg)
![PHP](https://img.shields.io/badge/PHP-%3E%3D8.1-blue)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Documentation

You can find the continuously expanding, detailed documentation at:  
[WP Suite – Docs](https://wpsuite.io/docs/)

## Project Structure

- `wpsuite-core/`: Shared JavaScript modules (licence handling, site connection)
- `wpsuite-admin/`: Logic for the WordPress admin interface
- `dist/` folders: Contain compiled and minified frontend output

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
```

### 3. Build `wpsuite-core`
```bash
cd wpsuite-core
yarn run build
```

#### Optional: Link `wpsuite-core`
To ensure the other modules can import shared logic from `wpsuite-core`, link it locally:

```bash
# Inside wpsuite-core
npm link

# Inside wpsuite-admin
npm link @smart-cloud/wpsuite-core
```

### 4. Build Other Frontend Modules
```bash
cd ../wpsuite-admin
yarn run build-wp dist
```

## Packaging for Deployment
```bash
git archive --format zip -o hub-for-wpsuiteio.zip HEAD
```

## Dependencies

- **wpsuite-core** (not published on npm; must be built locally)
- **Node.js / Yarn or NPM**
- **PHP >= 8.1**
- **WordPress**

## License

MIT License
