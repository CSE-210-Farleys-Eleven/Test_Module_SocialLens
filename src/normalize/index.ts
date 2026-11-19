import type { CreateNormalizer, NormalizeInput, NormalizeResult } from './contract';
import type { CollectionDefinition } from '../registry/contract';
import { parseAtUri, parseIsoDateTime, tidToIsoDateTime } from '../shared';
import type { ActivityRecord, AtUri, Engagement, IsoDateTime, Nsid, RawRecord, SkippedRecord, SkipReasonCode } from '../shared';
import { field } from './fields';
import { MAPPERS } from './mappers';

const NOT_REQUESTED: Engagement = { status: 'unknown', reason: 'not-requested' };

type Outcome = { readonly record: ActivityRecord } | { readonly skip: SkippedRecord };

function skip(raw: RawRecord, reasonCode: SkipReasonCode, detail: string): Outcome {
  return {
    skip: {
      uri: typeof raw?.uri === 'string' ? raw.uri : null,
      collection: raw?.collection,
      stage: 'normalize',
      reasonCode,
      detail,
    },
  };
}

export const createNormalizer: CreateNormalizer = ({ registry }) => ({
  normalize(input: NormalizeInput): NormalizeResult {
    const engagementByUri = new Map<string, Engagement>();
    try {
      for (const r of input.engagement) {
        if (typeof r?.uri === 'string' && !engagementByUri.has(r.uri)) engagementByUri.set(r.uri, r.engagement);
      }
    } catch {
      // malformed engagement list: affected records fall back to unknown / not-requested
    }

    const records: ActivityRecord[] = [];
    const skipped: SkippedRecord[] = [];
    for (const raw of input.records) {
      let out: Outcome;
      try {
        out = normalizeOne(raw);
      } catch {
        out = skip(raw, 'invalid-field', 'unexpected record shape');
      }
      if ('record' in out) records.push(out.record);
      else skipped.push(out.skip);
    }
    return { records, skipped };

    function normalizeOne(raw: RawRecord): Outcome {
      const def: CollectionDefinition | null = registry.collection(raw.collection);
      if (def === null) return skip(raw, 'unregistered-collection', 'collection is not registered');

      const parsed = parseAtUri(raw.uri);
      if (parsed === null) return skip(raw, 'invalid-field', 'uri is not an AT-URI');
      if (parsed.did !== input.did) return skip(raw, 'foreign-owner', 'uri belongs to a different account');
      if (parsed.collection !== raw.collection) return skip(raw, 'wrong-collection', 'uri collection differs from the record collection');

      const type = field(raw.value, '$type');
      if (type !== undefined && type !== def.nsid) {
        return skip(raw, 'type-mismatch', '$type does not match the collection');
      }

      const mapped = MAPPERS[def.normalizerId](raw.value);
      if (!mapped.ok) return skip(raw, mapped.reasonCode, mapped.detail);

      let createdAt: IsoDateTime | null = null;
      if (def.timestampField !== null) createdAt = parseIsoDateTime(field(raw.value, def.timestampField));

      let engagement: Engagement;
      if (def.engagementSource === null) engagement = { status: 'not-available' };
      else engagement = engagementByUri.get(raw.uri) ?? NOT_REQUESTED;

      const f = mapped.fields;
      const record: ActivityRecord = {
        uri: raw.uri as AtUri,
        cid: raw.cid,
        did: input.did,
        collection: raw.collection as Nsid,
        rkey: raw.rkey,
        app: def.appId,
        kind: f.kind,
        createdAt,
        timeSource: createdAt !== null && def.timestampField !== null ? def.timestampField : 'none',
        rkeyTime: tidToIsoDateTime(raw.rkey),
        title: f.title,
        text: f.text,
        subjectUri: f.subjectUri,
        subjectDid: f.subjectDid,
        tags: [...f.tags],
        engagement,
      };
      return { record };
    }
  },
});
