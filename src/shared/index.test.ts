import { describe, expect, it } from 'vitest';
import * as shared from './index';

const API_NAMES = [
  'ok', 'err', 'makeFailure', 'isAbortError',
  'parseDid', 'didMethodOf', 'parseHandle', 'parseNsid', 'parseRecordKey', 'parseCid', 'parseAtUri', 'makeAtUri', 'parseHttpsOrigin',
  'parseIsoDateTime', 'isoDateOf', 'tidToIsoDateTime',
  'checkSelf',
  'createHttpClient', 'buildXrpcUrl',
  'citation', 'statusLabelFor', 'GLOSSARY', 'metricDefinition',
  'systemClock', 'realSleep',
];

describe('index', () => {
  it('exports every SharedApi member', () => {
    for (const name of API_NAMES) expect(shared, name).toHaveProperty(name);
  });
  it('re-exports the contract data', () => {
    expect(shared.LIMITS.httpTimeoutMs).toBe(10_000);
    expect(shared.METRIC_IDS).toHaveLength(19);
    expect(shared.ORIGINS.appView).toBe('https://public.api.bsky.app');
  });
});
