import {
  PortForwardCloseInput,
  PortForwardEvent,
  PortForwardListInput,
  PortForwardOpenInput,
  PortForwardSession,
} from "@t3tools/contracts";
import { Effect, Schema, ServiceMap } from "effect";

export class PortForwardError extends Schema.TaggedErrorClass<PortForwardError>()(
  "PortForwardError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface PortForwardManagerShape {
  readonly open: (
    input: PortForwardOpenInput,
  ) => Effect.Effect<PortForwardSession, PortForwardError>;
  readonly list: (
    input?: PortForwardListInput,
  ) => Effect.Effect<ReadonlyArray<PortForwardSession>, PortForwardError>;
  readonly close: (input: PortForwardCloseInput) => Effect.Effect<void, PortForwardError>;
  readonly subscribe: (listener: (event: PortForwardEvent) => void) => Effect.Effect<() => void>;
  readonly dispose: Effect.Effect<void>;
}

export class PortForwardManager extends ServiceMap.Service<
  PortForwardManager,
  PortForwardManagerShape
>()("t3/portForward/Services/PortForwardManager") {}
