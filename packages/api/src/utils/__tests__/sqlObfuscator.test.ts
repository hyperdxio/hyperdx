import * as childProcess from 'child_process';

import { sqlObfuscator } from '../sqlObfuscator';

describe('logParser', () => {
  it('obfuscates a basic query', async () => {
    const n = 1;
    const start = Date.now();
    for (let i = 0; i < n; i++) {
      expect(
        await sqlObfuscator(
          `SELECT * from users where name = 'Carl' limit 1 order by name asc;\n`,
        ),
      ).toEqual(
        `SELECT * from users where name = ? limit ? order by name asc`.replace(
          /(\r\n|\n|\r)/gm,
          ' ',
        ) + '\n',
      );
    }
    const end = Date.now();
    //console.log(`Took ${(end - start) / n}ms`);
  });
});
