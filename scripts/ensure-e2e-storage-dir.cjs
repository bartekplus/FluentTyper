const { mkdirSync } = require("node:fs");

// Jest localstorage file path expects the parent directory to exist.
mkdirSync(".tmp", { recursive: true });
