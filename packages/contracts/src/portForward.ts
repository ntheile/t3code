import { Schema } from "effect";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { ExecutionTargetId } from "./executionTarget";

export const PortForwardId = TrimmedNonEmptyString;
export type PortForwardId = typeof PortForwardId.Type;

const PortSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 }));

export const PortForwardProtocolHint = Schema.Literals(["http", "https", "tcp"]);
export type PortForwardProtocolHint = typeof PortForwardProtocolHint.Type;

export const PortForwardStatus = Schema.Literals(["starting", "running", "error", "closed"]);
export type PortForwardStatus = typeof PortForwardStatus.Type;

export const PortForwardSession = Schema.Struct({
  id: PortForwardId,
  targetId: ExecutionTargetId,
  threadId: Schema.optional(ThreadId),
  remoteHost: TrimmedNonEmptyString,
  remotePort: PortSchema,
  localPort: PortSchema,
  protocolHint: Schema.optional(PortForwardProtocolHint),
  label: Schema.optional(TrimmedNonEmptyString),
  status: PortForwardStatus,
  url: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastError: Schema.optional(TrimmedNonEmptyString),
});
export type PortForwardSession = typeof PortForwardSession.Type;

export const PortForwardOpenInput = Schema.Struct({
  targetId: ExecutionTargetId,
  threadId: Schema.optional(ThreadId),
  remoteHost: Schema.optional(
    TrimmedNonEmptyString.pipe(Schema.withDecodingDefault(() => "127.0.0.1")),
  ),
  remotePort: PortSchema,
  localPort: Schema.optional(PortSchema),
  protocolHint: Schema.optional(PortForwardProtocolHint),
  label: Schema.optional(TrimmedNonEmptyString),
});
export type PortForwardOpenInput = typeof PortForwardOpenInput.Type;

export const PortForwardListInput = Schema.Struct({
  targetId: Schema.optional(ExecutionTargetId),
  threadId: Schema.optional(ThreadId),
});
export type PortForwardListInput = typeof PortForwardListInput.Type;

export const PortForwardCloseInput = Schema.Struct({
  id: PortForwardId,
});
export type PortForwardCloseInput = typeof PortForwardCloseInput.Type;

export const PortForwardListResult = Schema.Array(PortForwardSession);
export type PortForwardListResult = typeof PortForwardListResult.Type;

const PortForwardEventBase = Schema.Struct({
  id: PortForwardId,
  targetId: ExecutionTargetId,
  createdAt: IsoDateTime,
});

const PortForwardOpenedEvent = Schema.Struct({
  ...PortForwardEventBase.fields,
  type: Schema.Literal("opened"),
  session: PortForwardSession,
});

const PortForwardClosedEvent = Schema.Struct({
  ...PortForwardEventBase.fields,
  type: Schema.Literal("closed"),
});

const PortForwardErrorEvent = Schema.Struct({
  ...PortForwardEventBase.fields,
  type: Schema.Literal("error"),
  message: TrimmedNonEmptyString,
});

export const PortForwardEvent = Schema.Union([
  PortForwardOpenedEvent,
  PortForwardClosedEvent,
  PortForwardErrorEvent,
]);
export type PortForwardEvent = typeof PortForwardEvent.Type;
