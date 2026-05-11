import { assertProductionReady, validateProductionEnvironment } from '../common/security/production-readiness';

function main(): void {
  const issues = validateProductionEnvironment(process.env);
  if (issues.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[production-check] OK');
    return;
  }

  // eslint-disable-next-line no-console
  console.error('[production-check] Falhas encontradas:');
  for (const issue of issues) {
    // eslint-disable-next-line no-console
    console.error(`- [${issue.severity}] ${issue.key}: ${issue.message}`);
  }

  assertProductionReady(process.env);
}

main();
