import { HdxTask, PingTaskArgs } from '@/tasks/types';
import logger from '@/utils/logger';

export default class PingPongTask implements HdxTask<PingTaskArgs> {
  constructor(private args: PingTaskArgs) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(): Promise<void> {
    logger.info(`
                   O .
                 _/|\\_-O
                ___|_______
               /     |     \
              /      |      \
             #################
            /   _ ( )|        \
           /    ( ) ||         \
          /  \\  |_/ |          \
         /____\\/|___|___________\
            |    |             |
            |   / \\           |
            |  /   \\          |
            |_/    /_
        `);
  }

  name(): string {
    return this.args.taskName;
  }

  async asyncDispose(): Promise<void> {}
}
