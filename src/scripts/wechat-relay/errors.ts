export class SafeRelayError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SafeRelayError";
  }
}
export class AmbiguousDeliveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AmbiguousDeliveryError";
  }
}
