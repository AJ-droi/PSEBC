export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);
export const unauthorised = (msg = 'Please sign in') => new AppError(401, 'unauthorised', msg);
export const forbidden = (msg = 'You don’t have access to this') => new AppError(403, 'forbidden', msg);
export const notFound = (what = 'That item') => new AppError(404, 'not_found', `${what} was not found`);
export const conflict = (msg: string) => new AppError(409, 'conflict', msg);
