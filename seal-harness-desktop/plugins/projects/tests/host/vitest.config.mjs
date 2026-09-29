import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const desktopRequire = createRequire(new URL('../../../../../dsh-plugin-desktop-beta/package.json', import.meta.url));
const names = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-credentials-local', '@deepseek-ai/dsh-home-paths', 'zod', 'unzipper'];
export default {
  root: fileURLToPath(new URL('../../../../../', import.meta.url)),
  resolve: { alias: names.map(name => ({ find: new RegExp(`^${name}$`), replacement: desktopRequire.resolve(name) })) },
  test: { include: ['seal-harness-desktop/plugins/projects/tests/**/*.test.ts'], maxWorkers: 4 },
};
