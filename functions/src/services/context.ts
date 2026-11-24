import type { PaymentGateway, Store } from "../domain/ports";

export interface Ctx {
  store: Store;
  gateway: PaymentGateway;
  now: () => Date;
}

export interface Caller {
  uid: string;
  email?: string;
  name?: string;
  isOwner: boolean;
}
