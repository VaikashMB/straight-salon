// `npm run sonar:setup` (10-testing-and-quality §5.1, §5.4): one-time, idempotent setup of the
// local SonarQube from `npm run sonar:up`, replacing the manual first-login steps:
//   1. if the server still accepts admin/admin, changes the admin password to
//      SONAR_ADMIN_PASSWORD (repo-root .env; required);
//   2. creates the project `straight-salon`;
//   3. creates/updates the quality gate "Straight Salon Way" and assigns it to the project;
//   4. if SONAR_TOKEN is empty in .env, generates a project analysis token and writes it there
//      (never printed).
import { readFileSync, writeFileSync } from 'node:fs';

const HOST = process.env.SONAR_HOST_URL || 'http://localhost:9000';
const PROJECT = 'straight-salon';
const GATE = 'Straight Salon Way';
const TOKEN_NAME = 'straight-salon-local';
const ENV_FILE = '.env';

// 10 §1 and §5.4. Ratings: 1 = A … 5 = E; "> 3" fails on any Blocker/Critical (High) issue.
// Each condition lists the MQR metric first and the classic one as the fallback.
const CONDITIONS = [
  { metric: ['new_coverage'], op: 'LT', error: '80' },
  { metric: ['coverage'], op: 'LT', error: '80' },
  { metric: ['new_duplicated_lines_density'], op: 'GT', error: '3' },
  {
    metric: ['new_software_quality_reliability_rating', 'new_reliability_rating'],
    op: 'GT',
    error: '1',
  },
  { metric: ['new_software_quality_security_rating', 'new_security_rating'], op: 'GT', error: '1' },
  {
    metric: ['new_software_quality_maintainability_rating', 'new_maintainability_rating'],
    op: 'GT',
    error: '1',
  },
  { metric: ['new_security_hotspots_reviewed'], op: 'LT', error: '100' },
  { metric: ['software_quality_reliability_rating', 'reliability_rating'], op: 'GT', error: '3' },
  { metric: ['software_quality_security_rating', 'security_rating'], op: 'GT', error: '3' },
  { metric: ['software_quality_maintainability_rating', 'sqale_rating'], op: 'GT', error: '1' },
];

const adminPassword = process.env.SONAR_ADMIN_PASSWORD;
if (!adminPassword) {
  process.stderr.write('[sonar:setup] Set SONAR_ADMIN_PASSWORD in .env (local SonarQube admin).\n');
  process.exit(1);
}

async function call(method, path, params, password = adminPassword) {
  const url = new URL(path, HOST);
  const body = params ? new URLSearchParams(params) : undefined;
  if (method === 'GET' && body) url.search = body.toString();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}` },
    body: method === 'GET' ? undefined : body,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : {} };
}

async function must(method, path, params) {
  const res = await call(method, path, params);
  if (!res.ok) {
    const message = res.data.errors?.map((e) => e.msg).join('; ') ?? res.status;
    throw new Error(`${method} ${path}: ${message}`);
  }
  return res.data;
}

const log = (msg) => process.stdout.write(`[sonar:setup] ${msg}\n`);

// 1. Admin password: succeeds only while the server still has the default admin/admin.
const changed = await call(
  'POST',
  '/api/users/change_password',
  { login: 'admin', previousPassword: 'admin', password: adminPassword },
  'admin',
);
if (changed.ok) log('changed the default admin password to SONAR_ADMIN_PASSWORD');
const admin = await call('GET', '/api/projects/search', { projects: PROJECT });
if (admin.status === 401 || admin.status === 403) {
  throw new Error('SONAR_ADMIN_PASSWORD is not the SonarQube admin password');
}

// 2. Project
const projects = await must('GET', '/api/projects/search', { projects: PROJECT });
if (projects.components.length === 0) {
  await must('POST', '/api/projects/create', { project: PROJECT, name: 'Straight Salon' });
  log(`created project ${PROJECT}`);
}

// 3. Quality gate
const available = new Set(
  (await must('GET', '/api/metrics/search', { ps: '500' })).metrics.map((m) => m.key),
);
const existing = await call('GET', '/api/qualitygates/show', { name: GATE });
if (!existing.ok) await must('POST', '/api/qualitygates/create', { name: GATE });
// A new gate starts with the server's default conditions, so read it back either way.
const { conditions: current } = await must('GET', '/api/qualitygates/show', { name: GATE });
for (const condition of CONDITIONS) {
  const metric = condition.metric.find((key) => available.has(key));
  if (!metric) throw new Error(`None of ${condition.metric.join(', ')} exists on this server`);
  const params = { op: condition.op, error: condition.error };
  const found = current.find((c) => c.metric === metric);
  if (found)
    await must('POST', '/api/qualitygates/update_condition', { id: found.id, metric, ...params });
  else
    await must('POST', '/api/qualitygates/create_condition', { gateName: GATE, metric, ...params });
}
await must('POST', '/api/qualitygates/select', { gateName: GATE, projectKey: PROJECT });
log(`quality gate "${GATE}" (${CONDITIONS.length} conditions) assigned to ${PROJECT}`);

// 4. Analysis token
const env = readFileSync(ENV_FILE, 'utf8');
if (/^SONAR_TOKEN=\S+/m.test(env)) {
  log('SONAR_TOKEN already set in .env; left unchanged');
} else {
  await call('POST', '/api/user_tokens/revoke', { name: TOKEN_NAME });
  const { token } = await must('POST', '/api/user_tokens/generate', {
    name: TOKEN_NAME,
    type: 'PROJECT_ANALYSIS_TOKEN',
    projectKey: PROJECT,
  });
  const updated = /^SONAR_TOKEN=.*$/m.test(env)
    ? env.replace(/^SONAR_TOKEN=.*$/m, `SONAR_TOKEN=${token}`)
    : `${env.trimEnd()}\nSONAR_TOKEN=${token}\n`;
  writeFileSync(ENV_FILE, updated);
  log('generated a project analysis token into .env (SONAR_TOKEN)');
}
