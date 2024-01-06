import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';

let subprocess: ChildProcess | undefined;

// exported only for testing
export const getChild = () => {
  if (subprocess && subprocess?.killed === false && subprocess?.connected) {
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

  if (!subprocess) {
    throw new Error(`Could not spawn child process`);
  }

  process.on('SIGINT', () => {
    if (subprocess && subprocess?.killed === false) {
      subprocess.kill('SIGINT');
    }
  });

  return subprocess;
};

const removeListeners = (subprocess: ChildProcess | undefined) => {
  if (!subprocess) {
    return;
  }
  subprocess.removeAllListeners();
  if (subprocess.stdout) {
    subprocess.stdout.removeAllListeners();
  }
  if (subprocess.stderr) {
    subprocess.stderr.removeAllListeners();
  }
};

export const sqlObfuscator = async (sql: string): Promise<string> => {
  subprocess = getChild();
  if (!subprocess || subprocess.stdin === null) {
    throw new Error(`Could not spawn child process`);
  }

  const strippedSql = sql.replace(/(\r\n|\n|\r)/gm, ' ');
  subprocess.stdin.write(`${strippedSql}\n`);

  let output = '';

  return new Promise((resolve, reject) => {
    if (
      !subprocess ||
      subprocess.stdin === null ||
      subprocess.stdout === null ||
      subprocess.stderr === null
    ) {
      throw new Error(`Could not spawn child process`);
    }
    const errorOutput = (data: any) => {
      removeListeners(subprocess);
      reject(data.toString());
    };
    const dataRecieved = (data: any) => {
      const str = data.toString();
      output += str;
      if (str[str.length - 1] === '\n') {
        removeListeners(subprocess);
        resolve(output);
      }
    };
    const handleExit = (code: number | null, signal: string | null) => {
      if (code !== 0) {
        errorOutput(`Child process exited with code ${code}`);
      } else {
        errorOutput(`Child process exited with signal ${signal}`);
      }
    };
    subprocess.stdout.on('data', dataRecieved);
    subprocess.stderr.on('data', errorOutput);
    subprocess.on('error', errorOutput);
    subprocess.on('exit', handleExit);
  });
};
