import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectNotificationSettingsSchema } from '../../stratex/shared/protocol/project-notifications.js';
import type { ProjectNotificationSettingsPort } from '../../stratex/main/ipc/projectCollabHandlers.js';
import type { ProjectService } from './service.js';

export function notificationSettings(home: string, projects: ProjectService): ProjectNotificationSettingsPort {
  const directory = join(home, 'projects', 'preferences');
  const path = () => {
    const account = projects.getAccount();
    if (!account) throw new Error('请先登录');
    return join(directory, createHash('sha256').update(account.accountKey).digest('hex') + '.json');
  };
  return {
    read() {
      try { return ProjectNotificationSettingsSchema.parse(JSON.parse(readFileSync(path(), 'utf8'))); }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { desktopNotifications: true };
        throw error;
      }
    },
    write(settings) {
      const target = path();
      mkdirSync(directory, { recursive: true });
      writeFileSync(target + '.tmp', JSON.stringify(settings));
      renameSync(target + '.tmp', target);
      return settings;
    },
  };
}
