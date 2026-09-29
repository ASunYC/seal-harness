import { createHash } from 'node:crypto';
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials';
import { z } from 'zod';
import { ProjectDataSourceTicketSchemeSchema, PROJECT_DATA_SOURCE_TICKET_MAX_LENGTH } from '../../stratex/shared/protocol/project-datasource.js';
import type { ProjectDataSourceTicketPort } from '../../stratex/main/ipc/projectDataSourceHandlers.js';

const Ticket = z.object({ ticket: z.string().min(1).max(PROJECT_DATA_SOURCE_TICKET_MAX_LENGTH), scheme: ProjectDataSourceTicketSchemeSchema });
const prefix = (accountKey: string) => `ticket-${createHash('sha256').update(accountKey).digest('hex')}-`;

/** 使用产品已有 credentials provider；账号键不由 renderer 指定。 */
export function projectTickets(credentials: CredentialProvider): ProjectDataSourceTicketPort {
  const key = (input: { accountKey: string; dataSourceId: string }) => credentialKey('seal-harness-projects', prefix(input.accountKey) + input.dataSourceId);
  return {
    async save(input) {
      const payload = Ticket.parse({ ticket: input.ticket, scheme: input.scheme });
      await credentials.modifyRecord(key(input), async () => ({ kind: 'grant', payload }));
    },
    async remove(input) { await credentials.deleteRecord(key(input)); },
    async resolve(input) {
      const record = await credentials.readRecord(key(input));
      return record?.kind === 'grant' ? Ticket.parse(record.payload) : null;
    },
    async listDataSourceIds(accountKey) {
      const start = `seal-harness-projects/${prefix(accountKey)}`;
      return (await credentials.listRecords()).filter(row => row.key.startsWith(start)).map(row => row.key.slice(start.length));
    },
  };
}
