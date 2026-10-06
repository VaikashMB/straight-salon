// Conventional Commits with the project's type and scope lists (12-automation-and-ci §1).
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'chore', 'docs', 'test', 'refactor', 'perf', 'ci', 'build'],
    ],
    'scope-enum': [
      2,
      'always',
      [
        // business modules
        'auth',
        'users',
        'settings',
        'catalog',
        'staff',
        'holidays',
        'availability',
        'booking',
        'payments',
        'reviews',
        'notifications',
        'reports',
        'audit',
        'health',
        // cross-cutting / repo
        'shared',
        'config',
        'jobs',
        'workers',
        'backend',
        'frontend',
        'infra',
        'docker',
        'ci',
        'deps',
        'docs',
        'repo',
      ],
    ],
  },
};
