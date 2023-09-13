export enum StatusCode {
  OK = 200,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  INTERNAL_SERVER = 500,
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

export const isOperationalError = (error: Error) => {
  if (error instanceof BaseError) {
    return error.isOperational;
  }
  return false;
};
