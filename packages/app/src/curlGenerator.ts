// From: https://github.com/albertodeago/curl-generator/blob/master/src/main.ts
// Forked to allow multiple headers with the same name

type StringMap = { [key: string]: string };

/**
 * Additional options for curl command.
 *
 * --compressed        ->   Request compressed response
 * --compressed-ssh    ->   Enable SSH compression
 * --fail              ->   Fail silently (no output at all) on HTTP errors
 * --fail-early        ->   Fail on first transfer error, do not continue
 * --head              ->   Show document info only
 * --include           ->   Include protocol response headers in the output
 * --insecure          ->   Allow insecure server connections when using SSL
 * --ipv4              ->   Resolve names to IPv4 addresses
 * --ipv6              ->   Resolve names to IPv6 addresses
 * --list-only         ->   List only mode
 * --location          ->   Follow redirects
 * --location-trusted  ->   Like --location, and send auth to other hosts
 * --no-keepalive      ->   Disable TCP keepalive on the connection
 * --show-error        ->   Show error even when -s is used
 * --silent            ->   Silent mode
 * --ssl               ->   Try SSL/TLS
 * --sslv2             ->   Use SSLv2
 * --sslv3             ->   Use SSLv3
 * --verbose           ->   Make the operation more talkative
 */
type CurlAdditionalOptions = {
  compressed: boolean;
  compressedSsh: boolean;
  fail: boolean;
  failEarly: boolean;
  head: boolean;
  include: boolean;
  insecure: boolean;
  ipv4: boolean;
  ipv6: boolean;
  listOnly: boolean;
  location: boolean;
  locationTrusted: boolean;
  noKeepalive: boolean;
  output: string;
  showError: boolean;
  silent: boolean;
  ssl: boolean;
  sslv2: boolean;
  sslv3: boolean;
  verbose: boolean;
};

type CurlRequest = {
  method?:
    | 'GET'
    | 'get'
    | 'POST'
    | 'post'
    | 'PUT'
    | 'put'
    | 'PATCH'
    | 'patch'
    | 'DELETE'
    | 'delete';
  headers?: [string, string][];
  body?: Object | string;
  url: string;
};

// slash for connecting previous breakup line to current line for running cURL directly in Command Prompt
const slash = ' \\';
const newLine = '\n';

/**
 * @param {string} [method]
 * @returns {string}
 */
const getCurlMethod = function (method?: string): string {
  let result = '';
  if (method) {
    const types: StringMap = {
      GET: '-X GET',
      POST: '-X POST',
      PUT: '-X PUT',
      PATCH: '-X PATCH',
      DELETE: '-X DELETE',
    };
    result = ` ${types[method.toUpperCase()]}`;
  }
  return slash + newLine + result;
};

/**
 * @param {StringMap} headers
 * @returns {string}
 */
const getCurlHeaders = function (headers?: [string, string][]): string {
  let result = '';
  if (headers) {
    headers.map(([name, val]) => {
      result += `${slash}${newLine}-H "${name}: ${val.replace(
        /(\\|")/g,
        '\\$1',
      )}"`;
    });
  }
  return result;
};

/**
 * @param {Object} body
 * @returns {string}
 */
const getCurlBody = function (body?: Object): string {
  let result = '';
  if (body) {
    result += `${slash}${newLine}-d "${JSON.stringify(body).replace(
      /(\\|")/g,
      '\\$1',
    )}"`;
  }
  return result;
};

// From chrome dev tools
// https://github.com/ChromeDevTools/devtools-frontend/blob/d12637511c19e5a3d060656eeb54e76e410715ca/front_end/panels/network/NetworkLogView.ts#L2193
// TODO: Support windows
function escapeStringPosix(str: string): string {
  function escapeCharacter(x: string): string {
    const code = x.charCodeAt(0);
    let hexString = code.toString(16);
    // Zero pad to four digits to comply with ANSI-C Quoting:
    // http://www.gnu.org/software/bash/manual/html_node/ANSI_002dC-Quoting.html
    while (hexString.length < 4) {
      hexString = '0' + hexString;
    }

    return '\\u' + hexString;
  }

  // eslint-disable-next-line no-control-regex, no-useless-escape
  if (/[\0-\x1F\x7F-\x9F!]|\'/.test(str)) {
    // Use ANSI-C quoting syntax.
    return (
      "$'" +
      str
        .replace(/\\/g, '\\\\')
        // eslint-disable-next-line no-useless-escape
        .replace(/\'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        // eslint-disable-next-line no-control-regex
        .replace(/[\0-\x1F\x7F-\x9F!]/g, escapeCharacter) +
      "'"
    );
  }
  // Use single quote syntax.
  return "'" + str + "'";
}

const getCurlBodyString = function (body?: string): string {
  let result = '';
  if (body) {
    result += `${slash}${newLine}--data-raw ${escapeStringPosix(body)}`;
  }
  return result;
};

/**
 * Given the curl additional options, turn them into curl syntax
 * @param {CurlAdditionalOptions} [options]
 * @returns {string}
 */
const getCurlOptions = function (options?: CurlAdditionalOptions): string {
  let result = '';
  if (options) {
    (Object.keys(options) as Array<keyof CurlAdditionalOptions>).forEach(
      (key: keyof CurlAdditionalOptions) => {
        const kebabKey = key.replace(
          /[A-Z]/g,
          letter => `-${letter.toLowerCase()}`,
        );

        if (!options[key]) {
          throw new Error(`Invalid Curl option ${key}`);
        } else if (typeof options[key] === 'boolean' && options[key]) {
          // boolean option, we just add --opt
          result += `--${kebabKey} `;
        } else if (typeof options[key] === 'string') {
          // string option, we have to add --opt=value
          result += `--${kebabKey} ${options[key]} `;
        }
      },
    );
  }

  return result ? `${slash}${newLine}${result}` : result;
};

/**
 * @param {CurlRequest} params
 * @param {CurlAdditionalOptions} [options]
 * @returns {string}
 */
const CurlGenerator = function (
  params: CurlRequest,
  options?: CurlAdditionalOptions,
): string {
  let curlSnippet = 'curl ';
  curlSnippet += params.url;
  curlSnippet += getCurlMethod(params.method);
  curlSnippet += getCurlHeaders(params.headers);
  curlSnippet +=
    typeof params.body === 'string'
      ? getCurlBodyString(params.body)
      : getCurlBody(params.body);
  curlSnippet += getCurlOptions(options);
  return curlSnippet.trim();
};

export { CurlGenerator };
