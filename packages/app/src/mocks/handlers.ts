import { http, HttpResponse } from 'msw';

const API_URL = 'http://localhost:8000';

export const makeHandler = (path: string, response: any) => {
  return http.get(`${API_URL}${path}`, () => {
    return HttpResponse.json(response);
  });
};

export const meHandler = makeHandler('/me', {
  name: 'Mister Test',
  team: {
    name: 'Test.io',
  },
});
