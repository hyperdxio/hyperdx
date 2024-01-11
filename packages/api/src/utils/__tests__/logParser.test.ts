import {
  convertToStringMap,
  mapObjectToKeyValuePairs,
  traverseJson,
} from '../logParser';

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

  it('mapObjectToKeyValuePairs', () => {
    expect(mapObjectToKeyValuePairs(null as any)).toEqual({
      'bool.names': [],
      'bool.values': [],
      'number.names': [],
      'number.values': [],
      'string.names': [],
      'string.values': [],
    });

    expect(mapObjectToKeyValuePairs({})).toEqual({
      'bool.names': [],
      'bool.values': [],
      'number.names': [],
      'number.values': [],
      'string.names': [],
      'string.values': [],
    });

    expect(
      mapObjectToKeyValuePairs({ foo: '123', foo1: 123, foo2: false }),
    ).toEqual({
      'bool.names': ['foo2'],
      'bool.values': [0],
      'number.names': ['foo1'],
      'number.values': [123],
      'string.names': ['foo'],
      'string.values': ['123'],
    });

    expect(
      mapObjectToKeyValuePairs({
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
    const result = mapObjectToKeyValuePairs(testObject);
    expect(result['number.names'].length).toEqual(1024);
    expect(result['number.values'].length).toEqual(1024);
    expect(result).toMatchSnapshot();
  });

  describe('convertToStringMap', () => {
    // export const convertToStringMap = (obj: JSONBlob) => {
    //   const mapped = mapObjectToKeyValuePairs(obj);
    //   const converted_string_attrs: Record<string, string> = {};
    //   for (let i = 0; i < mapped['string.names'].length; i++) {
    //     converted_string_attrs[mapped['string.names'][i]] = mapped['string.values'][i];
    //   }
    //   // at least nominally metrics should not have bool or number attributes, but we will
    //   // handle and append them here just in case
    //   for (let i = 0; i < mapped['number.names'].length; i++) {
    //     converted_string_attrs[mapped['number.names'][i]] = mapped['number.values'][i].toString();
    //   }
    //   for (let i = 0; i < mapped['bool.names'].length; i++) {
    //     converted_string_attrs[mapped['bool.names'][i]] = mapped['bool.values'][i].toString();
    //   }
    //   return converted_string_attrs;;
    // }

    it('converts non string values to strings', () => {
      expect(
        convertToStringMap({
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
      ).toMatchInlineSnapshot(`
Object {
  "array1": "[456]",
  "array2": "[\\"foo1\\",{\\"foo2\\":\\"bar2\\"},[{\\"foo3\\":\\"bar3\\"}]]",
  "foo": "123",
  "foo1": "123",
  "foo2": "0",
  "good.burrito.is": "1",
  "nested.foo": "bar",
}
`);
    });
  });
});
