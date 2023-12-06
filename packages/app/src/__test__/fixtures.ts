import { Router } from 'next/router';
import type { UrlObject } from 'url';
import { LocationMock } from '@jedmao/location';

type PartialRouter = Partial<Router>;

export const BASE_URL = 'https://www.hyperdx.io';

/**
 * A Router to be used for testing which provides the bare minimum needed
 * for the useQueryParam(s) hook and NextAdapter to work.
 */
export class TestRouter implements PartialRouter {
  isReady = true;
  pathname = '/';
  private currentUrl = '';
  private history: string[] = [];

  constructor(private locationMock: LocationMock) {}

  replace = (url: string | UrlObject) => {
    this.locationMock.assign(`${BASE_URL}${url}`);
    this.currentUrl = TestRouter.getURLString(url);
    this.locationMock.assign(`${BASE_URL}${this.currentUrl}`);
    return Promise.resolve(true);
  };

  push = (url: string | UrlObject) => {
    this.history.push(this.currentUrl);
    this.currentUrl = TestRouter.getURLString(url);
    this.locationMock.assign(`${BASE_URL}${this.currentUrl}`);
    return Promise.resolve(true);
  };

  setIsReady = (isReady: boolean) => {
    this.isReady = isReady;
  };

  get asPath() {
    return this.pathname;
  }

  static getURLString(url: string | UrlObject): string {
    if (typeof url === 'string') {
      return url;
    }
    return `${url.pathname}${url.search}`;
  }

  getParams(): URLSearchParams {
    return new URL(`${BASE_URL}${this.currentUrl}`).searchParams;
  }
}
