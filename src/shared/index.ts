// Public runtime API of `shared/` (M8). Other modules import functions from here and
// types / `as const` data from './contract' (also re-exported below).

import type { SharedApi } from './contract';
import { citation, GLOSSARY, metricDefinition, statusLabelFor } from './glossary';
import { checkSelf } from './guards';
import { buildXrpcUrl, createHttpClient } from './http';
import { err, isAbortError, makeFailure, ok } from './result';
import {
  didMethodOf,
  makeAtUri,
  parseAtUri,
  parseCid,
  parseDid,
  parseHandle,
  parseHttpsOrigin,
  parseNsid,
  parseRecordKey,
} from './syntax';
import { isoDateOf, parseIsoDateTime, realSleep, systemClock, tidToIsoDateTime } from './time';

export * from './contract';

export {
  ok,
  err,
  makeFailure,
  isAbortError,
  parseDid,
  didMethodOf,
  parseHandle,
  parseNsid,
  parseRecordKey,
  parseCid,
  parseAtUri,
  makeAtUri,
  parseHttpsOrigin,
  parseIsoDateTime,
  isoDateOf,
  tidToIsoDateTime,
  checkSelf,
  createHttpClient,
  buildXrpcUrl,
  citation,
  statusLabelFor,
  GLOSSARY,
  metricDefinition,
  systemClock,
  realSleep,
};

({
  ok,
  err,
  makeFailure,
  isAbortError,
  parseDid,
  didMethodOf,
  parseHandle,
  parseNsid,
  parseRecordKey,
  parseCid,
  parseAtUri,
  makeAtUri,
  parseHttpsOrigin,
  parseIsoDateTime,
  isoDateOf,
  tidToIsoDateTime,
  checkSelf,
  createHttpClient,
  buildXrpcUrl,
  citation,
  statusLabelFor,
  GLOSSARY,
  metricDefinition,
  systemClock,
  realSleep,
}) satisfies SharedApi;
