import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { QUEUE_NAMES } from '../../src/platform/queues/queue-names';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

function collectTs(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...collectTs(full));
      continue;
    }
    if (entry.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

describe('DHB-62 Paper Chat static checks', () => {
  it('GAP-INTERACTIVE-STREAM-01: no chat queue; chat path never enqueues', () => {
    expect(QUEUE_NAMES as readonly string[]).not.toContain('chat');
    expect(QUEUE_NAMES as readonly string[]).not.toContain('autocomplete');
    const paperChat = read('src/orchestration/paper-chat.service.ts');
    expect(paperChat).not.toMatch(/QUEUE_SERVICE|JobEnqueueService|addJob|enqueue\(/);
    expect(paperChat).toContain('RETRIEVAL_SERVICE');
    expect(paperChat).toContain('CHAT_GATEWAY');
    const adapter = read('src/ai/chat/chat-gateway.adapter.ts');
    expect(adapter).toContain("capability: 'CHAT'");
    expect(adapter).toContain('GATEWAY_SERVICE');
    expect(adapter).not.toMatch(/QUEUE_SERVICE|addJob|enqueue\(/);
  });

  it('GAP-INTERACTIVE-STREAM-01: no API route starts long-running research', () => {
    const controllers = collectTs(SRC).filter((file) => file.endsWith('.controller.ts'));
    const violations: string[] = [];
    for (const file of controllers) {
      const content = readFileSync(file, 'utf8');
      if (
        /research-run-tick|research-run-step|JobEnqueueService|QUEUE_SERVICE/.test(content) &&
        /research/i.test(content)
      ) {
        violations.push(relative(ROOT, file).replace(/\\/g, '/'));
      }
    }
    expect(violations).toEqual([]);
    const capability = read('src/apps/api/capability-probe.controller.ts');
    expect(capability).toContain("@Controller('capabilities')");
    expect(capability).toContain("@Get('research-runs')");
    expect(capability).not.toMatch(/enqueue|QUEUE_SERVICE|JobEnqueue/);
  });

  it('GAP-CONV-01: assistant complete requires ai_execution_id; binding tables stay disjoint', () => {
    const conversationsSql = read(
      'prisma/migrations/20250829131800_018_conversations/migration.sql',
    );
    expect(conversationsSql).toContain('chk_message_assistant_provenance');
    expect(conversationsSql).toContain('messages_conversation_id_sequence_key');
    expect(conversationsSql).toContain('message_evidence_bindings');
    const writingSql = read('prisma/migrations/20250829131700_017_writing/migration.sql');
    expect(writingSql).toContain('writing_sentence_bindings');
    expect(writingSql).not.toContain('message_evidence_bindings');
    expect(conversationsSql).not.toContain('writing_sentence_bindings');
  });

  it('persists retrieval_trace_id on CHAT executions', () => {
    const migration = read(
      'prisma/migrations/20250829132300_023_chat_retrieval_link/migration.sql',
    );
    expect(migration).toContain('retrieval_trace_id');
    expect(migration).toContain('ON DELETE RESTRICT');
    const gateway = read('src/ai/gateway/gateway.service.ts');
    expect(gateway).toContain('retrievalTraceId');
  });

  it('streams message:token then message:complete over Socket.IO', () => {
    const sink = read('src/apps/api/socket-chat-stream.sink.ts');
    expect(sink).toContain("message:token");
    expect(sink).toContain("message:complete");
    expect(sink).toContain('safeEmit');
  });
});
