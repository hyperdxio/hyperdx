export enum StatusCode {
  BAD_REQUEST = 400,
  CONFLICT = 409,
  CONTENT_TOO_LARGE = 413,
  FORBIDDEN = 403,
  INTERNAL_SERVER = 500,
  NOT_FOUND = 404,
  OK = 200,
  UNAUTHORIZED = 401,
}

export class BaseError extends Error {
  name: string;

  statusCode: StatusCode;

  isOperational: boolean;

  constructor(
    name: string,
    statusCode: StatusCode,
    isOperational: boolean,
    description: string,
  ) {
    super(description);

    Object.setPrototypeOf(this, BaseError.prototype);

    this.name = name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
  }
}

export class Api500Error extends BaseError {
  constructor(name: string) {
    super(name, StatusCode.INTERNAL_SERVER, true, 'Internal Server Error');
  }
}

export class Api400Error extends BaseError {
  constructor(name: string) {
    super(name, StatusCode.BAD_REQUEST, true, 'Bad Request');
  }
}

export class Api404Error extends BaseError {
  constructor(name: string) {
    super(name, StatusCode.NOT_FOUND, true, 'Not Found');
  }
}

export class Api401Error extends BaseError {
  constructor(name: string) {
    super(name, StatusCode.UNAUTHORIZED, true, 'Unauthorized');
  }
}

export class Api403Error extends BaseError {
  constructor(name: string) {
    super(name, StatusCode.FORBIDDEN, true, 'Forbidden');
  }
}

export class Api409Error extends BaseError {
  constructor(name: string) {
    super(name, StatusCode.CONFLICT, true, 'Conflict');
  }
}

export const isOperationalError = (error: Error) => {
  if (error instanceof BaseError) {
    return error.isOperational;
  }
  return false;
};
