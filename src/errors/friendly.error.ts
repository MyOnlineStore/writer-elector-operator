
export class FriendlyError extends Error {

  constructor(message: string) {
    super(message);
    Error.apply(this, arguments as any);
    Object.setPrototypeOf(this, FriendlyError.prototype);
  }

}
