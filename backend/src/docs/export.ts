import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Importing the app registers every route's OpenAPI path (registration happens at import time).
import '../app.js';
import '../modules/index.js';
import { generateOpenApiDocument } from './openapi.js';

// `npm run openapi:export`: writes backend/openapi.json, the committed contract that the
// frontend client is generated from and that CI checks for drift (04 §2).
const target = fileURLToPath(new URL('../../openapi.json', import.meta.url));
// Paths are derived from this file's location, never from input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const document = generateOpenApiDocument(pkg.version);
// eslint-disable-next-line security/detect-non-literal-fs-filename
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`OpenAPI document written to ${target}\n`);
