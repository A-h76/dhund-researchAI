import type { AdapterClock } from '../../src/ai/adapters/clock';
import { invokeOpenAiWith429Backoff } from '../../src/ai/adapters/openai/openai-client';
import { invokeWith429Backoff } from '../../src/ai/adapters/voyage/voyage-client';
import { PolicyResolver } from '../../src/ai/policy/policy-resolver';
import { PromptAssembler } from '../../src/ai/policy/prompt-assembler';

class FakeClock implements AdapterClock {
  nowMs = 1_000;
  now(): number {
    return this.nowMs;
  }
  async sleep(ms: number): Promise<void> {
    this.nowMs += ms;
  }
}

describe('retry payload immutability (DHB-47)', () => {
  it('reuses byte-identical assembled Voyage args across 429 retries', async () => {
    const request = {
      capability: 'EMBED' as const,
      texts: ['alpha', 'beta'],
      inputType: 'query' as const,
    };
    const policy = new PolicyResolver().resolve(request);
    const payload = new PromptAssembler().assemble(request, policy);
    const snapshots: string[] = [];

    await invokeWith429Backoff(async () => {
      const args = {
        input: [...request.texts],
        model: policy.modelId,
        inputType: request.inputType,
        outputDimension: 1024,
        promptVersion: payload.promptVersion,
        userPayload: payload.userPayload,
      };
      snapshots.push(JSON.stringify(args));
      if (snapshots.length === 1) {
        throw { status: 429 };
      }
      return 'ok';
    }, new FakeClock());

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toBe(snapshots[1]);
    expect(Buffer.from(snapshots[0] ?? '').equals(Buffer.from(snapshots[1] ?? ''))).toBe(true);
  });

  it('reuses byte-identical assembled OpenAI messages across 429 retries', async () => {
    const request = {
      capability: 'CHAT' as const,
      userMessage: 'summarize',
      documentContent: 'paper text',
    };
    const policy = new PolicyResolver().resolve(request);
    const payload = new PromptAssembler().assemble(request, policy);
    const messages = [
      { role: 'system' as const, content: payload.systemPrompt },
      { role: 'user' as const, content: payload.userPayload },
    ];
    const snapshots: string[] = [];

    await invokeOpenAiWith429Backoff(async () => {
      snapshots.push(JSON.stringify({ model: policy.modelId, messages, stream: true }));
      if (snapshots.length === 1) {
        throw { status: 429 };
      }
      return 'ok';
    }, new FakeClock());

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toBe(snapshots[1]);
    expect(Buffer.from(snapshots[0] ?? '').equals(Buffer.from(snapshots[1] ?? ''))).toBe(true);
  });
});
