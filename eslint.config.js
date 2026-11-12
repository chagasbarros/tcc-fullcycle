// @ts-check
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// "{{ from.element.captured.module }}" is replaced by the name of the module that is
// importing, so "sameModule" means "a layer inside the same module folder".
const sameModule = { module: '{{ from.element.captured.module }}' };

/** Layer of the same module that the importer is in. */
const layer = (/** @type {string} */ type) => ({ to: { element: { type, captured: sameModule } } });

/** Public API (index.ts) of ANY module — the only way into another module. */
const publicApiOfAnyModule = { to: { element: { type: 'module', fileInternalPath: 'index.ts' } } };

const shared = { to: { element: { type: 'shared' } } };

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'src/shared/db/generated/'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ['**/*.js', '**/*.mjs'], ...tseslint.configs.disableTypeChecked },
  // k6 scripts run inside k6, which provides __ENV (and the web `crypto`).
  { files: ['k6/**/*.js'], languageOptions: { globals: { __ENV: 'readonly' } } },

  // ---------------------------------------------------------------------------
  // Module boundaries (CLAUDE.md, section 4)
  // ---------------------------------------------------------------------------
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      'boundaries/elements': [
        // Layers inside a module: src/modules/<module>/<layer>/...
        { type: 'domain', pattern: 'src/modules/*/domain', capture: ['module'] },
        { type: 'application', pattern: 'src/modules/*/application', capture: ['module'] },
        { type: 'infrastructure', pattern: 'src/modules/*/infrastructure', capture: ['module'] },
        { type: 'http', pattern: 'src/modules/*/http', capture: ['module'] },
        // Files directly in the module folder (index.ts = public API).
        { type: 'module', pattern: 'src/modules/*', capture: ['module'] },
        { type: 'shared', pattern: 'src/shared' },
      ],
      'boundaries/files': [
        // Composition root (src/app.ts, src/server.ts) is a file, not a folder.
        { pattern: 'src/*.ts', category: 'root' },
        { pattern: 'src/**/*.spec.ts', category: 'test' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            'Boundary violation: {{ from.file.path }} cannot import {{ to.file.path }}. See allowed layers and modules in CLAUDE.md, section 4 (other modules only via their index.ts).',
          policies: [
            // domain: pure business rules, only its own module's domain.
            { from: { element: { type: 'domain' } }, allow: [layer('domain')] },
            // application: use cases and ports.
            {
              from: { element: { type: 'application' } },
              allow: [layer('domain'), layer('application'), shared, publicApiOfAnyModule],
            },
            // infrastructure: adapters that implement application ports.
            {
              from: { element: { type: 'infrastructure' } },
              allow: [
                layer('domain'),
                layer('application'),
                layer('infrastructure'),
                shared,
                publicApiOfAnyModule,
              ],
            },
            // http: Fastify routes call use cases.
            {
              from: { element: { type: 'http' } },
              allow: [layer('domain'), layer('application'), layer('http'), shared],
            },
            // index.ts: wires and exports the module's own layers.
            {
              from: { element: { type: 'module' } },
              allow: [
                layer('domain'),
                layer('application'),
                layer('infrastructure'),
                layer('http'),
                shared,
                publicApiOfAnyModule,
              ],
            },
            // shared: technical infra, knows nothing about business modules.
            { from: { element: { type: 'shared' } }, allow: [shared] },
            // Unit tests may use any layer of their OWN module (e.g. a use case test
            // with the in-memory repository). Other modules: still only via index.ts.
            {
              from: { file: { categories: 'test' } },
              allow: [
                layer('domain'),
                layer('application'),
                layer('infrastructure'),
                layer('http'),
                { to: { element: { type: 'module', captured: sameModule } } },
                shared,
                publicApiOfAnyModule,
              ],
            },
            // app.ts / server.ts: composition root.
            {
              from: { file: { categories: 'root' } },
              allow: [publicApiOfAnyModule, shared, { to: { file: { categories: 'root' } } }],
            },
          ],
        },
      ],
    },
  },

  // domain/ must not depend on frameworks or infrastructure libraries.
  {
    files: ['src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@prisma/*',
                'fastify',
                'fastify-*',
                '@fastify/*',
                'ioredis',
                'redis',
                'bullmq',
              ],
              message: 'domain/ must be framework-free (CLAUDE.md, section 4).',
            },
          ],
        },
      ],
    },
  },

  prettier,
);
