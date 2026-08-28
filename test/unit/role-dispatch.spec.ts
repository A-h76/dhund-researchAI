import { RuntimeRole, parseRole } from '../../src/platform/runtime/role';

describe('parseRole', () => {
  it('parses api role', () => {
    expect(parseRole(['node', 'main.js', '--role', 'api'])).toBe(RuntimeRole.Api);
  });

  it('parses worker role', () => {
    expect(parseRole(['node', 'main.js', '--role', 'worker'])).toBe(RuntimeRole.Worker);
  });

  it('parses worker role with equals syntax', () => {
    expect(parseRole(['node', 'main.js', '--role=worker'])).toBe(RuntimeRole.Worker);
  });

  it('parses api role with equals syntax', () => {
    expect(parseRole(['node', 'main.js', '--role=api'])).toBe(RuntimeRole.Api);
  });

  it('throws when role is missing', () => {
    expect(() => parseRole(['node', 'main.js'])).toThrow('Missing required argument');
  });

  it('throws when role is invalid', () => {
    expect(() => parseRole(['node', 'main.js', '--role', 'batch'])).toThrow('Invalid role');
  });
});
