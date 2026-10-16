import { execSync } from 'node:child_process';

/**
 * The E2E specs run against dist-app/PowerBoard.html, so the file has to exist
 * before any browser opens it. Building here keeps `npx playwright test`
 * self-contained on a fresh clone (CI runs `npm run build:app` first, which
 * just rebuilds the same file).
 */
export default function globalSetup(): void {
  execSync('npm run build:app', { stdio: 'inherit' });
}
