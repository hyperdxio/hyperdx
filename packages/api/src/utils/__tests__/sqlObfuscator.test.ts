import * as childProcess from 'child_process';

import { getChild, sqlObfuscator } from '../sqlObfuscator';

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

  it('handles multiple statements in one line', async () => {
    expect(
      await sqlObfuscator(
        `SELECT * from users as should_be_removed where name = 'Carl' limit 1 order by name asc; SELECT * from users /* standard comment, really */ where name = 'Carl' limit 1 order by name asc;\n`,
      ),
    ).toEqual(
      `SELECT * from users where name = ? limit ? order by name asc; SELECT * from users where name = ? limit ? order by name asc`.replace(
        /(\r\n|\n|\r)/gm,
        ' ',
      ) + '\n',
    );
  });

  it('handles if the subprocess dies', async () => {
    const subprocess = getChild();
    subprocess.kill();
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
    expect(subprocess).not.toBe(getChild());
  });
});
