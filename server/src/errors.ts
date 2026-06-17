export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = 'APP_ERROR'
  ) {
    super(message)
  }
}

export function appError(statusCode: number, message: string, code?: string) {
  return new AppError(statusCode, message, code)
}
