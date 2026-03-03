export class ThenvoiSdkError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ThenvoiSdkError";
    this.cause = cause;
  }
}

export class UnsupportedFeatureError extends ThenvoiSdkError {
  public constructor(message: string) {
    super(message);
    this.name = "UnsupportedFeatureError";
  }
}

export class ValidationError extends ThenvoiSdkError {
  public constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "ValidationError";
  }
}

export class TransportError extends ThenvoiSdkError {
  public constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "TransportError";
  }
}

export class RuntimeStateError extends ThenvoiSdkError {
  public constructor(message: string) {
    super(message);
    this.name = "RuntimeStateError";
  }
}
