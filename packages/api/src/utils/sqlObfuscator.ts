import { spawn } from 'child_process';

let subprocess: any;

const getChild = () => {
  if (subprocess) {
    return subprocess;
  }

  const arch = process.arch;

  // can be updated if new arch is built
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Unsupported architecture: ${arch}`);
  }

  subprocess = spawn(`src/gobin/sql_obfuscator_${arch}`, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  process.on('SIGINT', () => {
    subprocess.kill('SIGINT');
  });

  return subprocess;
};

export const sqlObfuscator = async (sql: string): Promise<string> => {
  subprocess = getChild();
  const strippedSql = sql.replace(/(\r\n|\n|\r)/gm, ' ');
  subprocess.stdin.write(`${strippedSql}\n`);

  return new Promise((resolve, reject) => {
    const removeListeners = (subprocess: any) => {
      subprocess.stdout.removeAllListeners();
      subprocess.stderr.removeAllListeners();
      subprocess.removeAllListeners();
    };
    const errorOutput = (data: any) => {
      removeListeners(subprocess);
      reject(data.toString());
    };
    const dataRecieved = (data: any) => {
      removeListeners(subprocess);
      resolve(data.toString());
    };
    subprocess.stdout.on('data', dataRecieved);
    subprocess.stderr.on('data', errorOutput);
    subprocess.on('error', errorOutput);
    subprocess.on('exit', errorOutput);
  });
};
