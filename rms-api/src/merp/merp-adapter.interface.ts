import { CreditMemoPayload, ReplacementOrderPayload, MerpResult } from './merp.types.js';

// Abstract class (not interface) so NestJS DI can use it as an injection token.
// Both MerpStubAdapter (v1) and MerpLiveAdapter (v2) extend this class.
// Services inject MerpAdapter — never a concrete implementation directly.
export abstract class MerpAdapter {
  abstract createCreditMemo(payload: CreditMemoPayload): Promise<MerpResult>;
  abstract createReplacementOrder(payload: ReplacementOrderPayload): Promise<MerpResult>;
}
