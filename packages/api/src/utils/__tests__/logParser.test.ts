import { mapObjectToKeyValuePairs, traverseJson } from '../logParser';

describe('logParser', () => {
  it('traverseJson', () => {
    const jsonIt = traverseJson({
      foo: {
        bar: 'bar',
        foo1: {
          foo1: 'bar1',
          foo2: {
            bar2: 'bar2',
          },
        },
      },
    });
    const keys: any[] = [];
    const values: any[] = [];
    for (const [key, value] of jsonIt) {
      keys.push(key);
      values.push(value);
    }

    expect(keys).toEqual([
      ['foo'],
      ['foo', 'bar'],
      ['foo', 'foo1'],
      ['foo', 'foo1', 'foo1'],
      ['foo', 'foo1', 'foo2'],
      ['foo', 'foo1', 'foo2', 'bar2'],
    ]);
    expect(values).toEqual([
      {
        bar: 'bar',
        foo1: {
          foo1: 'bar1',
          foo2: {
            bar2: 'bar2',
          },
        },
      },
      'bar',
      {
        foo1: 'bar1',
        foo2: {
          bar2: 'bar2',
        },
      },
      'bar1',
      {
        bar2: 'bar2',
      },
      'bar2',
    ]);
  });

  describe('mapObjectToKeyValuePairs', () => {
    it('obeys basic serialization', async () => {
      expect(await mapObjectToKeyValuePairs(null as any)).toEqual({
        'bool.names': [],
        'bool.values': [],
        'number.names': [],
        'number.values': [],
        'string.names': [],
        'string.values': [],
      });

      expect(await mapObjectToKeyValuePairs({})).toEqual({
        'bool.names': [],
        'bool.values': [],
        'number.names': [],
        'number.values': [],
        'string.names': [],
        'string.values': [],
      });

      expect(
        await mapObjectToKeyValuePairs({ foo: '123', foo1: 123, foo2: false }),
      ).toEqual({
        'bool.names': ['foo2'],
        'bool.values': [0],
        'number.names': ['foo1'],
        'number.values': [123],
        'string.names': ['foo'],
        'string.values': ['123'],
      });

      expect(
        await mapObjectToKeyValuePairs({
          foo: '123',
          foo1: 123,
          foo2: false,
          nested: { foo: 'bar' },
          good: {
            burrito: {
              is: true,
            },
          },
          array1: [456],
          array2: [
            'foo1',
            {
              foo2: 'bar2',
            },
            [
              {
                foo3: 'bar3',
              },
            ],
          ],
        }),
      ).toMatchSnapshot();

      const testObject = {};
      for (let i = 0; i < 2000; i++) {
        testObject[`foo${i}`] = i;
      }
      const result = await mapObjectToKeyValuePairs(testObject);
      expect(result['number.names'].length).toEqual(1024);
      expect(result['number.values'].length).toEqual(1024);
      expect(result).toMatchSnapshot();
    });

    it('adds obfuscated sql to output', async () => {
      const original = {
        db: {
          statement: `SELECT * from users where name = 'Carl' limit 1 order by name asc;\n`,
        },
      };
      expect(await mapObjectToKeyValuePairs(original)).toEqual({
        'bool.names': [],
        'bool.values': [],
        'number.names': [],
        'number.values': [],
        'string.names': ['db.statement', 'db.sql.normalized'],
        'string.values': [
          original.db.statement,
          `SELECT * from users where name = ? limit ? order by name asc\n`,
        ],
      });
    });
  });
});
