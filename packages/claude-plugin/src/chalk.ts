import { Chalk } from 'chalk';

// The hooks environment has no TTY for chalk to detect; level 1 keeps termchart's
// colors to the basic SGR codes ansiLines reads.
export default new Chalk({ level: 1 });
