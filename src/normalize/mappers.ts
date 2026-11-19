// One pure mapper per NormalizerId. Ported in spirit from the prototype
// (SocialLens/src/domain/normalize.ts); time, engagement and envelope checks live in index.ts.
import type { AtUri, Did, JsonObject, RecordKind, SkipReasonCode } from '../shared';
import type { NormalizerId } from '../registry/contract';
import {
  clipText,
  field,
  isPlainObject,
  readAtUri,
  readDid,
  readOptionalAtUri,
  readOptionalString,
  readString,
  readTags,
} from './fields';

export interface MappedFields {
  readonly kind: RecordKind;
  readonly title: string | null;
  readonly text: string | null;
  readonly subjectUri: AtUri | null;
  readonly subjectDid: Did | null;
  readonly tags: readonly string[];
}

export interface MapperSkip {
  readonly reasonCode: Extract<SkipReasonCode, 'missing-required-field' | 'invalid-field'>;
  readonly detail: string;
}

export type MapOutcome = { readonly ok: true; readonly fields: MappedFields } | ({ readonly ok: false } & MapperSkip);

export type Mapper = (value: JsonObject) => MapOutcome;

const base: MappedFields = { kind: 'post', title: null, text: null, subjectUri: null, subjectDid: null, tags: [] };
const good = (f: Partial<MappedFields> & { kind: RecordKind }): MapOutcome => ({ ok: true, fields: { ...base, ...f } });
const bad = (r: MapperSkip): MapOutcome => ({ ok: false, reasonCode: r.reasonCode, detail: r.detail });
const optText = (v: string | null): string | null => (v === null ? null : clipText(v));

const post: Mapper = (v) => {
  const text = readString(v, 'text');
  if (!text.ok) return bad(text);
  const isReply = isPlainObject(field(v, 'reply'));
  return good({
    kind: isReply ? 'reply' : 'post',
    text: clipText(text.value),
    subjectUri: isReply ? readOptionalAtUri(field(v, 'reply'), 'parent.uri') : null,
    tags: readTags(v, true),
  });
};

const subjectUriMapper =
  (kind: 'repost' | 'like'): Mapper =>
  (v) => {
    const s = readAtUri(v, 'subject.uri');
    return s.ok ? good({ kind, subjectUri: s.value }) : bad(s);
  };

const subjectDidMapper =
  (kind: 'follow' | 'block'): Mapper =>
  (v) => {
    const s = readDid(v, 'subject');
    return s.ok ? good({ kind, subjectDid: s.value }) : bad(s);
  };

const list: Mapper = (v) => {
  const name = readString(v, 'name');
  if (!name.ok) return bad(name);
  const purpose = readString(v, 'purpose');
  if (!purpose.ok) return bad(purpose);
  return good({ kind: 'list', title: clipText(name.value), text: optText(readOptionalString(v, 'description')) });
};

const listitem: Mapper = (v) => {
  const subject = readDid(v, 'subject');
  if (!subject.ok) return bad(subject);
  const l = readAtUri(v, 'list');
  if (!l.ok) return bad(l);
  return good({ kind: 'list-item', subjectDid: subject.value, subjectUri: l.value });
};

const profile: Mapper = (v) =>
  good({
    kind: 'profile',
    title: optText(readOptionalString(v, 'displayName')),
    text: optText(readOptionalString(v, 'description')),
  });

const document: Mapper = (v) => {
  const title = readString(v, 'title');
  if (!title.ok) return bad(title);
  const site = readString(v, 'site');
  if (!site.ok) return bad(site);
  const text = readOptionalString(v, 'description') ?? readOptionalString(v, 'textContent');
  return good({
    kind: 'document',
    title: clipText(title.value),
    text: optText(text),
    subjectUri: readOptionalAtUri(v, 'site'),
    tags: readTags(v, false),
  });
};

const publication: Mapper = (v) => {
  const name = readString(v, 'name');
  if (!name.ok) return bad(name);
  const url = readString(v, 'url');
  if (!url.ok) return bad(url);
  return good({ kind: 'publication', title: clipText(name.value), text: optText(readOptionalString(v, 'description')) });
};

export const MAPPERS: Readonly<Record<NormalizerId, Mapper>> = {
  'bsky.post': post,
  'bsky.repost': subjectUriMapper('repost'),
  'bsky.like': subjectUriMapper('like'),
  'bsky.follow': subjectDidMapper('follow'),
  'bsky.block': subjectDidMapper('block'),
  'bsky.list': list,
  'bsky.listitem': listitem,
  'bsky.profile': profile,
  'standard.document': document,
  'standard.publication': publication,
};
