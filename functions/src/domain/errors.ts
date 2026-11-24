/** Codes match Firebase callable error codes so they reach the client unchanged. */
export type ErrorCode =
  | "invalid-argument"
  | "failed-precondition"
  | "permission-denied"
  | "unauthenticated"
  | "not-found"
  | "resource-exhausted"
  | "already-exists"
  | "internal";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    /** Machine-readable reason the client can branch on, e.g. "terms-required". */
    public readonly reason?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
